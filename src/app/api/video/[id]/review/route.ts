/* The AI's look over an edit — it speaks only when it has something worth
 * saying.
 *
 *   POST { plan, model? }   the timeline as it is on screen now
 *
 * Answers { quiet: true } when all is well, or up to three suggestions, each
 * a short title, one plain sentence why, and the timeline with that change
 * made — for the person to apply or dismiss. Nothing is saved here.
 *
 * It runs a model, so it is charged whether it speaks or not (pricing.ts
 * REVIEW_COST, at the agent's rate). With too few credits it stays quiet
 * rather than asking for a top-up nobody asked about. */

import { NextResponse } from "next/server";

import { chargeCredits, currentBalance } from "@/lib/credits-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { videoAgentFor } from "@/lib/video/agent";
import { applyEdit, reviewEdit } from "@/lib/video/editor";
import { isPipelineId } from "@/lib/video/pipelines";
import { normalizePlan, qaAndRepair } from "@/lib/video/plan";
import { keepKnownCast, keepKnownSources, loadCast, loadStudioAssets } from "@/lib/video/plan-video";
import { reviewCredits } from "@/lib/video/pricing";

import { videoSession } from "../../shared";

export const maxDuration = 90;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;
  const service = createSupabaseServiceClient();
  const body = ((await request.json().catch(() => null)) ?? {}) as { plan?: unknown; model?: unknown };
  if (!body.plan || typeof body.plan !== "object") return NextResponse.json({ quiet: true });

  const { data: video } = await supabase.from("video_projects").select("id, user_id, title, pipeline, answers, current_version, character_ids").eq("id", id).maybeSingle();
  if (!video || !isPipelineId(video.pipeline)) return NextResponse.json({ error: "No such video." }, { status: 404 });

  const agent = await videoAgentFor(service, userId, body.model);
  const cost = reviewCredits(agent.multiplier);
  if (service) {
    const balance = await currentBalance(service, userId);
    if (balance && balance.daily + balance.rollover + balance.monthly + balance.topUp < cost) return NextResponse.json({ quiet: true, skipped: "credits" });
  }

  const uploads = await loadStudioAssets(supabase, id);
  const cast = await loadCast(supabase, video as { user_id: string; character_ids?: string[] | null });
  const plan = keepKnownCast(keepKnownSources(normalizePlan(body.plan, video.pipeline, (video.answers ?? {}) as Record<string, string>), uploads), cast);
  const { data: rows } = await supabase.from("video_renders").select("scene, engine, status").eq("video_id", id).eq("version", video.current_version ?? 0);
  const made = plan.scenes.map((scene) => ({
    scene: scene.n,
    clip: Boolean(scene.source) || (rows ?? []).some((r) => r.scene === scene.n && (r.engine === "video" || r.engine === "avatar") && r.status === "done"),
    voice: Boolean(scene.voiceAsset) || (rows ?? []).some((r) => r.scene === scene.n && r.engine === "voice" && r.status === "done"),
  }));

  const reviewed = await reviewEdit({ plan, made, assets: uploads, model: agent.apiId });
  if ("error" in reviewed) return NextResponse.json({ quiet: true });
  if (service) {
    await chargeCredits(service, { userId, action: "generate", cost, description: `Video review (${agent.name}): ${video.title}`, outputTokens: reviewed.outputTokens, videoId: id, dedupeKey: `video-review:${id}:${Date.now()}` });
  }
  if (!reviewed.suggestions.length) return NextResponse.json({ quiet: true, charged: cost });

  const suggestions = reviewed.suggestions.map((s) => {
    const { plan: next, refilm } = applyEdit(plan, s.edit, uploads);
    return { title: s.title, why: s.why, plan: qaAndRepair(next).plan, refilm };
  });
  return NextResponse.json({ quiet: false, suggestions, charged: cost, agent: agent.name });
}
