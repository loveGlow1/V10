/* Where fal reports a finished job — lip sync, avatar, music or the final
 * compose (lib/video/fal.ts, production.ts).
 *
 * No session: fal is calling. The address carries an HMAC token for exactly
 * this video, version and job, and fal signs the request (Ed25519) as well;
 * a bad token, or a signature that is present and wrong, is refused. Then the
 * media is copied into private storage (fal's URLs are not permanent), the
 * row is marked, a delivered job is charged once, and the production line is
 * advanced. A finished compose finishes the video. */

import { NextResponse } from "next/server";

import { chargeCredits } from "@/lib/credits-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { AVATAR_COST, COMPOSE_COST, LIPSYNC_COST, MUSIC_COST } from "@/lib/video/engines";
import { outputUrl, parseJobKey, verifyFalSignature, verifyFalToken } from "@/lib/video/fal";
import { advance } from "@/lib/video/production";

export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const version = Number(url.searchParams.get("v"));
  const key = url.searchParams.get("job");
  const job = parseJobKey(key);
  if (!job || !Number.isInteger(version) || !verifyFalToken(id, version, key ?? "", url.searchParams.get("t"))) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const raw = await request.text();
  if ((await verifyFalSignature(request.headers, raw)) === "invalid") {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }
  const body = (JSON.parse(raw || "{}") ?? {}) as { status?: string; payload?: unknown; error?: string; payload_error?: string };

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });
  const { data: video } = await service.from("video_projects").select("id, user_id, title, pipeline").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });

  const media = body.status === "OK" ? outputUrl(body.payload) : null;
  let output: string | null = media;
  if (media) {
    try {
      const file = await fetch(media, { signal: AbortSignal.timeout(60000) });
      if (file.ok) {
        const ext = job.engine === "music" ? "mp3" : "mp4";
        const name = job.engine === "compose" ? `final.${ext}` : job.engine === "music" ? `music.${ext}` : `avatar-${job.scene}.${ext}`;
        const path = `${video.user_id}/${id}/v${version}/${name}`;
        const type = file.headers.get("content-type") ?? (ext === "mp3" ? "audio/mpeg" : "video/mp4");
        const { error } = await service.storage.from("video-assets").upload(path, await file.arrayBuffer(), { contentType: type, upsert: true });
        if (!error) output = `storage:${path}`;
      }
    } catch {
      /* Keep fal's URL; it plays until it expires. */
    }
  }

  const failure = media
    ? null
    : String(body.error ?? body.payload_error ?? "fal returned no media.").slice(0, 2000);
  const update = service
    .from("video_renders")
    .update({ status: media ? "done" : "failed", output_path: output, error: failure, updated_at: new Date().toISOString() })
    .eq("video_id", id)
    .eq("version", version)
    .eq("engine", job.engine);
  await (job.scene === null ? update.is("scene", null) : update.eq("scene", job.scene));

  if (media) {
    const cost =
      job.engine === "compose" ? COMPOSE_COST : job.engine === "music" ? MUSIC_COST : video.pipeline === "clone" ? AVATAR_COST : LIPSYNC_COST;
    await chargeCredits(service, {
      userId: video.user_id,
      action: "generate",
      cost,
      description: `Video ${job.engine}${job.scene ? ` ${job.scene}` : ""}: ${video.title}`,
      dedupeKey: `video-fal:${id}:${version}:${key}`,
    });
  }

  if (job.engine === "compose") {
    if (media && output?.startsWith("storage:")) {
      await service.from("video_assets").insert({ video_id: id, user_id: video.user_id, kind: "render", storage_path: output.slice(8), mime: "video/mp4" });
    }
    /* The scenes are what the cut is made of; a failed compose still leaves
       a playable video in the studio. */
    await service.from("video_projects").update({ status: "ready" }).eq("id", id);
  } else {
    await advance(service, id, version, url.origin);
    const { data: rows } = await service.from("video_renders").select("engine, status").eq("video_id", id).eq("version", version);
    const open = (rows ?? []).some((row) => row.status === "running" || row.status === "queued");
    if (!open) {
      const pictures = (rows ?? []).some((row) => (row.engine === "video" || row.engine === "avatar") && row.status === "done");
      await service.from("video_projects").update({ status: pictures ? "ready" : "failed" }).eq("id", id);
    }
  }
  return NextResponse.json({ ok: true });
}
