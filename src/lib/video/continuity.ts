/* Scene-to-scene continuity — a scene that carries straight on from the one
 * before starts where that one ended.
 *
 * When a scene continues the previous one, it waits for that scene's clip,
 * the clip's last frame is taken, and the scene is filmed with it:
 *
 *   with a character   the last frame is one more reference picture, AFTER
 *                      the character's own (they always come first), and the
 *                      prompt says to carry on from it: same place, light
 *   without            the last frame is its first frame (image-to-video)
 *
 * Only scenes that continue wait. Everything else is filmed at once, in
 * parallel, as before — so a video is only as slow as its longest run of
 * linked scenes, not its length. A scene continues when:
 *
 *   - it says so (scene.continues), as the planner, the person or the split
 *     of a long shot sets it; or
 *   - it is not marked otherwise and it shares a character with the scene
 *     before it — the case where a drifting face or outfit shows most;
 *
 * and both scenes are generated (an upload is already filmed), continuity is
 * on for the video (cut.continuity, default on), and the scene before is not
 * a clone's presenter (made from a photo, not a clip).
 *
 * A generated scene after the person's own clip or picture carries on from
 * it only when it says so (continues: true) — "continue my video": it starts
 * on the clip's last frame (at its trim end), or on the picture.
 *
 * Pure: the planner, the render and the editor all read it. */

import type { ProductionPlan, Scene } from "./plan";

/** What the prompt of a continuing scene adds. */
export const CONTINUE_NOTE = "Continue from the final reference image: same location, same lighting, same moment carrying on; the shot picks up exactly where it ended.";
export const CONTINUE_FRAME_NOTE = "Continue straight on from the first frame: same location, same lighting, the action carrying on.";

const generated = (scene: Scene | undefined, plan: Pick<ProductionPlan, "pipeline">) =>
  Boolean(scene) && !scene!.source && !(plan.pipeline === "clone" && scene!.engine === "avatar");

/* A run of scenes linked only because they share a character is broken every
   this many, so a long film is never made one clip after another for hours:
   the next scene starts fresh from the characters' own pictures, which keep
   the faces. A scene that says it carries on always does. */
export const MAX_AUTO_RUN = 6;

/** The scene a scene waits for, or null when it is filmed at once. Pure. */
export function continuesFrom(plan: Pick<ProductionPlan, "scenes" | "cut" | "pipeline">, n: number): number | null {
  const at = plan.scenes.findIndex((scene) => scene.n === n);
  const linked = linkAt(plan, at);
  if (linked === null || plan.scenes[at]?.continues === true) return linked;
  /* Automatic: count the run behind it. */
  let run = 1;
  for (let i = at - 1; i > 0 && linkAt(plan, i) !== null; i -= 1) run += 1;
  return run % MAX_AUTO_RUN === 0 ? null : linked;
}

function linkAt(plan: Pick<ProductionPlan, "scenes" | "cut" | "pipeline">, at: number): number | null {
  if (plan.cut?.continuity === false) return null;
  if (at <= 0) return null;
  const scene = plan.scenes[at];
  const before = plan.scenes[at - 1];
  if (!generated(scene, plan)) return null;
  /* After an upload, only when asked: the scene starts on the upload's last
     frame (where it was trimmed to end). */
  if (before?.source) return scene.continues === true ? before.n : null;
  if (!generated(before, plan)) return null;
  if (scene.continues === true) return before.n;
  if (scene.continues === false) return null;
  const shared = (scene.characters ?? []).some((id) => before.characters?.includes(id));
  return shared ? before.n : null;
}

/** Every waiting scene and the one it waits for. Pure. */
export function continuityLinks(plan: Pick<ProductionPlan, "scenes" | "cut" | "pipeline">): Map<number, number> {
  const links = new Map<number, number>();
  for (const scene of plan.scenes) {
    const from = continuesFrom(plan, scene.n);
    if (from !== null) links.set(scene.n, from);
  }
  return links;
}

/** The longest run of linked scenes — how many clips are made one after another. Pure. */
export function longestRun(plan: Pick<ProductionPlan, "scenes" | "cut" | "pipeline">): number {
  const links = continuityLinks(plan);
  let longest = plan.scenes.length ? 1 : 0;
  let run = 1;
  for (const scene of plan.scenes) {
    run = links.has(scene.n) ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return longest;
}

/* A waiting scene's row says what it waits for: "await:<scene>". */
export const AWAIT_PREFIX = "await:";
export const awaitProvider = (n: number) => `${AWAIT_PREFIX}${n}`;
export const awaitedScene = (provider: string | null | undefined): number | null => {
  const match = provider?.match(/^await:(\d+)$/);
  return match ? Number(match[1]) : null;
};

/** The pictures a continuing character scene is sent: the characters' own first, then the last frame. Pure. */
export function withLastFrame(references: string[], lastFrame: string | null, max = 9): string[] {
  if (!lastFrame) return references.slice(0, max);
  return [...references.slice(0, max - 1), lastFrame];
}

/** The ffmpeg arguments for a clip's last frame, as a JPEG. Pure. */
export function lastFrameArgs(input: { source: string; out: string }): string[] {
  return ["-hide_banner", "-y", "-sseof", "-0.25", "-i", input.source, "-frames:v", "1", "-q:v", "2", "-update", "1", input.out];
}

/** The ffmpeg arguments for the frame of an uploaded clip at `at` seconds, as a JPEG. Pure. */
export function frameAtArgs(input: { source: string; out: string; at: number }): string[] {
  return ["-hide_banner", "-y", "-ss", Math.max(0, input.at).toFixed(3), "-i", input.source, "-frames:v", "1", "-q:v", "2", "-update", "1", input.out];
}

/** Where an uploaded clip's scene ends — the frame a continuation starts on. Pure. */
export function uploadEnd(source: { trimStart?: number; trimEnd?: number }, clipSeconds: number | null): number {
  const end = source.trimEnd ?? (clipSeconds && clipSeconds > 0 ? clipSeconds : 0);
  return Math.max(source.trimStart ?? 0, end - 0.08);
}
