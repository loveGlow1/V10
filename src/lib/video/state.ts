/* One video: the project, its latest plan, every version, its references,
   whether the engines its plan needs are connected, and the current render —
   each job's clip or voice line as a short-lived signed URL. */

import { EXPORT_LABEL, exportPath, exportsFor } from "@/lib/video/exports";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { parseProvider } from "@/lib/video/clip-engines";
import { readiness, renderCost } from "@/lib/video/engines";
import { clipStatus } from "@/lib/video/providers";
import { advance } from "@/lib/video/production";
import { announceFinal } from "@/lib/video/announce";
import { landResult, retryClip } from "@/lib/video/results";
import type { ProductionPlan } from "@/lib/video/plan";
import { FAL_STALE_AFTER_MS, STALE_AFTER_MS } from "@/lib/video/render";


/* A clip engine's webhook can be lost. A clip that has been running this long
   without a word is asked about directly, at most one poll per minute. */
const ASK_AFTER_MS = 60 * 1000;
/* Seedance and Kling at 1080p can take minutes; they get fal's allowance. */
const DIRECT_STALE_AFTER_MS = 25 * 60 * 1000;

/** One video's whole state, recovering quiet clips on the way. The studio reads it under the person's session; the workspace preview through its board token. */
export async function videoState(supabase: SupabaseClient, id: string, origin: string): Promise<NextResponse> {
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
      const handedOn = await retryClip(service, { videoId: id, version: video.current_version as number, n: row.scene, failed: "n8n", origin: origin });
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

  /* A finished render with no final cut yet — its last result arrived before
     the cut could be started, or before cuts were made here at all — gets one
     now. advance claims the compose row, so asking twice starts it once. */
  const rowsNow = renderRows ?? [];
  if (
    service &&
    rowsNow.length > 0 &&
    !rowsNow.some((row) => row.status === "running" || row.status === "queued" || row.engine === "compose") &&
    rowsNow.some((row) => (row.engine === "video" || row.engine === "avatar") && row.status === "done")
  ) {
    await advance(service, id, video.current_version as number, origin);
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

  /* The version playing — after Undo an earlier one than the newest. */
  /* A cut that is made but was never put in the chat — made outside the
     usual path, or before announcing existed — is put there now, once. */
  const finalRow = renders.find((row) => row.engine === "compose" && row.status === "done");
  if (service && finalRow && video.project_id) {
    const key = `video-final:${id}:${video.current_version}`;
    const { data: told } = await service.from("project_messages").select("id").eq("project_id", video.project_id).eq("dedupe_key", key).limit(1).maybeSingle();
    if (!told) await announceFinal(service, { videoId: id, version: video.current_version as number, origin });
  }

  const latest = versions?.find((row) => row.version === video.current_version) ?? versions?.[0] ?? null;

  /* The ready-to-post versions made beside the cut (compose-local.ts). */
  const cutPath = (renderRows ?? []).find((row) => row.engine === "compose" && row.status === "done")?.output_path;
  const exports = cutPath?.startsWith("storage:") && latest
    ? (
        await Promise.all(
          exportsFor((latest.plan as ProductionPlan).aspect).map(async (kind) => {
            const { data } = await supabase.storage.from("video-assets").createSignedUrl(exportPath(cutPath.slice(8), kind), 60 * 60);
            return data?.signedUrl ? { kind, label: EXPORT_LABEL[kind], url: data.signedUrl } : null;
          }),
        )
      ).filter(Boolean)
    : [];
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
    exports,
  });
}
