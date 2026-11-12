/* The studio's timeline and video settings, saved.
 *
 *   POST { plan }   the whole plan as the studio has it: scenes in their new
 *                   order (uploads with their trims, speeds and levels,
 *                   generated scenes with their words) and plan.cut, every
 *                   video setting
 *
 * Saved as the next version. When something has been made already, every
 * clip and voice line that still fits is reused, only what changed is made,
 * and the cut is made again at once — free (apply-edit.ts saveTimeline).
 * Before anything is made, it is simply saved. */

import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { saveTimeline } from "@/lib/video/apply-edit";
import { isPipelineId } from "@/lib/video/pipelines";
import { normalizePlan, qaAndRepair } from "@/lib/video/plan";
import { keepKnownCast, keepKnownSources, loadCast, loadStudioAssets, planVideo } from "@/lib/video/plan-video";

import { videoSession } from "../../shared";

export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;
  const body = ((await request.json().catch(() => null)) ?? {}) as { plan?: unknown };
  if (!body.plan || typeof body.plan !== "object") return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

  const { data: video } = await supabase.from("video_projects").select("id, user_id, pipeline, answers, status, character_ids").eq("id", id).maybeSingle();
  if (!video || !isPipelineId(video.pipeline)) return NextResponse.json({ error: "No such video." }, { status: 404 });
  if (video.status === "rendering") return NextResponse.json({ error: "This version is still rendering — save your changes once it finishes." }, { status: 409 });

  const uploads = await loadStudioAssets(supabase, id);
  const cast = await loadCast(supabase, video as { user_id: string; character_ids?: string[] | null });
  const { plan: next } = qaAndRepair(keepKnownCast(keepKnownSources(normalizePlan(body.plan, video.pipeline, (video.answers ?? {}) as Record<string, string>), uploads), cast));
  if (!next.scenes.length) return NextResponse.json({ error: "Keep at least one scene." }, { status: 400 });

  const writer = createSupabaseServiceClient() ?? supabase;
  const saved = await saveTimeline({ writer, userId, videoId: id, next, origin: new URL(request.url).origin });
  if (!saved) return planVideo(supabase, userId, id, { plan: next });
  if (!saved.ok) return NextResponse.json({ error: saved.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: saved.message, recut: true });
}
