/* The generation engines behind the router — the Rendering layer.
 *
 *   video    the best connected clip engine for each scene — Seedance 2.0 or
 *            Kling on Higgsfield, MiniMax Hailuo 2.3 on MiniMax's own API,
 *            Seedance 1.5 on fal, or MiniMax through n8n. See clip-engines.ts.
 *   image    rendered as a motion clip from the same prompt, the same way
 *   voice    MiniMax speech, one line per scene — MiniMax's own API with
 *            MINIMAX_API_KEY, otherwise through n8n
 *   avatar   fal.ai: lip sync on a fictional on-camera creator (sync-lipsync),
 *            or YOUR photo talking for a clone (OmniHuman)
 *   music    fal.ai Stable Audio 2.5
 *   compose  fal.ai FFmpeg compose — one MP4 out of every scene
 *
 * Without FAL_KEY: on-camera lines are voiced over the clip (and the studio
 * says so), there is no music, and the studio plays the scenes in order
 * instead of producing one file. A CLONE is a real person's likeness and is
 * never faked that way: without the avatar engine it does not render.
 *
 * Pure apart from reading the environment, so tools/check-video.mjs can pass
 * its own. */

import { type Aspect, anyClipEngine, clipCost, routeClip, tierFrom, voiceDirect } from "./clip-engines";
import type { PipelineId } from "./pipelines";
import type { ProductionPlan } from "./plan";

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

export function engineHealth(engine: EngineId, env: Env = process.env): EngineHealth {
  if (!ADAPTERS[engine]) return "no-adapter";
  const ok =
    engine === "avatar" || engine === "music" || engine === "compose"
      ? falConfigured(env)
      : engine === "voice"
        ? voiceDirect(env) || n8nConfigured(env)
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
export function firstEngineFor(plan: ProductionPlan, scene: { engine: string }, env: Env = process.env, quality?: string | null) {
  const fromFrame = plan.pipeline === "photo_to_video" || (scene.engine === "avatar" && ["ugc_influencer", "commercial_ad", "social_video"].includes(plan.pipeline));
  return routeClip({ pipeline: plan.pipeline, aspect: plan.aspect as Aspect, fromFrame, tier: tierFrom(env, quality) }, env)[0] ?? null;
}

export function renderCost(plan: ProductionPlan, env: Env = process.env, quality?: string | null): number {
  const fal = falConfigured(env);
  let total = 0;
  for (const scene of plan.scenes) {
    const avatar = scene.engine === "avatar";
    const spoken = Boolean(scene.voiceover.trim());
    if (!(avatar && isClone(plan.pipeline))) total += anyClipEngine(env) ? clipCost(firstEngineFor(plan, scene, env, quality)) : CLIP_COST;
    if (spoken) total += VOICE_COST;
    if (avatar && fal && spoken) total += isClone(plan.pipeline) ? AVATAR_COST : LIPSYNC_COST;
  }
  if (fal && wantsMusic(plan)) total += MUSIC_COST;
  if (fal) total += COMPOSE_COST;
  return total;
}

export function readiness(plan: ProductionPlan, env?: Env) {
  const engines = enginesNeeded(plan).map(({ engine, required }) => ({ engine, required, label: ENGINE_LABEL[engine], health: engineHealth(engine, env) }));
  const fal = falConfigured(env ?? process.env);
  const onCamera = !isClone(plan.pipeline) && plan.scenes.some((scene) => scene.engine === "avatar");
  return {
    engines,
    ready: engines.every((entry) => !entry.required || entry.health === "available"),
    notes: fal
      ? [
          ...(wantsMusic(plan) && plan.scenes.some((scene) => scene.voiceover) ? ["Music plays under the voice in the studio and downloads as its own track; the MP4 carries the voice."] : []),
          "Captions show in the studio player; the MP4 is clean, ready for captions on the platform.",
        ]
      : [
          ...(onCamera ? ["On-camera lines are voiced over the clip — lip sync needs FAL_KEY."] : []),
          ...(wantsMusic(plan) ? ["Music needs FAL_KEY; the cut plays with voice only."] : []),
          "One-file MP4 export needs FAL_KEY; the studio plays the scenes in order.",
        ],
  };
}
