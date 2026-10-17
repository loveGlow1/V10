/* Where every clip engine reports — Higgsfield (Seedance, Kling), MiniMax and
 * fal's Seedance.
 *
 * No session: an engine is calling. It gets three checks before anything is
 * written:
 *
 *   1. the address carries our HMAC token for this video, version and scene
 *      (lib/video/providers.ts clipWebhookUrl), so a delivery can only ever
 *      touch the clip it was sent for;
 *   2. the row's provider column must name this engine and this request —
 *      a delivery for a request this scene is no longer waiting on (a
 *      fallback took over) is acknowledged and ignored;
 *   3. the result is then ASKED OF THE ENGINE ITSELF (clipStatus), not read
 *      off the body — except fal, whose deliveries carry fal's own Ed25519
 *      signature, which is checked instead.
 *
 * MiniMax first validates the address by POSTing a `challenge`, which is
 * echoed back within its three seconds. A clip that failed is handed to the
 * next engine in its chain before it is called failed (results.ts). */

import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { isClipEngine, parseProvider } from "@/lib/video/clip-engines";
import { outputUrl, verifyFalSignature, verifyFalToken } from "@/lib/video/fal";
import { clipStatus } from "@/lib/video/providers";
import { landResult, retryClip } from "@/lib/video/results";

/* Room to copy a clip into storage, or to hand it to the next engine. */
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const query = new URL(request.url).searchParams;
  const version = Number(query.get("v"));
  const scene = Number(query.get("scene"));
  const engine = query.get("engine");
  const raw = await request.text();
  const body = (() => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  /* MiniMax's address check carries no job, only a challenge to echo. */
  if (body && typeof body.challenge === "string" && Object.keys(body).length <= 2) {
    if (!Number.isInteger(version) || !Number.isInteger(scene) || !verifyFalToken(id, version, `clip:${scene}`, query.get("t"))) {
      return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
    }
    return NextResponse.json({ challenge: body.challenge });
  }

  if (!Number.isInteger(version) || !Number.isInteger(scene) || !isClipEngine(engine) || !body) {
    return NextResponse.json({ error: "Malformed result." }, { status: 400 });
  }
  if (!verifyFalToken(id, version, `clip:${scene}`, query.get("t"))) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });

  const { data: row } = await service
    .from("video_renders")
    .select("provider, status")
    .eq("video_id", id)
    .eq("version", version)
    .eq("scene", scene)
    .eq("engine", "video")
    .maybeSingle();
  const current = parseProvider(row?.provider);
  /* Not waiting on this request any more — a duplicate, or a fallback has
     already taken over. Acknowledged so the engine stops retrying. */
  if (!row || row.status !== "running" || !current || current.engine !== engine) return NextResponse.json({ ok: true, ignored: true });

  const origin = new URL(request.url).origin;
  let state: { state: "running" } | { state: "done"; url: string } | { state: "failed"; error: string };

  if (engine === "seedance-fal") {
    if ((await verifyFalSignature(request.headers, raw)) === "invalid") return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
    if (String(body.request_id ?? "") !== current.id) return NextResponse.json({ ok: true, ignored: true });
    const url = body.status === "OK" ? outputUrl(body.payload) : null;
    state = url ? { state: "done", url } : { state: "failed", error: String(body.error ?? "fal could not make this clip.").slice(0, 500) };
  } else {
    /* The body only says something happened; the engine says what. */
    const named = String(body.request_id ?? body.task_id ?? "");
    if (named && named !== current.id) return NextResponse.json({ ok: true, ignored: true });
    state = await clipStatus(engine, current.id);
  }

  if (state.state === "running") return NextResponse.json({ ok: true, pending: true });

  if (state.state === "failed") {
    const handedOn = await retryClip(service, { videoId: id, version, n: scene, failed: engine, origin });
    if (handedOn) return NextResponse.json({ ok: true, retried: true });
    await landResult(service, { videoId: id, version, kind: "clip", n: scene, error: state.error, engine, origin });
    return NextResponse.json({ ok: true });
  }

  await landResult(service, { videoId: id, version, kind: "clip", n: scene, url: state.url, engine, origin });
  return NextResponse.json({ ok: true });
}
