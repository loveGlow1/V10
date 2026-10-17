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
import { landResult, retryClip } from "@/lib/video/results";

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
    error: url ? null : String(body.error ?? "Nothing was returned."),
    engine: kind === "clip" ? "n8n" : null,
    origin,
  });

  return NextResponse.json({ ok: true });
}
