/* The picture on a flier's or a video's tile — Continue working, Projects.
 *
 * A website's tile is the page itself, drawn small (PageThumbnail). A flier
 * or a video has no page to draw, so its tile is its own media:
 *
 *   flier   the newest version's first image
 *   video   the first scene's clip once one has landed, else the creator
 *           keyframe, else nothing (the tile keeps its colour)
 *
 * Answers { kind: "image" | "video", url } with a short-lived signed link, or
 * { kind: null }. Read under the caller's own session, so RLS decides. */

import { NextResponse } from "next/server";

import { liveOutputs, type Output } from "@/lib/flyers/trash";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const none = () => NextResponse.json({ kind: null, url: null }, { headers: { "Cache-Control": "private, max-age=60" } });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return none();
  const { data: project } = await supabase.from("projects").select("id, intent").eq("id", id).maybeSingle<{ id: string; intent: string | null }>();
  if (!project) return NextResponse.json({ error: "No such project." }, { status: 404 });
  const ok = (kind: "image" | "video", url: string) =>
    NextResponse.json({ kind, url }, { headers: { "Cache-Control": "private, max-age=300" } });

  if (project.intent === "flier") {
    const { data: jobs } = await supabase
      .from("flyer_jobs")
      .select("outputs")
      .eq("site_id", id)
      .eq("stage", "preview")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<{ outputs: Output[] | null }[]>();
    const path = (jobs ?? []).map((job) => liveOutputs(job.outputs)[0]?.path).find(Boolean);
    if (!path) return none();
    const { data } = await supabase.storage.from("flyers").createSignedUrl(path, 60 * 60);
    return data?.signedUrl ? ok("image", data.signedUrl) : none();
  }

  if (project.intent === "video") {
    const { data: video } = await supabase
      .from("video_projects")
      .select("id, current_version")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; current_version: number }>();
    if (!video) return none();
    const { data: clips } = await supabase
      .from("video_renders")
      .select("scene, output_path")
      .eq("video_id", video.id)
      .eq("version", video.current_version)
      .in("engine", ["video", "avatar"])
      .eq("status", "done")
      .order("scene")
      .limit(1);
    const clip = clips?.[0]?.output_path as string | undefined;
    if (clip?.startsWith("https://")) return ok("video", clip);
    if (clip?.startsWith("storage:")) {
      const { data } = await supabase.storage.from("video-assets").createSignedUrl(clip.slice(8), 60 * 60);
      if (data?.signedUrl) return ok("video", data.signedUrl);
    }
    const { data: still } = await supabase
      .from("video_assets")
      .select("storage_path")
      .eq("video_id", video.id)
      .eq("kind", "render")
      .like("mime", "image/%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ storage_path: string }>();
    if (still) {
      const { data } = await supabase.storage.from("video-assets").createSignedUrl(still.storage_path, 60 * 60);
      if (data?.signedUrl) return ok("image", data.signedUrl);
    }
    return none();
  }

  return none();
}
