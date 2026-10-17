/* Step 5: generation. Each scene's clip and each voice line becomes a job,
 * filed as a row in video_renders:
 *
 *   clips    each sent to the best connected engine for that scene — Seedance
 *            2.0, Kling, MiniMax Hailuo 2.3, Seedance 1.5 — falling through
 *            the chain when one refuses (lib/video/clip-engines.ts); n8n when
 *            it is the only route. On-camera UGC scenes start from one
 *            generated creator keyframe, so it is the same person in every
 *            shot (lib/video/frames.ts).
 *   voices   MiniMax's own speech API with MINIMAX_API_KEY, after the
 *            response; otherwise the n8n workflow.
 *
 *   {}                    render the current version
 *   { retryFailed: true } send only the jobs of the current render that failed
 *
 * Nothing is sent unless every required engine is connected and the account
 * can cover the render. Credits are charged per job as each one arrives —
 * never for one that failed. */

import { NextResponse } from "next/server";

import { startRender } from "@/lib/video/start-render";

import { videoSession } from "../../shared";

/* Dispatching a job per scene and voice line, in parallel — and, for a UGC
   video, making its creator keyframe first. */
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;
  const body = ((await request.json().catch(() => null)) ?? {}) as { retryFailed?: unknown };
  return startRender(supabase, userId, id, body, new URL(request.url).origin);
}
