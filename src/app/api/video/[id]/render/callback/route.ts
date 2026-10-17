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
import type { ProductionPlan } from "@/lib/video/plan";
import { speak } from "@/lib/video/providers";
import { hasWebhookToken, languageFor, verifyRender, voiceIdFor } from "@/lib/video/render";
import { isCreditExhausted, pauseN8n } from "@/lib/video/credit";
import { failoverN8n, landResult, retryClip } from "@/lib/video/results";

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
  const origin = new URL(request.url).origin;
  const error = url ? null : String(body.error ?? "Nothing was returned.");

  /* Only while the job is still n8n's. One already handed to another engine
     (the credit ran out, or it timed out) is that engine's now, and a late
     reply from n8n is acknowledged and ignored. */
  const { data: row } = await service
    .from("video_renders")
    .select("provider, status")
    .eq("video_id", id)
    .eq("version", version)
    .eq("scene", n)
    .eq("engine", kind === "clip" ? "video" : "voice")
    .maybeSingle();
  /* A clip that arrives after it was given up on is still the clip that was
     asked for: n8n's queue can hold a job past the stale limit, and throwing
     away a finished clip helps nobody. Taken only while the job is still
     n8n's — one handed to another engine stays that engine's. */
  const late = row?.status === "failed" && url !== null;
  if (!row || (row.status !== "running" && !late) || row.provider !== "n8n:minimax") return NextResponse.json({ ok: true, ignored: true });

  /* The MiniMax usage credit behind n8n is spent: n8n is paused for every
     render, and this render's n8n jobs — this one included — go to the main
     API now rather than each failing in turn. See lib/video/credit.ts. */
  if (isCreditExhausted(error)) {
    await pauseN8n(service, error ?? "credit exhausted");
    await failoverN8n(service, { videoId: id, version, origin });
    const { data: still } = await service
      .from("video_renders")
      .select("provider, status")
      .eq("video_id", id)
      .eq("version", version)
      .eq("scene", n)
      .eq("engine", kind === "clip" ? "video" : "voice")
      .maybeSingle();
    if (still?.provider !== "n8n:minimax" || still.status !== "running") return NextResponse.json({ ok: true, failover: true });
    await landResult(service, {
      videoId: id,
      version,
      kind,
      n,
      error: "The MiniMax usage credit on n8n has run out, and no other engine is connected to take this over. Add MINIMAX_API_KEY to use the main API.",
      engine: kind === "clip" ? "n8n" : null,
      origin,
    });
    return NextResponse.json({ ok: true });
  }

  /* n8n spends the MiniMax usage credit first; when it could not make a
     piece, the piece goes on rather than failing — a clip to the next engine
     in its chain, a voice line to MiniMax's own speech API. */
  if (!url && kind === "clip" && (await retryClip(service, { videoId: id, version, n, failed: "n8n", origin }))) {
    return NextResponse.json({ ok: true, retried: true });
  }
  if (!url && kind === "voice" && process.env.MINIMAX_API_KEY) {
    const plan = (await service.from("video_versions").select("plan").eq("video_id", id).eq("version", version).maybeSingle()).data?.plan as ProductionPlan | undefined;
    const { data: project } = await service.from("video_projects").select("answers").eq("id", id).maybeSingle();
    const line = plan?.scenes.find((scene) => scene.n === n)?.voiceover.replace(/^[A-Z][A-Za-z .'-]{0,24}:\s*/, "").trim();
    if (line) {
      const answers = (project?.answers ?? {}) as Record<string, string>;
      const spoken = await speak({ text: line, voiceId: voiceIdFor(answers), language: languageFor(answers) });
      if (spoken.ok) {
        await landResult(service, { videoId: id, version, kind, n, bytes: spoken.audio, origin });
        return NextResponse.json({ ok: true, retried: true });
      }
    }
  }

  await landResult(service, {
    videoId: id,
    version,
    kind,
    n,
    url,
    error,
    engine: kind === "clip" ? "n8n" : null,
    origin,
  });

  return NextResponse.json({ ok: true });
}
