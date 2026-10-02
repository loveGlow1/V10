/* Video Studio — a new video, and the list of them.
 *
 * Creating one records the pipeline, the idea, Step 2's answers and, for
 * Create Your Clone, the owner's confirmation that they may use the likeness
 * and voice. Planning is a separate call (./[id]/plan), so reference images
 * can be uploaded against the video's id first. */

import { NextResponse } from "next/server";

import { PIPELINES, answersFor, isPipelineId } from "@/lib/video/pipelines";

import { videoSession } from "./shared";

export async function GET() {
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { data, error } = await session.supabase
    .from("video_projects")
    .select("id, title, pipeline, status, current_version, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: "Could not read your videos." }, { status: 500 });
  return NextResponse.json({ videos: data ?? [] });
}

export async function POST(request: Request) {
  const session = await videoSession();
  if ("error" in session) return session.error;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !isPipelineId(body.pipeline)) return NextResponse.json({ error: "Choose a video type." }, { status: 400 });
  const pipeline = PIPELINES[body.pipeline];
  const brief = typeof body.brief === "string" ? body.brief.trim().slice(0, 8000) : "";
  if (!brief) return NextResponse.json({ error: "Describe the video you want." }, { status: 400 });
  const given = body.answers && typeof body.answers === "object" ? (body.answers as Record<string, string>) : {};

  if (pipeline.needsConsent && body.consent !== true) {
    return NextResponse.json(
      { error: "Confirm that you are the person in the reference material, or have their permission to use their likeness and voice." },
      { status: 400 },
    );
  }

  const { data, error } = await session.supabase
    .from("video_projects")
    .insert({
      user_id: session.userId,
      pipeline: pipeline.id,
      title: brief.split(/[.\n]/)[0].slice(0, 80) || pipeline.label,
      brief,
      answers: answersFor(pipeline, given),
      consent_at: pipeline.needsConsent ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !data) {
    // eslint-disable-next-line no-console
    console.error("video create:", error);
    return NextResponse.json({ error: "Could not start the video. Has the Video Studio schema been applied?" }, { status: 500 });
  }
  return NextResponse.json({ id: data.id });
}
