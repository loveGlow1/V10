/* Where each n8n render job reports back — one clip or one voice line.
 *
 * No session: n8n is calling. It proves itself twice — the shared webhook
 * token in X-QuickStark-Token, and a signature over this video, version and
 * owner that only /render could have made (lib/video/render.ts). Then:
 *
 *   1. the media is copied into the private video-assets bucket (provider
 *      URLs expire); if the copy fails the provider URL is kept;
 *   2. the job's row is marked done or failed;
 *   3. a delivered job is charged — once, by its dedupe key;
 *   4. when no job of the version is still running, the video is finished. */

import { NextResponse } from "next/server";

import { chargeCredits } from "@/lib/credits-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { CLIP_COST, VOICE_COST, hasWebhookToken, verifyRender } from "@/lib/video/render";

/* Room to copy a clip into storage before answering n8n. */
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!hasWebhookToken(request.headers)) return NextResponse.json({ error: "Unauthorised." }, { status: 401 });

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as {
    videoId?: unknown;
    version?: unknown;
    signature?: unknown;
    job?: { kind?: unknown; n?: unknown };
    url?: unknown;
    error?: unknown;
  } | null;
  const version = Number(body?.version);
  const n = Number(body?.job?.n);
  const kind = body?.job?.kind === "voice" ? "voice" : body?.job?.kind === "clip" ? "clip" : null;
  if (!body || body.videoId !== id || !Number.isInteger(version) || !Number.isInteger(n) || !kind) {
    return NextResponse.json({ error: "Malformed result." }, { status: 400 });
  }

  const { data: video } = await service.from("video_projects").select("id, user_id, title").eq("id", id).maybeSingle();
  if (!video || !verifyRender(id, version, video.user_id, body.signature)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const engine = kind === "clip" ? "video" : "voice";
  const url = typeof body.url === "string" && /^https:\/\//.test(body.url) ? body.url : null;
  let output: string | null = url;
  if (url) {
    try {
      const media = await fetch(url, { signal: AbortSignal.timeout(40000) });
      if (media.ok) {
        const type = media.headers.get("content-type") ?? (kind === "clip" ? "video/mp4" : "audio/mpeg");
        const path = `${video.user_id}/${id}/v${version}/${kind}-${n}.${kind === "clip" ? "mp4" : "mp3"}`;
        const { error } = await service.storage.from("video-assets").upload(path, await media.arrayBuffer(), { contentType: type, upsert: true });
        if (!error) output = `storage:${path}`;
      }
    } catch {
      /* Keep the provider URL; it plays until it expires. */
    }
  }

  await service
    .from("video_renders")
    .update({
      status: url ? "done" : "failed",
      output_path: output,
      error: url ? null : String(body.error ?? "Nothing was returned.").slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("video_id", id)
    .eq("version", version)
    .eq("scene", n)
    .eq("engine", engine);

  if (url) {
    await chargeCredits(service, {
      userId: video.user_id,
      action: "generate",
      cost: kind === "clip" ? CLIP_COST : VOICE_COST,
      description: `Video ${kind} ${n}: ${video.title}`,
      dedupeKey: `video-job:${id}:${version}:${kind}:${n}`,
    });
  }

  const { data: rows } = await service.from("video_renders").select("engine, status").eq("video_id", id).eq("version", version);
  const open = (rows ?? []).some((row) => row.status === "running" || row.status === "queued");
  if (!open) {
    const clipsDone = (rows ?? []).some((row) => row.engine === "video" && row.status === "done");
    await service.from("video_projects").update({ status: clipsDone ? "ready" : "failed" }).eq("id", id);
  }

  return NextResponse.json({ ok: true });
}
