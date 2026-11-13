/* One video: the project, its latest plan, every version, its references,
   whether the engines its plan needs are connected, and the current render —
   each job's clip or voice line as a short-lived signed URL. */

import { partOf, partPath, readPartsOutput } from "./chapters";
import { EXPORT_LABEL, exportPath, exportsFor } from "@/lib/video/exports";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { parseProvider } from "@/lib/video/clip-engines";
import { readiness, renderCost } from "@/lib/video/engines";
import { clipStatus } from "@/lib/video/providers";
import { advance, lineTaskOf } from "@/lib/video/production";
import { settleRunwareLineJob } from "@/lib/video/line-results";
import { awaitedScene } from "@/lib/video/continuity";
import { releaseWaiting } from "@/lib/video/continuity-release";
import { announceFinal } from "@/lib/video/announce";
import { landResult, retryClip } from "@/lib/video/results";
import type { ProductionPlan } from "@/lib/video/plan";
import { FAL_STALE_AFTER_MS, STALE_AFTER_MS } from "@/lib/video/render";


/* A clip engine's webhook can be lost. A clip that has been running this long
   without a word is asked about directly, at most one poll per minute. */
const ASK_AFTER_MS = 60 * 1000;
/* Seedance and Kling at 1080p can take minutes; they get fal's allowance. */
const DIRECT_STALE_AFTER_MS = 25 * 60 * 1000;
/* An upload's preparation runs in one 300s function; past this it is not coming. */
const PREPARE_STALE_MS = 8 * 60 * 1000;

/** One video's whole state, recovering quiet clips on the way. The studio reads it under the person's session; the workspace preview through its board token. */
export async function videoState(supabase: SupabaseClient, id: string, origin: string): Promise<NextResponse> {
  const { data: video } = await supabase.from("video_projects").select("*").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });

  const [{ data: versions }, { data: assets }, { data: renderRows }] = await Promise.all([
    supabase.from("video_versions").select("version, plan, issues, note, created_at").eq("video_id", id).order("version", { ascending: false }).limit(30),
    supabase
      .from("video_assets")
      .select("id, kind, storage_path, mime, name, status, error, source, duration_s, width, height, has_audio, working_path, poster_path, updated_at, created_at")
      .eq("video_id", id)
      .order("created_at"),
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

  /* The same for the production line's Runware jobs (lip sync, avatar,
     music): a lost webhook is recovered by asking Runware. */
  const quietLine = (renderRows ?? []).filter(
    (row) => service && row.status === "running" && lineTaskOf(row.provider) && Date.now() - new Date(row.updated_at).getTime() > ASK_AFTER_MS,
  );
  if (service && quietLine.length) {
    const version = video.current_version as number;
    await Promise.all(
      quietLine.slice(0, 6).map(async (row) => {
        if (row.engine !== "avatar" && row.engine !== "music") return;
        const result = await settleRunwareLineJob(service, { videoId: id, version, job: { engine: row.engine, scene: row.scene }, provider: row.provider, origin });
        /* Not yet — asked again in a minute, until fal's allowance runs out
           and the stale check below calls it. */
        if (result === "running" && Date.now() - new Date(row.created_at).getTime() < FAL_STALE_AFTER_MS) {
          await service.from("video_renders").update({ updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "running");
        }
      }),
    );
    const { data: fresh } = await supabase.from("video_renders").select("id, scene, engine, provider, status, output_path, error, updated_at, created_at").eq("video_id", id).eq("version", video.current_version);
    if (fresh) renderRows?.splice(0, renderRows.length, ...fresh);
  }

  /* A scene waiting on the one before, when that one has finished or failed
     but the hand-off was lost: handed on now. */
  if (service) {
    const rows = renderRows ?? [];
    for (const row of rows) {
      const before = awaitedScene(row.provider);
      if (row.status !== "queued" || before === null || Date.now() - new Date(row.updated_at).getTime() < 90_000) continue;
      const prev = rows.find((r) => r.scene === before && r.engine === "video");
      if (!prev || prev.status === "done" || prev.status === "failed") {
        await service.from("video_renders").update({ updated_at: new Date().toISOString() }).eq("id", row.id).eq("status", "queued");
        await releaseWaiting(service, { videoId: id, version: video.current_version as number, n: before, origin });
      }
    }
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

  /* Uploads, each with a link to play it and its poster. One whose
     preparation never reported (a function stopped mid-way) is usable as
     uploaded, with what the browser measured. */
  const studioAssets = await Promise.all(
    (assets ?? []).map(async (asset) => {
      let status = asset.status as string;
      if (status === "processing" && Date.now() - new Date(asset.updated_at ?? asset.created_at).getTime() > PREPARE_STALE_MS) {
        status = "ready";
        await supabase.from("video_assets").update({ status, updated_at: new Date().toISOString() }).eq("id", asset.id).eq("status", "processing");
      }
      const sign = async (path: string | null | undefined) => {
        if (!path) return null;
        const { data } = await supabase.storage.from("video-assets").createSignedUrl(path, 60 * 60);
        return data?.signedUrl ?? null;
      };
      const isMedia = asset.kind !== "render";
      return {
        id: asset.id,
        kind: asset.kind,
        storage_path: asset.storage_path,
        mime: asset.mime,
        name: asset.name ?? "",
        /* "generated" for sound made in the editor; "upload" for the person's own. */
        source: asset.source ?? "upload",
        status,
        error: asset.error ?? null,
        durationS: asset.duration_s === null || asset.duration_s === undefined ? null : Number(asset.duration_s),
        width: asset.width ?? null,
        height: asset.height ?? null,
        hasAudio: asset.has_audio ?? null,
        url: isMedia ? await sign(asset.working_path ?? asset.storage_path) : null,
        posterUrl: isMedia ? await sign(asset.poster_path ?? (asset.kind === "video" || asset.kind === "audio" || asset.kind === "document" ? null : asset.storage_path)) : null,
      };
    }),
  );

  /* A long film whose single file could not be stored: its parts, in order. */
  const keptAsParts = readPartsOutput((renderRows ?? []).find((row) => row.engine === "compose" && row.status === "done")?.output_path);
  /* Each part where it really is: a part reused from an earlier version
     (chapters.ts) lives under that version's files. */
  const partRows = (renderRows ?? [])
    .filter((row) => row.engine === "part" && row.status === "done" && row.output_path?.startsWith("storage:"))
    .map((row) => ({ k: partOf(row.provider as string) ?? 0, path: (row.output_path as string).slice(8) }))
    .sort((a, b) => a.k - b.k);
  const parts = keptAsParts
    ? (
        await Promise.all(
          (partRows.length ? partRows.map((row) => row.path) : Array.from({ length: keptAsParts.count }, (_, i) => partPath(keptAsParts.base, i + 1))).map(async (path) => {
            const { data } = await supabase.storage.from("video-assets").createSignedUrl(path, 60 * 60);
            return data?.signedUrl ?? null;
          }),
        )
      ).filter((url): url is string => Boolean(url))
    : [];

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
    assets: studioAssets,
    readiness: latest ? readiness(latest.plan as ProductionPlan) : null,
    /* Worked out here, where FAL_KEY is visible: the button shows it. */
    cost: latest ? renderCost(latest.plan as ProductionPlan, process.env, ((video.answers ?? {}) as Record<string, string>).quality ?? null) : 0,
    renders,
    /* The one-file cut, when fal has composed it. */
    final: renders.find((row) => row.engine === "compose" && row.status === "done")?.url ?? parts[0] ?? null,
    /* A long film kept as its parts (chapters.ts): played one after another. */
    parts,
    exports,
  });
}
