/* One video: the project, its latest plan, every version, its references,
   whether the engines its plan needs are connected, and the current render —
   each job's clip or voice line as a short-lived signed URL. */

import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { parseProvider } from "@/lib/video/clip-engines";
import { readiness, renderCost } from "@/lib/video/engines";
import { clipStatus } from "@/lib/video/providers";
import { landResult, retryClip } from "@/lib/video/results";
import type { ProductionPlan } from "@/lib/video/plan";
import { FAL_STALE_AFTER_MS, STALE_AFTER_MS } from "@/lib/video/render";

import { videoSession } from "../shared";

/* A clip engine's webhook can be lost. A clip that has been running this long
   without a word is asked about directly, at most one poll per minute. */
const ASK_AFTER_MS = 60 * 1000;
/* Seedance and Kling at 1080p can take minutes; they get fal's allowance. */
const DIRECT_STALE_AFTER_MS = 25 * 60 * 1000;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase } = session;

  const { data: video } = await supabase.from("video_projects").select("*").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });

  const [{ data: versions }, { data: assets }, { data: renderRows }] = await Promise.all([
    supabase.from("video_versions").select("version, plan, issues, note, created_at").eq("video_id", id).order("version", { ascending: false }).limit(30),
    supabase.from("video_assets").select("id, kind, storage_path, mime").eq("video_id", id).order("created_at"),
    supabase.from("video_renders").select("id, scene, engine, provider, status, output_path, error, updated_at, created_at").eq("video_id", id).eq("version", video.current_version),
  ]);

  /* Recovery: ask each quiet clip engine where its clip is, and land what it
     says. Only for the engines that can be asked (Higgsfield, MiniMax). */
  const service = createSupabaseServiceClient();
  const quiet = (renderRows ?? []).filter((row) => {
    const at = parseProvider(row.provider);
    return service && row.status === "running" && row.engine === "video" && at && at.engine !== "seedance-fal" && Date.now() - new Date(row.updated_at).getTime() > ASK_AFTER_MS;
  });
  if (service && quiet.length) {
    const origin = new URL(request.url).origin;
    await Promise.all(
      quiet.slice(0, 6).map(async (row) => {
        const at = parseProvider(row.provider);
        if (!at || row.scene === null) return;
        const state = await clipStatus(at.engine, at.id);
        const version = video.current_version as number;
        if (state.state === "running") {
          /* Not yet — and not asked again for another minute. */
          if (Date.now() - new Date(row.created_at).getTime() < DIRECT_STALE_AFTER_MS) {
            await service.from("video_renders").update({ updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "running");
          }
          return;
        }
        if (state.state === "failed" && (await retryClip(service, { videoId: id, version, n: row.scene, failed: at.engine, origin }))) return;
        await landResult(service, { videoId: id, version, kind: "clip", n: row.scene, url: state.state === "done" ? state.url : null, error: state.state === "failed" ? state.error : null, engine: at.engine, origin });
      }),
    );
    const { data: fresh } = await supabase.from("video_renders").select("id, scene, engine, provider, status, output_path, error, updated_at, created_at").eq("video_id", id).eq("version", video.current_version);
    if (fresh) renderRows?.splice(0, renderRows.length, ...fresh);
  }

  /* A job that never reported is not coming: n8n stops an execution at 180s. */
  const now = Date.now();
  const stale = (renderRows ?? []).filter(
    (row) =>
      row.status === "running" &&
      (parseProvider(row.provider)
        ? now - new Date(row.created_at).getTime() > DIRECT_STALE_AFTER_MS
        : now - new Date(row.updated_at).getTime() > (["avatar", "music", "compose"].includes(row.engine) ? FAL_STALE_AFTER_MS : STALE_AFTER_MS)),
  );
  for (const row of stale) {
    /* An n8n clip that never came back is handed to the next engine rather
       than failed: the usage credit was tried first, not instead. */
    if (service && row.engine === "video" && row.provider === "n8n:minimax" && row.scene !== null) {
      const handedOn = await retryClip(service, { videoId: id, version: video.current_version as number, n: row.scene, failed: "n8n", origin: new URL(request.url).origin });
      if (handedOn) continue;
    }
    await supabase.from("video_renders").update({ status: "failed", error: "Timed out — the render job never reported back." }).eq("id", row.id);
    row.status = "failed";
    row.error = "Timed out — the render job never reported back.";
  }
  let status = video.status as string;
  if (stale.length && !(renderRows ?? []).some((row) => row.status === "running")) {
    status = (renderRows ?? []).some((row) => (row.engine === "video" || row.engine === "avatar") && row.status === "done") ? "ready" : "failed";
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
    /* Worked out here, where FAL_KEY is visible: the button shows it. */
    cost: latest ? renderCost(latest.plan as ProductionPlan) : 0,
    renders,
    /* The one-file cut, when fal has composed it. */
    final: renders.find((row) => row.engine === "compose" && row.status === "done")?.url ?? null,
  });
}
