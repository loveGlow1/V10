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
 *   n8n            MiniMax through the n8n render workflow — the original
 *                  route, kept as the last resort.
 *
 * Quality tiers: "best" ranks by output quality; "economy" puts the free
 * MiniMax credit first wherever it can make the scene properly. A chain is
 * never a guess about the aspect: an engine that would crop a vertical scene
 * into landscape is left out of that scene's chain altogether.
 *
 * Pure apart from reading the environment, so tools/check-video.mjs can pass
 * its own. */

import type { PipelineId } from "./pipelines";

export type ClipEngine = "seedance" | "minimax" | "kling" | "seedance-fal" | "n8n";
export type Tier = "best" | "economy";
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
  n8n: {
    label: "MiniMax (n8n)",
    cost: 4,
    durations: [4, 5, 6],
    textAspects: "landscape-only",
    imageToVideo: true,
    configured: (env) => Boolean((env.N8N_VIDEO_WEBHOOK_URL || env.N8N_WEBHOOK_URL) && env.N8N_WEBHOOK_TOKEN),
  },
};

export const CLIP_ENGINES = Object.keys(ENGINES) as ClipEngine[];

export function isClipEngine(value: unknown): value is ClipEngine {
  return typeof value === "string" && (CLIP_ENGINES as string[]).includes(value);
}

/* People on camera, and motion that has to feel filmed. */
const FOOTAGE: PipelineId[] = ["ugc_influencer", "commercial_ad", "cinematic_short", "trailer", "social_video", "clone"];
/* Starting from a photograph the person gave. */
const FROM_FRAME: PipelineId[] = ["photo_to_video", "product_showcase"];

/** The ranking before anything is filtered: best first. */
export function ranking(pipeline: PipelineId, tier: Tier, fromFrame: boolean): ClipEngine[] {
  let order: ClipEngine[];
  if (FROM_FRAME.includes(pipeline) || fromFrame) order = ["minimax", "seedance", "kling", "seedance-fal", "n8n"];
  else if (FOOTAGE.includes(pipeline)) order = ["seedance", "seedance-fal", "kling", "minimax", "n8n"];
  else order = ["seedance", "minimax", "kling", "seedance-fal", "n8n"];
  /* Economy: the free MiniMax credit first, wherever it can make the scene. */
  if (tier === "economy") order = ["minimax", ...order.filter((engine) => engine !== "minimax")];
  return order;
}

/** Whether an engine can make this scene as asked — never a crop or a stretch. */
export function canMake(engine: ClipEngine, scene: { aspect: Aspect; fromFrame: boolean }): boolean {
  const spec = ENGINES[engine];
  if (scene.fromFrame) return spec.imageToVideo;
  return spec.textAspects === "landscape-only" ? scene.aspect === "16:9" : spec.textAspects.includes(scene.aspect);
}

/**
 * The engines to try for one scene, in order: connected, able to make it at
 * its aspect, best first for the tier. Empty means no connected engine can.
 */
export function routeClip(
  input: { pipeline: PipelineId; aspect: Aspect; fromFrame: boolean; tier?: Tier; prefer?: ClipEngine | null },
  env: Env = process.env,
): ClipEngine[] {
  const tier = input.tier ?? tierFrom(env);
  let order = ranking(input.pipeline, tier, input.fromFrame);
  if (input.prefer && order.includes(input.prefer)) order = [input.prefer, ...order.filter((engine) => engine !== input.prefer)];
  return order.filter((engine) => ENGINES[engine].configured(env) && canMake(engine, input));
}

/** VIDEO_QUALITY=economy puts the free credit first; anything else is "best". */
export function tierFrom(env: Env = process.env, answer?: string | null): Tier {
  if (answer && /econom|draft|fast|cheap/i.test(answer)) return "economy";
  if (answer && /best|premium|quality/i.test(answer)) return "best";
  return (env.VIDEO_QUALITY ?? "").trim().toLowerCase() === "economy" ? "economy" : "best";
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

/* Voice lines: MiniMax's own speech API with the same key, or the n8n route. */
export const voiceDirect = (env: Env = process.env) => Boolean(env.MINIMAX_API_KEY);

/* Where a row's provider column says a clip is: "hf:seedance:<id>",
   "minimax:<task>", "fal-clip:<id>". Not "fal:", which the production line's
   own lip sync, avatar, music and compose rows use. */
export function providerOf(engine: ClipEngine, id: string): string {
  return engine === "minimax" ? `minimax:${id}` : engine === "seedance-fal" ? `fal-clip:${id}` : engine === "n8n" ? "n8n:minimax" : `hf:${engine}:${id}`;
}

export function parseProvider(value: string | null | undefined): { engine: ClipEngine; id: string } | null {
  const v = value ?? "";
  if (v.startsWith("minimax:") && v !== "minimax:speech") return { engine: "minimax", id: v.slice(8) };
  if (v.startsWith("fal-clip:")) return { engine: "seedance-fal", id: v.slice(9) };
  const hf = v.match(/^hf:(seedance|kling):(.+)$/);
  if (hf) return { engine: hf[1] as ClipEngine, id: hf[2] };
  return null;
}
