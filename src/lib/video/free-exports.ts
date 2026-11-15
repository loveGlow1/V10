/* Three free tries of "Edit my clips": every account's first three videos
 * made only of its own clips export free — every export of those videos —
 * once, for good (supabase free_exports; deleting a video does not give its
 * free export back). After that an own-clips export costs half a credit per
 * started minute (pricing.ts). Generated work — clips, voices, music — is
 * never covered. */

import type { SupabaseClient } from "@supabase/supabase-js";

import { FREE_OWN_EXPORTS, ownClipsOnly, ownCutCredits } from "./pricing";

export type FreeExports = {
  /** Free own-clips videos the account has left. */
  left: number;
  /** This video already used one: all its exports are free. */
  thisVideo: boolean;
};

/** What is left of the free exports, and whether this video has one. Never throws. */
export async function freeExports(service: SupabaseClient, userId: string, videoId?: string): Promise<FreeExports> {
  try {
    const { data } = await service.from("free_exports").select("video_id").eq("user_id", userId);
    const rows = (data ?? []) as { video_id: string }[];
    return { left: Math.max(0, FREE_OWN_EXPORTS - rows.length), thisVideo: Boolean(videoId && rows.some((row) => row.video_id === videoId)) };
  } catch {
    return { left: 0, thisVideo: false };
  }
}

/** Whether this export would be free, without using a free export. */
export async function exportIsFree(service: SupabaseClient | null, userId: string, videoId: string, plan: { scenes: { source?: unknown }[] }): Promise<boolean> {
  if (!service || !ownClipsOnly(plan)) return false;
  const free = await freeExports(service, userId, videoId);
  return free.thisVideo || free.left > 0;
}

/** At delivery: uses a free export when there is one (cost 0), else the own-clips price. Only for own-clips videos. */
export async function ownExportCharge(service: SupabaseClient, userId: string, videoId: string, seconds: number): Promise<{ cost: number; free: boolean }> {
  const { data, error } = await service.rpc("claim_free_export", { p_user_id: userId, p_video_id: videoId, p_limit: FREE_OWN_EXPORTS });
  if (!error && data === true) return { cost: 0, free: true };
  return { cost: ownCutCredits(seconds), free: false };
}
