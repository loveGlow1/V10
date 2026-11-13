/* Which model makes each scene's clip — the clip router.
 *
 * Five ways to make a clip, each with what it can and cannot do, and the
 * router picks the best one that is connected for THIS scene:
 *
 *   seedance       Seedance 2.0 on Higgsfield. The best human motion and
 *                  camera work available, real aspect ratios (9:16 included),
 *                  up to 15s at 1080p. First choice for anything with people
 *                  in it: UGC, ads, cinematic, trailers.
 *   minimax        MiniMax Hailuo 2.3 on MiniMax's own API — the account's
 *                  free credit. Excellent image-to-video. Text-to-video is
 *                  landscape only (there is no aspect parameter), so a
 *                  vertical scene goes to it only when it starts from a frame.
 *   kling          Kling 2.5 Turbo Pro on Higgsfield. Strong, stylised motion;
 *                  landscape text-to-video, any aspect from a frame.
 *   seedance-fal   Seedance 1.5 Pro on fal.ai, text-to-video with real aspect
 *                  ratios — the fallback that runs on the key the production
 *                  line already has.
 *   runware        MiniMax H3 on Runware (RUNWARE_API_KEY) — the Runware
 *                  start-up credit. Every aspect ratio from text, 4–15s, and
 *                  image-to-video from a first frame. Spent first on the
 *                  "credit" and "economy" tiers, since it is prepaid.
 *   n8n            MiniMax-H3 through the n8n render workflow, on the account's
 *                  MiniMax usage credit (n8n's gateway). Every aspect ratio
 *                  from text, 4–6s clips.
 *
 * Tiers: "credit" — the default — spends the MiniMax usage credit on n8n
 * first and only reaches for a paid engine when n8n refuses or fails a clip;
 * "best" ranks by output quality; "economy" puts direct MiniMax first. A chain is
 * never a guess about the aspect: an engine that would crop a vertical scene
 * into landscape is left out of that scene's chain altogether.
 *
 * Pure apart from reading the environment, so tools/check-video.mjs can pass
 * its own. */

import type { PipelineId } from "./pipelines";

export type ClipEngine = "seedance" | "minimax" | "kling" | "seedance-fal" | "runware" | "n8n" | "h3-ref" | "seedance-ref";
export type Tier = "credit" | "best" | "economy";
export type Aspect = "9:16" | "1:1" | "16:9" | "4:5";

type Env = Record<string, string | undefined>;

export type EngineSpec = {
  label: string;
  /** Credits per clip, charged when it arrives. */
  cost: number;
  /** Seconds a clip can be: the router rounds a scene to the nearest allowed. */
  durations: number[];
  /** Aspects it can make from a prompt alone. From a frame, the frame decides. */
  textAspects: Aspect[] | "landscape-only";
  imageToVideo: boolean;
  /** Films a scene from a character's reference pictures (the same face every time). */
  references?: boolean;
  configured: (env: Env) => boolean;
};

const ALL: Aspect[] = ["9:16", "1:1", "16:9", "4:5"];

export const ENGINES: Record<ClipEngine, EngineSpec> = {
  seedance: {
    label: "Seedance 2.0 (Higgsfield)",
    cost: 6,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    textAspects: ALL,
    imageToVideo: true,
    configured: (env) => Boolean(env.HF_API_KEY_ID && env.HF_API_KEY_SECRET),
  },
  minimax: {
    label: "MiniMax Hailuo 2.3",
    cost: 4,
    durations: [6, 10],
    textAspects: "landscape-only",
    imageToVideo: true,
    configured: (env) => Boolean(env.MINIMAX_API_KEY),
  },
  kling: {
    label: "Kling 2.5 Turbo (Higgsfield)",
    cost: 5,
    durations: [5, 10],
    textAspects: "landscape-only",
    imageToVideo: true,
    configured: (env) => Boolean(env.HF_API_KEY_ID && env.HF_API_KEY_SECRET),
  },
  "seedance-fal": {
    label: "Seedance 1.5 Pro (fal)",
    cost: 6,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12],
    textAspects: ALL,
    imageToVideo: false,
    configured: (env) => Boolean(env.FAL_KEY),
  },
  runware: {
    label: "MiniMax H3 (Runware)",
    cost: 5,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    textAspects: ALL,
    imageToVideo: true,
    configured: (env) => Boolean(env.RUNWARE_API_KEY),
  },
  /* Character scenes: filmed from the character's reference pictures, passed
     with every scene, so the face never drifts (runware.ts referenceVideoTask). */
  "h3-ref": {
    label: "MiniMax H3, character reference (Runware)",
    cost: 5,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    textAspects: ALL,
    imageToVideo: false,
    references: true,
    configured: (env) => Boolean(env.RUNWARE_API_KEY),
  },
  "seedance-ref": {
    label: "Seedance 2.0, character reference (Runware)",
    cost: 8,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    textAspects: ALL,
    imageToVideo: false,
    references: true,
    configured: (env) => Boolean(env.RUNWARE_API_KEY),
  },
  n8n: {
    label: "MiniMax-H3 (n8n, usage credit)",
    cost: 4,
    durations: [4, 5, 6],
    /* The workflow passes the plan's ratio to MiniMax-H3 (4:5 as 3:4). */
    textAspects: ALL,
    imageToVideo: true,
    configured: (env) => Boolean((env.N8N_VIDEO_WEBHOOK_URL || env.N8N_WEBHOOK_URL) && env.N8N_WEBHOOK_TOKEN),
  },
};

export const CLIP_ENGINES = Object.keys(ENGINES) as ClipEngine[];

export function isClipEngine(value: unknown): value is ClipEngine {
  return typeof value === "string" && (CLIP_ENGINES as string[]).includes(value);
}

/* People on camera, and motion that has to feel filmed. */
const FOOTAGE: PipelineId[] = ["ugc_influencer", "commercial_ad", "cinematic_short", "full_movie", "trailer", "social_video", "clone"];
/* Starting from a photograph the person gave. */
const FROM_FRAME: PipelineId[] = ["photo_to_video", "product_showcase"];

/** The ranking before anything is filtered: best first. */
export function ranking(pipeline: PipelineId, tier: Tier, fromFrame: boolean): ClipEngine[] {
  let order: ClipEngine[];
  if (FROM_FRAME.includes(pipeline) || fromFrame) order = ["minimax", "runware", "seedance", "kling", "seedance-fal", "n8n"];
  else if (FOOTAGE.includes(pipeline)) order = ["seedance", "seedance-fal", "runware", "kling", "minimax", "n8n"];
  else order = ["seedance", "runware", "minimax", "kling", "seedance-fal", "n8n"];
  /* Credit: prepaid credit before anything paid per use — the Runware
     start-up credit, then the MiniMax usage credit on n8n, then MiniMax's own
     API on its key. */
  const prepaid: ClipEngine[] = ["runware", "n8n", "minimax"];
  if (tier === "credit") order = [...prepaid, ...order.filter((engine) => !prepaid.includes(engine))];
  /* Economy: Runware's credit and direct MiniMax first, wherever they can make the scene. */
  if (tier === "economy") order = ["runware", "minimax", ...order.filter((engine) => engine !== "minimax" && engine !== "runware")];
  return order;
}

/** Whether an engine can make this scene as asked — never a crop or a stretch. */
export function canMake(engine: ClipEngine, scene: { aspect: Aspect; fromFrame: boolean; references?: boolean }): boolean {
  const spec = ENGINES[engine];
  if (spec.references) return Boolean(scene.references);
  if (scene.fromFrame) return spec.imageToVideo;
  return spec.textAspects === "landscape-only" ? scene.aspect === "16:9" : spec.textAspects.includes(scene.aspect);
}

/**
 * The engines to try for one scene, in order: connected, able to make it at
 * its aspect, best first for the tier. Empty means no connected engine can.
 */
export function routeClip(
  input: { pipeline: PipelineId; aspect: Aspect; fromFrame: boolean; tier?: Tier; prefer?: ClipEngine | null; skip?: ClipEngine[]; references?: boolean },
  env: Env = process.env,
): ClipEngine[] {
  const tier = input.tier ?? tierFrom(env);
  /* A scene with a character: its reference pictures first, on every tier —
     consistency is not traded for price. After them, the engines that film
     from the character's front picture as a first frame. */
  let order: ClipEngine[] = input.references
    ? ["h3-ref", "seedance-ref", ...ranking(input.pipeline, tier, true)]
    : ranking(input.pipeline, tier, input.fromFrame);
  if (input.prefer && order.includes(input.prefer)) order = [input.prefer, ...order.filter((engine) => engine !== input.prefer)];
  /* Paused engines — n8n once its usage credit is spent (credit.ts). */
  const skip = new Set(input.skip ?? []);
  return order.filter((engine) => !skip.has(engine) && ENGINES[engine].configured(env) && canMake(engine, input.references ? { ...input, fromFrame: !ENGINES[engine].references } : input));
}

/**
 * The video's own Quality answer, then VIDEO_QUALITY, then "credit": the
 * MiniMax usage credit on n8n is spent before anything paid for.
 */
export function tierFrom(env: Env = process.env, answer?: string | null): Tier {
  if (answer && /credit|n8n/i.test(answer)) return "credit";
  if (answer && /econom|draft|fast|cheap/i.test(answer)) return "economy";
  if (answer && /best|premium|quality/i.test(answer)) return "best";
  const set = (env.VIDEO_QUALITY ?? "").trim().toLowerCase();
  return set === "best" ? "best" : set === "economy" ? "economy" : "credit";
}

/** The allowed duration nearest the scene's, never shorter than it where one exists. */
export function durationFor(engine: ClipEngine, seconds: number): number {
  const allowed = ENGINES[engine].durations;
  return allowed.find((d) => d >= seconds) ?? allowed[allowed.length - 1];
}

/** What the clip of a scene will cost on the engine that will make it. */
export function clipCost(engine: ClipEngine | null): number {
  return engine ? ENGINES[engine].cost : ENGINES.minimax.cost;
}

export function anyClipEngine(env: Env = process.env): boolean {
  return CLIP_ENGINES.some((engine) => ENGINES[engine].configured(env));
}

/* Whether a voice line can be spoken here without n8n: MiniMax speech on
   Runware (RUNWARE_API_KEY) or on MiniMax's own API (MINIMAX_API_KEY). */
export const canSpeak = (env: Env = process.env) => Boolean(env.RUNWARE_API_KEY || env.MINIMAX_API_KEY);

/* Voice lines: Runware's MiniMax speech whenever it is connected (prepaid);
   otherwise on the "credit" tier the n8n route (MiniMax speech on the usage
   credit) whenever it is connected, then MiniMax's own speech API with
   MINIMAX_API_KEY, or n8n when that is all there is. */
export function voiceDirect(env: Env = process.env, tier: Tier = tierFrom(env), n8nPaused = false): boolean {
  if (env.RUNWARE_API_KEY) return true;
  if (!env.MINIMAX_API_KEY) return false;
  return n8nPaused || !(tier === "credit" && ENGINES.n8n.configured(env));
}

/* Where a row's provider column says a clip is: "hf:seedance:<id>",
   "minimax:<task>", "fal-clip:<id>", "runware:<task uuid>". Not "fal:", which the production line's
   own lip sync, avatar, music and compose rows use. */
export function providerOf(engine: ClipEngine, id: string): string {
  if (engine === "runware") return `runware:${id}`;
  if (engine === "h3-ref" || engine === "seedance-ref") return `rwref:${engine}:${id}`;
  return engine === "minimax" ? `minimax:${id}` : engine === "seedance-fal" ? `fal-clip:${id}` : engine === "n8n" ? "n8n:minimax" : `hf:${engine}:${id}`;
}

export function parseProvider(value: string | null | undefined): { engine: ClipEngine; id: string } | null {
  const v = value ?? "";
  if (v.startsWith("minimax:") && v !== "minimax:speech") return { engine: "minimax", id: v.slice(8) };
  if (v.startsWith("fal-clip:")) return { engine: "seedance-fal", id: v.slice(9) };
  if (v.startsWith("runware:")) return { engine: "runware", id: v.slice(8) };
  const ref = v.match(/^rwref:(h3-ref|seedance-ref):(.+)$/);
  if (ref) return { engine: ref[1] as ClipEngine, id: ref[2] };
  const hf = v.match(/^hf:(seedance|kling):(.+)$/);
  if (hf) return { engine: hf[1] as ClipEngine, id: hf[2] };
  return null;
}
