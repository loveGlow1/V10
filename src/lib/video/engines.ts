/* The generation engines behind the router — the Rendering layer.
 *
 * Every pipeline routes its scenes to the same engines. What stands behind
 * them now is the n8n workflow "QuickStark.Ai — Video Render" on MiniMax,
 * through n8n's Gateway credits (see render.ts):
 *
 *   video   MiniMax-H3 text-to-video, at the plan's aspect ratio      wired
 *   image   rendered as an H3 motion clip from the same prompt        wired
 *   voice   MiniMax speech, one line per scene                        wired
 *   avatar  presenter with lip sync                                   not yet
 *   music   a score under the cut                                     not yet
 *
 * A fictional on-camera creator (UGC, presenter-led explainers) is rendered
 * as a video clip with the voice laid over it — honest about having no lip
 * sync. A CLONE is a real person's likeness and is never faked that way: it
 * waits for a real avatar engine. Music is optional; a cut without it is
 * still a video.
 *
 * Pure apart from reading the environment, so tools/check-video.mjs can pass
 * its own. */

import type { PipelineId } from "./pipelines";
import type { ProductionPlan } from "./plan";

/* Credits per render job, charged when its result arrives (render callback). */
export const CLIP_COST = 4;
export const VOICE_COST = 1;
export const renderCost = (plan: ProductionPlan) =>
  plan.scenes.reduce((sum, scene) => sum + CLIP_COST + (scene.voiceover.trim() ? VOICE_COST : 0), 0);

export type EngineId = "video" | "image" | "avatar" | "voice" | "music";
export type EngineHealth = "available" | "not-configured" | "no-adapter";

/* Which engines the n8n workflow can serve. */
export const ADAPTERS: Record<EngineId, boolean> = { video: true, image: true, avatar: false, voice: true, music: false };

export const ENGINE_LABEL: Record<EngineId, string> = {
  video: "Video generation",
  image: "Image scenes",
  avatar: "Avatar and lip sync",
  voice: "Voice",
  music: "Music",
};

function renderConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean((env.N8N_VIDEO_WEBHOOK_URL || env.N8N_WEBHOOK_URL) && env.N8N_WEBHOOK_TOKEN);
}

export function engineHealth(engine: EngineId, env: Record<string, string | undefined> = process.env): EngineHealth {
  if (!ADAPTERS[engine]) return "no-adapter";
  return renderConfigured(env) ? "available" : "not-configured";
}

/* Avatar scenes need a real avatar engine only for a clone. */
const needsAvatar = (pipeline: PipelineId) => pipeline === "clone";

/** Every engine a plan needs, and whether each is required for the cut. */
export function enginesNeeded(plan: ProductionPlan): { engine: EngineId; required: boolean }[] {
  const needed = new Map<EngineId, boolean>();
  for (const scene of plan.scenes) {
    if (scene.engine === "avatar" && !needsAvatar(plan.pipeline)) needed.set("video", true);
    else needed.set(scene.engine, true);
  }
  if (plan.scenes.some((scene) => scene.voiceover)) needed.set("voice", true);
  if (plan.music && !/^(none|no music)$/i.test(plan.music)) needed.set("music", false);
  return [...needed].map(([engine, required]) => ({ engine, required }));
}

export function readiness(plan: ProductionPlan, env?: Record<string, string | undefined>) {
  const engines = enginesNeeded(plan).map(({ engine, required }) => ({ engine, required, label: ENGINE_LABEL[engine], health: engineHealth(engine, env) }));
  const lipSync = plan.pipeline !== "clone" && plan.scenes.some((scene) => scene.engine === "avatar");
  return {
    engines,
    ready: engines.every((entry) => !entry.required || entry.health === "available"),
    notes: [
      ...(lipSync ? ["On-camera lines are voiced over the clip — lip sync is not available yet."] : []),
      ...(engines.some((entry) => entry.engine === "music") ? ["Music is not generated yet; the cut plays with voice only."] : []),
    ],
  };
}
