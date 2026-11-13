/* The look of the person's own footage, carried into every generated scene.
 *
 * A clip (or picture) the person marks as a reference (plan.referenceClips)
 * lends its frames — three taken across each clip when it was prepared
 * (prepare-asset.ts) — to every generated scene as extra reference pictures,
 * after the characters' own, with a line in the prompt saying what they are
 * for: the same setting, light, colour and people. So a film that mixes the
 * person's footage with generated scenes reads as one film.
 *
 * Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProductionPlan } from "./plan";

/** What the prompt says when the look frames are sent. */
export const LOOK_NOTE = "Match the setting, lighting, colour and people of the reference frames taken from the person's own footage.";

/** The most look frames a scene is sent, so the characters' pictures always come first. */
export const MAX_LOOK_FRAMES = 3;

/** Which of a clip's stored frames to send: the middle first. Pure. */
export function pickFrames(frames: readonly string[], room: number): string[] {
  const order = frames.length === 3 ? [frames[1], frames[0], frames[2]] : [...frames];
  return order.slice(0, Math.max(0, room));
}

/** Signed links to the look frames of the plan's reference clips. Empty when there are none. */
export async function lookFrames(service: SupabaseClient, plan: Pick<ProductionPlan, "referenceClips">): Promise<string[]> {
  const ids = plan.referenceClips ?? [];
  if (!ids.length) return [];
  const { data } = await service.from("video_assets").select("id, kind, storage_path, analysis, status").in("id", ids);
  const paths: string[] = [];
  for (const id of ids) {
    const asset = (data ?? []).find((row) => row.id === id);
    if (!asset || asset.status === "failed") continue;
    const room = MAX_LOOK_FRAMES - paths.length;
    if (room <= 0) break;
    if (asset.kind === "video") {
      const frames = Array.isArray((asset.analysis as { frames?: unknown } | null)?.frames) ? ((asset.analysis as { frames: unknown[] }).frames.filter((f) => typeof f === "string") as string[]) : [];
      paths.push(...pickFrames(frames, ids.length === 1 ? room : 1));
    } else if (asset.kind !== "audio" && asset.kind !== "document") {
      paths.push(asset.storage_path as string);
    }
  }
  const urls: string[] = [];
  for (const path of paths) {
    const { data: signed } = await service.storage.from("video-assets").createSignedUrl(path, 60 * 60 * 6);
    if (signed?.signedUrl) urls.push(signed.signedUrl);
  }
  return urls;
}
