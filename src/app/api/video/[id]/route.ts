/* One video: the project, its latest plan, every version, its references,
   whether the engines its plan needs are connected, and the current render —
   each job's clip or voice line as a short-lived signed URL. */

import { NextResponse } from "next/server";

import { readiness } from "@/lib/video/engines";
import type { ProductionPlan } from "@/lib/video/plan";
import { STALE_AFTER_MS } from "@/lib/video/render";

import { videoSession } from "../shared";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase } = session;

  const { data: video } = await supabase.from("video_projects").select("*").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });

  const [{ data: versions }, { data: assets }, { data: renderRows }] = await Promise.all([
    supabase.from("video_versions").select("version, plan, issues, note, created_at").eq("video_id", id).order("version", { ascending: false }).limit(30),
    supabase.from("video_assets").select("id, kind, storage_path, mime").eq("video_id", id).order("created_at"),
    supabase.from("video_renders").select("id, scene, engine, status, output_path, error, updated_at").eq("video_id", id).eq("version", video.current_version),
  ]);

  /* A job that never reported is not coming: n8n stops an execution at 180s. */
  const now = Date.now();
  const stale = (renderRows ?? []).filter((row) => row.status === "running" && now - new Date(row.updated_at).getTime() > STALE_AFTER_MS);
  for (const row of stale) {
    await supabase.from("video_renders").update({ status: "failed", error: "Timed out — the render job never reported back." }).eq("id", row.id);
    row.status = "failed";
    row.error = "Timed out — the render job never reported back.";
  }
  let status = video.status as string;
  if (stale.length && !(renderRows ?? []).some((row) => row.status === "running")) {
    status = (renderRows ?? []).some((row) => row.engine === "video" && row.status === "done") ? "ready" : "failed";
    await supabase.from("video_projects").update({ status }).eq("id", id);
  }

  const renders = await Promise.all(
    (renderRows ?? []).map(async (row) => {
      let url: string | null = null;
      if (row.output_path?.startsWith("storage:")) {
        const { data } = await supabase.storage.from("video-assets").createSignedUrl(row.output_path.slice(8), 60 * 60);
        url = data?.signedUrl ?? null;
      } else if (row.output_path?.startsWith("https://")) {
        url = row.output_path;
      }
      return { scene: row.scene, engine: row.engine, status: row.status, error: row.error, url };
    }),
  );

  const latest = versions?.[0] ?? null;
  return NextResponse.json({
    video: { ...video, status },
    latest,
    versions: (versions ?? []).map(({ version, note, created_at }) => ({ version, note, created_at })),
    assets: assets ?? [],
    readiness: latest ? readiness(latest.plan as ProductionPlan) : null,
    renders,
  });
}
