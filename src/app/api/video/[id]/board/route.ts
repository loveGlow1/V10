/* A video's state, for its own preview board in the workspace.
 *
 * The board runs inside the sandboxed preview iframe, which has no session
 * and no origin of its own, so it cannot use the studio's route. It is given a
 * token made for this one video (lib/video/workspace.ts boardToken) and reads
 * the same state through here — the clips that have landed, as signed links,
 * and the plan they belong to. Nothing else is reachable with it. */

import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { videoState } from "@/lib/video/state";
import { verifyBoardToken } from "@/lib/video/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  if (!verifyBoardToken(id, new URL(request.url).searchParams.get("t"))) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401, headers: cors });
  }
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Unavailable." }, { status: 503, headers: cors });
  const state = await videoState(service, id, new URL(request.url).origin);
  const body = await state.json();
  /* The board needs the plan and the render — not the brief, the answers or
     the references. */
  const { video, latest, renders, final } = body as { video?: Record<string, unknown>; latest?: unknown; renders?: unknown; final?: unknown };
  return NextResponse.json(
    { video: video ? { id: video.id, status: video.status, title: video.title } : null, latest, renders, final },
    { status: state.status, headers: cors },
  );
}
