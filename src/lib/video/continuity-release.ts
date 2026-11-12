/* Releasing scenes that wait for the one before (continuity.ts): when a
 * scene's clip lands — or finally fails — every scene waiting on it is handed
 * to /api/video/[id]/render/continue, which takes the last frame and films it.
 * In a route of its own because that route carries ffmpeg; this one does not.
 *
 * Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";

import { awaitProvider } from "./continuity";
import { falToken } from "./fal";

export const continueUrl = (origin: string, videoId: string, version: number, n: number) =>
  `${origin}/api/video/${videoId}/render/continue?v=${version}&scene=${n}&t=${falToken(videoId, version, `continue:${n}`)}`;

/** Starts every scene of a version that waits for scene `n`. Never throws. */
export async function releaseWaiting(service: SupabaseClient, input: { videoId: string; version: number; n: number; origin: string }): Promise<number> {
  try {
    const { data } = await service
      .from("video_renders")
      .select("scene")
      .eq("video_id", input.videoId)
      .eq("version", input.version)
      .eq("engine", "video")
      .eq("status", "queued")
      .eq("provider", awaitProvider(input.n));
    let started = 0;
    for (const row of data ?? []) {
      if (row.scene === null) continue;
      const answer = await fetch(continueUrl(input.origin, input.videoId, input.version, row.scene as number), {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      }).catch(() => null);
      if (answer?.ok) started += 1;
    }
    return started;
  } catch {
    return 0;
  }
}
