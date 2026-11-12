/* The AI editor, on request, in the visual editor — never in the way.
 *
 *   POST { instruction, plan }   plan: the timeline as it is on screen now
 *
 * The editor model (editor.ts) reads the ATTACHMENTS block, the timeline
 * scene by scene (what is uploaded, what is made) and every setting, and
 * proposes the smallest change. Nothing is saved: the proposal comes back as
 * a plan the person sees on the timeline, keeps, changes or undoes, then
 * saves like any edit of their own. One credit per answer. */

import { NextResponse } from "next/server";

import { refuseWithoutCard } from "@/lib/card-gate";
import { chargeCredits, currentBalance } from "@/lib/credits-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { applyEdit, decideEdit } from "@/lib/video/editor";
import { isPipelineId } from "@/lib/video/pipelines";
import { normalizePlan, qaAndRepair } from "@/lib/video/plan";
import { keepKnownCast, keepKnownSources, loadCast, loadStudioAssets } from "@/lib/video/plan-video";
import { agentCost, videoAgentFor } from "@/lib/video/agent";

import { videoSession } from "../../shared";

export const maxDuration = 90;

const ASSIST_COST = 1;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;
  const service = createSupabaseServiceClient();
  const noCard = await refuseWithoutCard(service, userId);
  if (noCard) return noCard;

  const body = ((await request.json().catch(() => null)) ?? {}) as { instruction?: unknown; plan?: unknown; model?: unknown };
  const agent = await videoAgentFor(service, userId, body.model);
  const cost = agentCost(ASSIST_COST, agent);
  const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 2000) : "";
  if (!instruction) return NextResponse.json({ error: "Say what you'd like changed." }, { status: 400 });
  const { data: video } = await supabase.from("video_projects").select("id, title, pipeline, answers, current_version").eq("id", id).maybeSingle();
  if (!video || !isPipelineId(video.pipeline)) return NextResponse.json({ error: "No such video." }, { status: 404 });
  if (!body.plan || typeof body.plan !== "object") return NextResponse.json({ error: "Open the timeline first." }, { status: 400 });
  if (service) {
    const balance = await currentBalance(service, userId);
    if (balance && balance.daily + balance.rollover + balance.monthly + balance.topUp < cost) return NextResponse.json({ error: "You're out of credits. Top up to ask the AI editor — everything else in the editor is free." }, { status: 402 });
  }

  const uploads = await loadStudioAssets(supabase, id);
  const { data: owner } = await supabase.from("video_projects").select("user_id, character_ids").eq("id", id).maybeSingle();
  const cast = owner ? await loadCast(supabase, owner as { user_id: string; character_ids?: string[] | null }) : [];
  const plan = keepKnownCast(keepKnownSources(normalizePlan(body.plan, video.pipeline, (video.answers ?? {}) as Record<string, string>), uploads), cast);
  const { data: rows } = await supabase.from("video_renders").select("scene, engine, status").eq("video_id", id).eq("version", video.current_version ?? 0);
  const made = plan.scenes.map((scene) => ({
    scene: scene.n,
    clip: Boolean(scene.source) || (rows ?? []).some((r) => r.scene === scene.n && (r.engine === "video" || r.engine === "avatar") && r.status === "done"),
    voice: Boolean(scene.voiceAsset) || (rows ?? []).some((r) => r.scene === scene.n && r.engine === "voice" && r.status === "done"),
  }));
  const decided = await decideEdit({ plan, made, instruction, assets: uploads, model: agent.apiId });
  if ("error" in decided) return NextResponse.json({ error: `${decided.error} Nothing was charged.` }, { status: 502 });
  if (service) {
    await chargeCredits(service, { userId, action: "generate", cost, description: `Video AI editor (${agent.name}): ${video.title}`, outputTokens: decided.outputTokens, dedupeKey: `video-assist:${id}:${Date.now()}` });
  }
  if (decided.edit.replan) {
    return NextResponse.json({ reply: `${decided.edit.reply} That sounds like a different video — use "Plan again" in the studio for a new plan.`, plan: null });
  }
  const { plan: next, refilm } = applyEdit(plan, decided.edit, uploads);
  const { plan: checked } = qaAndRepair(next);
  return NextResponse.json({ reply: decided.edit.reply, plan: checked, refilm, agent: { id: agent.id, name: agent.name, ...(agent.declined ? { declined: agent.declined } : {}) }, charged: cost });
}
