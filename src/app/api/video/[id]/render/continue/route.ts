/* A scene that carries on from the one before, filmed from its last frame
 * (lib/video/continue-scene.ts). Started when the scene before lands
 * (continuity-release.ts), with an HMAC token for exactly this video, version
 * and scene; nothing else can start it. Answers at once, works after. */

import { NextResponse, after } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { continueScene } from "@/lib/video/continue-scene";
import { verifyFalToken } from "@/lib/video/fal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const version = Number(url.searchParams.get("v"));
  const n = Number(url.searchParams.get("scene"));
  if (!Number.isInteger(version) || !Number.isInteger(n) || !verifyFalToken(id, version, `continue:${n}`, url.searchParams.get("t"))) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "No service key." }, { status: 503 });
  after(() => continueScene(service, { videoId: id, version, n, origin: url.origin }));
  return NextResponse.json({ ok: true }, { status: 202 });
}
