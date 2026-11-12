/* An upload, made ready for the timeline — run once, in its own route
 * (/api/video/[id]/assets/prepare) with its own time budget.
 *
 *   probe     its real length, size, rotation and whether it has sound —
 *             what ffmpeg reads, not what the browser guessed
 *   clip      a working copy every cut reads the same way (media-files.ts
 *             workingCopyArgs) and a poster frame
 *   sound     its length
 *   picture   its size; the picture is its own poster
 *
 * A clip whose working copy cannot be made is still usable: the cut reads
 * the file as uploaded. A file ffmpeg cannot read at all is marked failed,
 * with the reason. Never throws.
 *
 * Server-only. */

import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import { chargeCredits } from "@/lib/credits-server";

import { LIMITS, formatSeconds } from "./assets";
import { prepareCredits } from "./pricing";
import { downloadTo, inspect, posterArgs, runFfmpeg, workingCopyArgs } from "./media-files";

export async function prepareAsset(service: SupabaseClient, assetId: string): Promise<void> {
  const dir = `/tmp/qs-asset-${assetId}-${Date.now()}`;
  const fail = (error: string) =>
    service.from("video_assets").update({ status: "failed", error: error.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", assetId);
  try {
    const { data: asset } = await service.from("video_assets").select("id, kind, storage_path, status, user_id, name").eq("id", assetId).maybeSingle();
    if (!asset) return;
    const { data: signed } = await service.storage.from("video-assets").createSignedUrl(asset.storage_path as string, 60 * 60);
    if (!signed?.signedUrl) {
      await fail("The upload could not be found in storage.");
      return;
    }
    await mkdir(dir, { recursive: true });
    const source = join(dir, "source");
    if (!(await downloadTo(signed.signedUrl, source))) {
      await fail("The upload could not be read back from storage.");
      return;
    }
    const found = await inspect(source);
    const kind = asset.kind as string;
    const now = new Date().toISOString();

    if (kind === "audio") {
      if (!found.hasAudio || found.seconds <= 0) {
        await fail("This file has no sound we can read. Try an MP3, WAV or M4A.");
        return;
      }
      await service.from("video_assets").update({ status: "ready", error: null, duration_s: round(found.seconds), has_audio: true, updated_at: now }).eq("id", assetId);
      await charge(service, asset);
      return;
    }

    if (kind !== "video") {
      if (!found.hasVideo) {
        await fail("This picture could not be read. Try a PNG, JPG or WebP.");
        return;
      }
      await service
        .from("video_assets")
        .update({ status: "ready", error: null, width: found.width, height: found.height, poster_path: asset.storage_path, updated_at: now })
        .eq("id", assetId);
      await charge(service, asset);
      return;
    }

    if (!found.hasVideo || found.seconds <= 0) {
      await fail("This file has no video we can read. Try an MP4 or MOV.");
      return;
    }
    if (found.seconds > LIMITS.video.seconds + 0.5) {
      await fail(`Clips can be up to ${LIMITS.video.seconds / 60} minutes; this one runs ${formatSeconds(found.seconds)}. Trim it, or split it into parts.`);
      return;
    }

    const base = (asset.storage_path as string).replace(/\/[^/]+$/, "");
    const work = join(dir, "work.mp4");
    const poster = join(dir, "poster.jpg");
    let workingPath: string | null = null;
    let posterPath: string | null = null;
    try {
      await runFfmpeg(workingCopyArgs({ source, out: work, hasAudio: found.hasAudio }), 270_000);
      if ((await stat(work)).size > 0) {
        const path = `${base}/work-${assetId}.mp4`;
        const { error } = await service.storage.from("video-assets").upload(path, await readFile(work), { contentType: "video/mp4", upsert: true });
        if (!error) workingPath = path;
      }
      /* The source is no longer needed once the copy is stored. */
      if (workingPath) await rm(source, { force: true });
    } catch {
      /* The cut reads the upload as it is. */
    }
    try {
      await runFfmpeg(posterArgs({ source: workingPath ? work : source, out: poster, at: Math.min(1, found.seconds / 2) }), 30_000);
      const path = `${base}/poster-${assetId}.jpg`;
      const { error } = await service.storage.from("video-assets").upload(path, await readFile(poster), { contentType: "image/jpeg", upsert: true });
      if (!error) posterPath = path;
    } catch {
      /* No poster: the studio shows the kind's icon. */
    }
    await service
      .from("video_assets")
      .update({
        status: "ready",
        error: null,
        duration_s: round(found.seconds),
        width: found.width,
        height: found.height,
        has_audio: found.hasAudio,
        working_path: workingPath,
        poster_path: posterPath,
        updated_at: new Date().toISOString(),
      })
      .eq("id", assetId);
    await charge(service, asset);
  } catch (error) {
    await fail(error instanceof Error ? `It could not be prepared: ${error.message}` : "It could not be prepared.");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/* A prepared upload is charged once, by its kind. A failed one never is. */
async function charge(service: SupabaseClient, asset: { id: unknown; kind: unknown; user_id: unknown; name: unknown }) {
  await chargeCredits(service, {
    userId: String(asset.user_id),
    action: "generate",
    cost: prepareCredits(String(asset.kind)),
    description: `Upload prepared: ${String(asset.name || asset.kind).slice(0, 80)}`,
    dedupeKey: `video-prepare:${String(asset.id)}`,
  });
}
