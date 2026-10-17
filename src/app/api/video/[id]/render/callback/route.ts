/* Where each n8n render job reports back — one clip or one voice line.
 *
 * No session: n8n is calling. It proves itself twice — the shared webhook
 * token in X-QuickStark-Token, and a signature over this video, version and
 * owner that only /render could have made (lib/video/render.ts). Then:
 *
 * the result is landed like every engine's (lib/video/results.ts): copied
 * into storage, marked, charged once if delivered, the production line
 * advanced, and the video finished when nothing is left running. */

import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { hasWebhookToken, verifyRender } from "@/lib/video/render";
import { landResult } from "@/lib/video/results";

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

  const { data: video } = await service.from("video_projects").select("id, user_id").eq("id", id).maybeSingle();
  if (!video || !verifyRender(id, version, video.user_id, body.signature)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const url = typeof body.url === "string" && /^https:\/\//.test(body.url) ? body.url : null;
  await landResult(service, {
    videoId: id,
    version,
    kind,
    n,
    url,
    error: url ? null : String(body.error ?? "Nothing was returned."),
    engine: kind === "clip" ? "n8n" : null,
    origin: new URL(request.url).origin,
  });

  return NextResponse.json({ ok: true });
}
