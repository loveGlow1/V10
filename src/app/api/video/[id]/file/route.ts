/* A video's final MP4, for its owner.
 *
 *   ?v=2              the cut, to play — the chat's player and the preview
 *   ?v=2&download=1   the same file saved as "<title>.mp4"
 *   &format=feed      a ready-to-post version made beside it (vertical, feed,
 *                     whatsapp — lib/video/exports.ts)
 *
 * Answers with a redirect to a short-lived signed storage link (storage
 * serves byte ranges, which a phone's player needs), made only after the
 * caller's own session has read the video — RLS returns only their videos. */

import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { exportPath, isExportKind } from "@/lib/video/exports";

export const dynamic = "force-dynamic";

const fileName = (title: string, suffix = "") => `${(title || "video").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "video"}${suffix}.mp4`;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return new Response("Not found", { status: 404 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in first", { status: 401 });

  const { data: video } = await supabase.from("video_projects").select("id, title, current_version").eq("id", id).maybeSingle();
  if (!video) return new Response("Not found", { status: 404 });
  const version = Number(url.searchParams.get("v")) || (video.current_version as number);
  const { data: cut } = await supabase
    .from("video_renders")
    .select("output_path")
    .eq("video_id", id)
    .eq("version", version)
    .eq("engine", "compose")
    .eq("status", "done")
    .maybeSingle<{ output_path: string | null }>();
  const output = cut?.output_path;
  if (!output) return new Response("Not ready", { status: 404 });
  if (output.startsWith("https://")) return NextResponse.redirect(output, 302);

  const download = url.searchParams.get("download") === "1";
  const format = url.searchParams.get("format");
  const kind = isExportKind(format) ? format : null;
  const path = output.replace(/^storage:/, "");
  const { data } = await supabase.storage
    .from("video-assets")
    .createSignedUrl(kind ? exportPath(path, kind) : path, 60 * 60, download ? { download: fileName(video.title as string, kind ? `-${kind}` : "") } : undefined);
  if (!data?.signedUrl) return new Response("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
