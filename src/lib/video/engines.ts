/* The generation engines behind the router — the Rendering layer.
 *
 * Every pipeline routes its scenes to the same five engines: video, image,
 * avatar (presenter, clone, UGC creator, with lip sync), voice and music. Which
 * vendor stands behind each is a pricing and quality decision, not a coding
 * one, so none is chosen here — the same position as the AI image provider
 * (lib/builder/assets/providers/ai.ts). Each engine reads its endpoint and key
 * from configuration and reports itself unavailable until both are set and it
 * is switched on. The studio shows which are missing instead of pretending to
 * render.
 *
 * Wiring a vendor in is: implement `submit` for that engine against its API,
 * set the three variables, and the queue in video_renders starts moving.
 * Nothing upstream changes — that is the point of the router. */

import type { ProductionPlan } from "./plan";

export type EngineId = "video" | "image" | "avatar" | "voice" | "music";
export type EngineHealth = "available" | "disabled" | "misconfigured" | "no-adapter";

/* Which engines have a vendor adapter written. None yet: a key alone must not
   make an engine look ready when nothing would send it work. */
export const ADAPTERS: Record<EngineId, boolean> = { video: false, image: false, avatar: false, voice: false, music: false };

export const ENGINE_LABEL: Record<EngineId, string> = {
  video: "Video generation",
  image: "Image generation",
  avatar: "Avatar and lip sync",
  voice: "Voice",
  music: "Music",
};

const PREFIX: Record<EngineId, string> = {
  video: "VIDEO_ENGINE",
  image: "AI_IMAGE",
  avatar: "AVATAR_ENGINE",
  voice: "VOICE_ENGINE",
  music: "MUSIC_ENGINE",
};

export function engineHealth(engine: EngineId, env: Record<string, string | undefined> = process.env): EngineHealth {
  if (!ADAPTERS[engine]) return "no-adapter";
  const prefix = PREFIX[engine];
  if (env[`${prefix}_ENABLED`] !== "true") return "disabled";
  if (!env[`${prefix}_ENDPOINT`] || !env[`${prefix}_API_KEY`]) return "misconfigured";
  return "available";
}

/** Every engine a plan needs: its scenes' engines, voice when anything is spoken, music when any is described. */
export function enginesNeeded(plan: ProductionPlan): EngineId[] {
  const needed = new Set<EngineId>(plan.scenes.map((scene) => scene.engine));
  if (plan.scenes.some((scene) => scene.voiceover && scene.engine !== "avatar")) needed.add("voice");
  if (plan.music && !/^(none|no music)$/i.test(plan.music)) needed.add("music");
  return [...needed];
}

export function readiness(plan: ProductionPlan, env?: Record<string, string | undefined>) {
  const engines = enginesNeeded(plan).map((engine) => ({ engine, label: ENGINE_LABEL[engine], health: engineHealth(engine, env) }));
  return { engines, ready: engines.every((entry) => entry.health === "available") };
}
