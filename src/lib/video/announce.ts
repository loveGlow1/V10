/* "Your video is ready" — in the workspace chat, with the video in it.
 *
 * Said once per version, whichever way the final cut was made (fal's compose
 * or this server's, compose-local.ts). The message carries the MP4 as a
 * "video:" link to this app's own file route, which MessageRow draws as a
 * player with a Download button — the way a flier's images are drawn. The
 * link is the app's, not a signed storage address, so it keeps working in a
 * thread read next month.
 *
 * Server-only; runs under the service key. Never throws. */

import type { SupabaseClient } from "@supabase/supabase-js";

/** The final cut on this app's file route; with download, saved as an MP4 file. Pure. */
export const finalVideoUrl = (origin: string, videoId: string, version: number, download = false) =>
  `${origin}/api/video/${videoId}/file?v=${version}${download ? "&download=1" : ""}`;

export async function announceFinal(service: SupabaseClient, input: { videoId: string; version: number; origin: string; scenes?: number }): Promise<void> {
  try {
    const { data: video } = await service.from("video_projects").select("user_id, title, project_id").eq("id", input.videoId).maybeSingle();
    if (!video?.project_id) return;
    await service.from("projects").update({ last_build_at: new Date().toISOString() }).eq("id", video.project_id);
    const scenes = input.scenes ? `${input.scenes} scenes joined in order, with the voice and on-screen words. ` : "";
    await service.from("project_messages").insert({
      project_id: video.project_id,
      user_id: video.user_id,
      role: "system",
      body: `Your video is ready as one MP4 — ${scenes}Play it here or in the preview, and Download saves the file. Tell me anything to change.`,
      links: [{ label: "video:1", href: finalVideoUrl(input.origin, input.videoId, input.version) }],
      tone: "normal",
      kind: "build_ready",
      dedupe_key: `video-final:${input.videoId}:${input.version}`,
    });
  } catch {
    /* The video is ready either way; the message is a courtesy. */
  }
}
