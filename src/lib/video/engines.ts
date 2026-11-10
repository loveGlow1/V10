/* The generation engines behind the router — the Rendering layer.
 *
 *   video    the best connected clip engine for each scene — Seedance 2.0 or
 *            Kling on Higgsfield, MiniMax Hailuo 2.3 on MiniMax's own API,
 *            Seedance 1.5 on fal, or MiniMax through n8n. See clip-engines.ts.
 *   image    rendered as a motion clip from the same prompt, the same way
 *   voice    MiniMax speech, one line per scene — MiniMax's own API with
 *            MINIMAX_API_KEY, otherwise through n8n
 *   avatar   lip sync on a fictional on-camera creator, or YOUR photo
 *            talking for a clone — Runware (sync lipsync-2-pro, Kling
 *            Avatar 2.0) with RUNWARE_API_KEY, else fal (sync-lipsync,
 *            OmniHuman) with FAL_KEY: productionEngine()
 *   music    Runware ACE-Step 1.5, else fal Stable Audio 2.5
 *   compose  this server's ffmpeg (compose-local.ts) — voice, music ducked
 *            under it, captions — or fal's FFmpeg compose on the fal line
 *
 * With neither key: on-camera lines are voiced over the clip (and the studio
 * says so) and there is no music; the cut is still made here. A CLONE is a
 * real person's likeness and is never faked that way: without the avatar
 * engine it does not render.
 *
 * Pure apart from reading the environment, so tools/check-video.mjs can pass
 * its own. */

import { type Aspect, type ClipEngine, anyClipEngine, clipCost, routeClip, tierFrom, voiceDirect } from "./clip-engines";
import type { PipelineId } from "./pipelines";
import type { ProductionPlan } from "./plan";
import { topUpPricePerCredit } from "@/app/dashboard/credits";

/* Credits per job, charged when its result arrives — never for a failure. */
export const CLIP_COST = 4;
export const VOICE_COST = 1;
export const LIPSYNC_COST = 3;
export const AVATAR_COST = 6;
export const MUSIC_COST = 2;
export const COMPOSE_COST = 1;

export type EngineId = "video" | "image" | "avatar" | "voice" | "music" | "compose";
export type EngineHealth = "available" | "not-configured" | "no-adapter";

/* Every engine has an adapter now; which ones are configured is the question. */
export const ADAPTERS: Record<EngineId, boolean> = { video: true, image: true, avatar: true, voice: true, music: true, compose: true };

export const ENGINE_LABEL: Record<EngineId, string> = {
  video: "Video generation",
  image: "Image scenes",
  avatar: "Lip sync and avatar",
  voice: "Voice",
  music: "Music",
  compose: "Final MP4",
};

type Env = Record<string, string | undefined>;
const n8nConfigured = (env: Env) => Boolean((env.N8N_VIDEO_WEBHOOK_URL || env.N8N_WEBHOOK_URL) && env.N8N_WEBHOOK_TOKEN);
export const falConfigured = (env: Env = process.env) => Boolean(env.FAL_KEY);

/* ── The production line's engine: lip sync, avatar, music ──────────────
   Runware when its key is set — the prepaid credit, one key for all three —
   else fal. VIDEO_PRODUCTION_ENGINE=fal|runware pins one where both are set. */
export type ProductionEngine = "runware" | "fal";
export function productionEngine(env: Env = process.env): ProductionEngine | null {
  const pinned = (env.VIDEO_PRODUCTION_ENGINE ?? "").trim().toLowerCase();
  if (pinned === "fal" && env.FAL_KEY) return "fal";
  if (pinned === "runware" && env.RUNWARE_API_KEY) return "runware";
  return env.RUNWARE_API_KEY ? "runware" : env.FAL_KEY ? "fal" : null;
}

/* Runware list prices in USD per second of output (Nov 2026), and how a
   Runware job becomes credits: credits(usd) = ceil(usd × MARKUP ÷ the price
   of one credit), never less than one. The credit's price is the top-up
   pack's, the dearest a credit is ever sold at, so the markup is a floor. */
export const RUNWARE_USD_PER_SECOND = {
  lipsyncFinal: 0.0733,
  lipsyncDraft: 0.044,
  avatarFinal: 0.087,
  avatarDraft: 0.044,
  music: 0.0001,
} as const;
export const MARKUP = 2.5;
export const usdPerCredit = () => topUpPricePerCredit();
export const creditsForUsd = (usd: number) => Math.max(1, Math.ceil((Math.max(0, usd) * MARKUP) / usdPerCredit() - 1e-9));

/** The credits a Runware production job is quoted at, by the seconds it makes. */
export function runwareJobCredits(kind: "lipsync" | "avatar" | "music", seconds: number, tier: "final" | "draft" = "final"): number {
  const s = Math.max(1, seconds);
  if (kind === "music") return creditsForUsd(RUNWARE_USD_PER_SECOND.music * Math.max(30, s));
  const rate = kind === "lipsync" ? (tier === "final" ? RUNWARE_USD_PER_SECOND.lipsyncFinal : RUNWARE_USD_PER_SECOND.lipsyncDraft) : tier === "final" ? RUNWARE_USD_PER_SECOND.avatarFinal : RUNWARE_USD_PER_SECOND.avatarDraft;
  return creditsForUsd(rate * s);
}

/**
 * What a delivered Runware job is charged: what Runware actually charged
 * (includeCost), turned into credits — but never more than 10% over the
 * quote the person saw. Unknown cost: the quote.
 */
export function settleRunwareCredits(quoted: number, actualUsd: number | null): number {
  if (actualUsd === null || !Number.isFinite(actualUsd)) return quoted;
  return Math.min(creditsForUsd(actualUsd), Math.ceil(quoted * 1.1));
}

/* The tier a production job runs at: "draft" on the economy answer. */
export const productionTier = (quality?: string | null): "final" | "draft" => (quality && /econom|draft|fast|cheap/i.test(quality) ? "draft" : "final");

export function engineHealth(engine: EngineId, env: Env = process.env): EngineHealth {
  if (!ADAPTERS[engine]) return "no-adapter";
  const ok =
    engine === "avatar" || engine === "music"
      ? productionEngine(env) !== null
      : engine === "compose"
        ? true
        : engine === "voice"
        ? Boolean(env.RUNWARE_API_KEY || env.MINIMAX_API_KEY) || n8nConfigured(env)
        : anyClipEngine(env);
  return ok ? "available" : "not-configured";
}

/* A clone needs its avatar; for everyone else lip sync is an upgrade. */
const isClone = (pipeline: PipelineId) => pipeline === "clone";
export const wantsMusic = (plan: ProductionPlan) => Boolean(plan.music) && !/^(none|no music)$/i.test(plan.music.trim());

/** Every engine a plan needs, and whether each is required for the cut. */
export function enginesNeeded(plan: ProductionPlan): { engine: EngineId; required: boolean }[] {
  const needed = new Map<EngineId, boolean>();
  const avatarScenes = plan.scenes.filter((scene) => scene.engine === "avatar");
  for (const scene of plan.scenes) {
    if (scene.engine === "avatar") {
      /* A clone's presenter scenes ARE the avatar; everyone else's start as a
         clip, and lip sync is laid on afterwards. */
      if (!isClone(plan.pipeline)) needed.set("video", true);
    } else needed.set(scene.engine, true);
  }
  if (plan.scenes.some((scene) => scene.voiceover)) needed.set("voice", true);
  if (avatarScenes.length) needed.set("avatar", isClone(plan.pipeline));
  if (wantsMusic(plan)) needed.set("music", false);
  needed.set("compose", false);
  return [...needed].map(([engine, required]) => ({ engine, required }));
}

/* What a render costs when every job delivers — shown on the button, checked
   against the balance before anything is sent. */
/* The engine a scene's clip goes to first: where its price comes from. */
export function firstEngineFor(plan: ProductionPlan, scene: { engine: string }, env: Env = process.env, quality?: string | null, skip: ClipEngine[] = []) {
  const fromFrame = plan.pipeline === "photo_to_video" || (scene.engine === "avatar" && ["ugc_influencer", "commercial_ad", "social_video"].includes(plan.pipeline));
  return routeClip({ pipeline: plan.pipeline, aspect: plan.aspect as Aspect, fromFrame, tier: tierFrom(env, quality), skip }, env)[0] ?? null;
}

export function renderCost(plan: ProductionPlan, env: Env = process.env, quality?: string | null, skip: ClipEngine[] = []): number {
  const line = productionEngine(env);
  const tier = productionTier(quality);
  let total = 0;
  for (const scene of plan.scenes) {
    const avatar = scene.engine === "avatar";
    const spoken = Boolean(scene.voiceover.trim()) && plan.cut?.audio !== "original" && plan.cut?.audio !== "none";
    if (!(avatar && isClone(plan.pipeline))) total += anyClipEngine(env) ? clipCost(firstEngineFor(plan, scene, env, quality, skip)) : CLIP_COST;
    if (spoken) total += VOICE_COST;
    if (avatar && spoken && line) total += productionJobCost(line, isClone(plan.pipeline) ? "avatar" : "lipsync", scene.duration, tier);
  }
  if (line && wantsMusic(plan)) total += productionJobCost(line, "music", totalSeconds(plan), tier);
  if (line === "fal") total += COMPOSE_COST;
  return total;
}

const totalSeconds = (plan: Pick<ProductionPlan, "scenes">) => plan.scenes.reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0);

/** One production job's quote, on the engine that will make it. */
export function productionJobCost(line: ProductionEngine, kind: "lipsync" | "avatar" | "music", seconds: number, tier: "final" | "draft" = "final"): number {
  if (line === "fal") return kind === "music" ? MUSIC_COST : kind === "avatar" ? AVATAR_COST : LIPSYNC_COST;
  return runwareJobCredits(kind, seconds, tier);
}

export function readiness(plan: ProductionPlan, env?: Env) {
  const engines = enginesNeeded(plan).map(({ engine, required }) => ({ engine, required, label: ENGINE_LABEL[engine], health: engineHealth(engine, env) }));
  const line = productionEngine(env ?? process.env);
  const onCamera = !isClone(plan.pipeline) && plan.scenes.some((scene) => scene.engine === "avatar");
  return {
    engines,
    ready: engines.every((entry) => !entry.required || entry.health === "available"),
    notes:
      line === "fal"
        ? [
            ...(wantsMusic(plan) && plan.scenes.some((scene) => scene.voiceover) ? ["Music plays under the voice in the studio and downloads as its own track; the MP4 carries the voice."] : []),
            "Captions show in the studio player; the MP4 is clean, ready for captions on the platform.",
          ]
        : line === "runware"
          ? [...(wantsMusic(plan) && plan.scenes.some((scene) => scene.voiceover) ? ["Music is mixed into the MP4, ducked under the voice."] : [])]
          : [
              ...(onCamera ? ["On-camera lines are voiced over the clip — lip sync needs RUNWARE_API_KEY or FAL_KEY."] : []),
              ...(wantsMusic(plan) ? ["Music needs RUNWARE_API_KEY or FAL_KEY; the cut plays with voice only."] : []),
            ],
  };
}
