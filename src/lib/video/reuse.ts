/* What has already been made for a video, in any of its versions, by content.
 *
 * A clip is the scene's picture (pictureKey): the same upload, or the same
 * generated prompt, engine and cast. A voice line is the same words in the
 * same voice (voiceKey). Once made, a clip or line is never made again for a
 * plan that asks for exactly the same thing — whichever version made it,
 * whatever number the scene had there:
 *
 *   - the studio's timeline shows it (state.ts → segmentsFor), instead of
 *     "Made on export";
 *   - a render of a re-planned version files it as it is (start-render.ts),
 *     free, and films only what is really new.
 *
 * Pure. */

import { continuityLinks } from "./continuity";
import { pictureKey, voiceKey } from "./editor-timeline";
import type { ProductionPlan } from "./plan";

export type MadeRow = { version: number; scene: number | null; engine: string; status: string; provider: string | null; output_path: string | null };

export type Library = { pictures: Map<string, MadeRow>; voices: Map<string, MadeRow> };

/** Every made clip and voice line by content, the preferred version first, then the newest. Pure. */
export function madeLibrary(plans: Map<number, ProductionPlan>, rows: MadeRow[], prefer?: number): Library {
  const pictures = new Map<string, MadeRow>();
  const voices = new Map<string, MadeRow>();
  const ordered = rows
    .filter((row) => row.status === "done" && row.output_path && row.scene !== null && (row.engine === "video" || row.engine === "avatar" || row.engine === "voice"))
    .sort((a, b) => (a.version === prefer ? -1 : b.version === prefer ? 1 : b.version - a.version));
  for (const row of ordered) {
    const plan = plans.get(row.version);
    const scene = plan?.scenes?.find((s) => s.n === row.scene);
    if (!plan || !scene) continue;
    if (row.engine === "voice") {
      if (!scene.voiceover?.trim() && !scene.voiceAsset) continue;
      const key = voiceKey(plan, scene);
      if (!voices.has(key)) voices.set(key, row);
    } else if (!scene.source) {
      /* Uploads are filed from the upload itself; only generated clips are kept here. */
      const key = pictureKey(scene);
      if (!pictures.has(key)) pictures.set(key, row);
    }
  }
  return { pictures, voices };
}

/**
 * Which of a plan's jobs are already made: the rows to file under the new
 * version, and the jobs still to send. A scene filmed from the last frame of
 * the scene before is only reused when that scene is reused too — otherwise
 * it would no longer follow on. Pure.
 */
export function reuseMade<J extends { kind: "clip" | "voice"; n: number }>(
  plan: ProductionPlan,
  jobs: J[],
  library: Library,
): { reused: { scene: number; engine: string; provider: string | null; output_path: string }[]; remaining: J[] } {
  const links = continuityLinks(plan);
  const reusedClip = new Set<number>();
  const reused: { scene: number; engine: string; provider: string | null; output_path: string }[] = [];
  const remaining: J[] = [];
  const clipJobs = new Set(jobs.filter((job) => job.kind === "clip").map((job) => job.n));
  /* In scene order, so a link's earlier scene is decided first. */
  const sorted = [...jobs].sort((a, b) => a.n - b.n);
  for (const job of sorted) {
    const scene = plan.scenes.find((s) => s.n === job.n);
    if (!scene) {
      remaining.push(job);
      continue;
    }
    if (job.kind === "clip") {
      const before = links.get(job.n);
      const followsOn = before === undefined || !clipJobs.has(before) || reusedClip.has(before);
      const row = followsOn ? library.pictures.get(pictureKey(scene)) : undefined;
      if (row?.output_path) {
        reusedClip.add(job.n);
        reused.push({ scene: job.n, engine: row.engine, provider: row.provider, output_path: row.output_path });
      } else remaining.push(job);
    } else {
      const row = library.voices.get(voiceKey(plan, scene));
      if (row?.output_path) reused.push({ scene: job.n, engine: "voice", provider: row.provider, output_path: row.output_path });
      else remaining.push(job);
    }
  }
  return { reused, remaining: jobs.filter((job) => remaining.includes(job)) };
}
