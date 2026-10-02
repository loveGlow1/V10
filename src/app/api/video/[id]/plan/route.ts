/* The Creative Director's production plan — Steps 3 and 4, and every
 * revision after.
 *
 *   {}               plan it (first time) or plan it again
 *   { note }         revise the current plan: "make the hook funnier"
 *   { plan }         a person's own edits to the scenes, checked and kept
 *
 * Every result is a new numbered version; nothing is overwritten. A model
 * plan costs one credit, charged after it is delivered; saving your own edits
 * is free. Each plan passes the shared QA and repair (lib/video/plan.ts)
 * before it is stored. */

import { NextResponse } from "next/server";

import { chargeCredits, currentBalance } from "@/lib/credits-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { direct } from "@/lib/video/director";
import { readiness } from "@/lib/video/engines";
import { isPipelineId } from "@/lib/video/pipelines";
import { normalizePlan, qaAndRepair, type ProductionPlan } from "@/lib/video/plan";

import { videoSession } from "../../shared";

const PLAN_COST = 1;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;

  const { data: video } = await supabase.from("video_projects").select("*").eq("id", id).maybeSingle();
  if (!video || !isPipelineId(video.pipeline)) return NextResponse.json({ error: "No such video." }, { status: 404 });

  const body = ((await request.json().catch(() => null)) ?? {}) as { note?: unknown; plan?: unknown };
  const answers = (video.answers ?? {}) as Record<string, string>;
  const { data: current } = await supabase
    .from("video_versions")
    .select("plan")
    .eq("video_id", id)
    .eq("version", video.current_version)
    .maybeSingle();

  let plan: ProductionPlan;
  let issues;
  let note: string;
  let outputTokens = 0;

  if (body.plan && typeof body.plan === "object") {
    ({ plan, issues } = qaAndRepair(normalizePlan(body.plan, video.pipeline, answers)));
    note = "Your edits";
  } else {
    const service = createSupabaseServiceClient();
    if (service) {
      const balance = await currentBalance(service, userId);
      if (balance && balance.daily + balance.rollover + balance.monthly + balance.topUp < PLAN_COST) {
        return NextResponse.json({ error: "You are out of credits. Top up to plan this video." }, { status: 402 });
      }
    }

    const { data: assets } = await supabase.from("video_assets").select("storage_path, kind").eq("video_id", id).neq("kind", "render").limit(3);
    const images: string[] = [];
    for (const asset of assets ?? []) {
      const { data } = await supabase.storage.from("video-assets").createSignedUrl(asset.storage_path, 600);
      if (data?.signedUrl) images.push(data.signedUrl);
    }

    const directed = await direct({
      pipeline: video.pipeline,
      brief: video.brief,
      answers,
      images,
      note: typeof body.note === "string" ? body.note : undefined,
      previous: typeof body.note === "string" && current ? (current.plan as ProductionPlan) : null,
    });
    if ("error" in directed) return NextResponse.json({ error: directed.error }, { status: 502 });
    ({ plan, issues, outputTokens } = directed);
    note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : video.current_version ? "Planned again" : "First plan";
  }

  const version = (video.current_version ?? 0) + 1;
  const { error: saveError } = await supabase.from("video_versions").insert({ video_id: id, user_id: userId, version, plan, issues, note });
  if (saveError) return NextResponse.json({ error: "The plan was made but could not be saved. Try again." }, { status: 500 });
  await supabase.from("video_projects").update({ current_version: version, status: "planned", title: plan.title.slice(0, 160) }).eq("id", id);

  if (outputTokens) {
    const service = createSupabaseServiceClient();
    if (service) {
      await chargeCredits(service, {
        userId,
        action: "generate",
        cost: PLAN_COST,
        description: `Video plan: ${plan.title}`,
        outputTokens,
        dedupeKey: `video-plan:${id}:${version}`,
      });
    }
  }

  return NextResponse.json({ version, plan, issues, note, readiness: readiness(plan) });
}
