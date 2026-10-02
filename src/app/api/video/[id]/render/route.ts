/* Step 5: generation. Each scene's clip and each voice line becomes a job,
 * sent to the n8n workflow "QuickStark.Ai — Video Render" one per execution
 * (lib/video/render.ts says why), and filed as a row in video_renders.
 *
 *   {}                    render the current version
 *   { retryFailed: true } send only the jobs of the current render that failed
 *
 * Nothing is sent unless every required engine is connected and the account
 * can cover the render. Credits are charged per job as each one arrives —
 * never for one that failed. */

import { NextResponse } from "next/server";

import { currentBalance } from "@/lib/credits-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { readiness, renderCost } from "@/lib/video/engines";
import { advance, startMusic } from "@/lib/video/production";
import type { ProductionPlan } from "@/lib/video/plan";
import { dispatchJobs, engineOf, jobCost, jobsFor, type RenderJob } from "@/lib/video/render";

import { videoSession } from "../../shared";

/* Dispatching a job per scene and voice line, in parallel. */
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;

  const { data: video } = await supabase.from("video_projects").select("id, current_version, answers, status").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });
  const body = ((await request.json().catch(() => null)) ?? {}) as { retryFailed?: unknown };
  const version = video.current_version as number;

  const { data: row } = await supabase.from("video_versions").select("plan").eq("video_id", id).eq("version", version).maybeSingle();
  if (!row) return NextResponse.json({ error: "Plan the video first." }, { status: 400 });
  const plan = row.plan as ProductionPlan;

  const ready = readiness(plan);
  if (!ready.ready) {
    return NextResponse.json(
      {
        error: plan.pipeline === "clone" ? "Your clone needs the avatar and lip-sync engine, which isn't connected yet." : "Rendering isn't connected yet for this video.",
        missing: ready.engines.filter((entry) => entry.required && entry.health !== "available"),
        readiness: ready,
      },
      { status: 409 },
    );
  }

  const answers = (video.answers ?? {}) as Record<string, string>;
  const { data: refs } = await supabase.from("video_assets").select("kind, storage_path").eq("video_id", id).neq("kind", "render").order("created_at");
  if (plan.pipeline === "clone" && !(refs ?? []).some((asset) => asset.kind === "person")) {
    return NextResponse.json({ error: "Upload a clear photo of yourself first — your presenter is made from it." }, { status: 400 });
  }
  /* Photo → Video animates the photo itself, so it goes in as the first frame. */
  let firstFrameUrl: string | null = null;
  const photo = plan.pipeline === "photo_to_video" ? (refs ?? []).find((asset) => asset.kind === "photo") : undefined;
  if (photo) {
    const { data } = await supabase.storage.from("video-assets").createSignedUrl(photo.storage_path, 60 * 60);
    firstFrameUrl = data?.signedUrl ?? null;
  }
  let jobs: RenderJob[] = jobsFor(plan, answers, { firstFrameUrl });

  const { data: existing } = await supabase.from("video_renders").select("id, scene, engine, status").eq("video_id", id).eq("version", version);
  if (body.retryFailed === true) {
    const failed = new Set((existing ?? []).filter((r) => r.status === "failed").map((r) => `${r.engine}:${r.scene}`));
    jobs = jobs.filter((job) => failed.has(`${engineOf(job.kind)}:${job.n}`));
    /* fal's jobs (lip sync, avatar, music) are restarted by the production
       line once their inputs are in; the final compose is always redone so
       it takes the new pieces. */
    const falFailed = (existing ?? []).filter((r) => r.status === "failed" && ["avatar", "music"].includes(r.engine));
    if (jobs.length === 0 && falFailed.length === 0) return NextResponse.json({ error: "Nothing failed — there is nothing to retry." }, { status: 400 });
    for (const row of [...falFailed, ...(existing ?? []).filter((r) => r.engine === "compose")]) {
      await supabase.from("video_renders").delete().eq("id", row.id);
    }
    if (jobs.length === 0) {
      const service = createSupabaseServiceClient();
      if (service) {
        const base = { video_id: id, user_id: userId, version };
        if (falFailed.some((r) => r.engine === "music")) await startMusic(service, base, new URL(request.url).origin, plan);
        await advance(service, id, version, new URL(request.url).origin);
      }
      await supabase.from("video_projects").update({ status: "rendering" }).eq("id", id);
      return NextResponse.json({ queued: falFailed.length, failed: 0, readiness: ready });
    }
  } else if ((existing ?? []).some((r) => r.status === "queued" || r.status === "running")) {
    return NextResponse.json({ error: "This version is already rendering." }, { status: 409 });
  } else {
    /* A fresh render: nothing of the last one carries over. */
    await supabase.from("video_renders").delete().eq("video_id", id).eq("version", version);
  }

  const cost = body.retryFailed === true ? jobCost(jobs) : renderCost(plan);
  const service = createSupabaseServiceClient();
  if (service) {
    const balance = await currentBalance(service, userId);
    if (balance && balance.daily + balance.rollover + balance.monthly + balance.topUp < cost) {
      return NextResponse.json({ error: `This render needs ${cost} credits. Top up to render it.` }, { status: 402 });
    }
  }

  /* One row per job, replacing this version's earlier rows for the same jobs. */
  const keys = jobs.map((job) => ({ scene: job.n, engine: engineOf(job.kind) }));
  for (const key of keys) {
    await supabase.from("video_renders").delete().eq("video_id", id).eq("version", version).eq("scene", key.scene).eq("engine", key.engine);
  }
  const { error: insertError } = await supabase.from("video_renders").insert(
    keys.map((key) => ({ video_id: id, user_id: userId, version, scene: key.scene, engine: key.engine, provider: "n8n:minimax", status: "running" })),
  );
  if (insertError) return NextResponse.json({ error: "Could not start the render." }, { status: 500 });

  const callbackUrl = `${new URL(request.url).origin}/api/video/${id}/render/callback`;
  const sent = await dispatchJobs({ videoId: id, version, userId, aspect: plan.aspect, callbackUrl, jobs });

  for (const result of sent.filter((entry) => !entry.ok)) {
    await supabase
      .from("video_renders")
      .update({ status: "failed", error: result.error ?? "Not sent." })
      .eq("video_id", id)
      .eq("version", version)
      .eq("scene", result.job.n)
      .eq("engine", engineOf(result.job.kind));
  }

  const accepted = sent.filter((entry) => entry.ok).length;
  if (accepted && body.retryFailed !== true) {
    const service = createSupabaseServiceClient();
    if (service) await startMusic(service, { video_id: id, user_id: userId, version }, new URL(request.url).origin, plan);
  }
  await supabase.from("video_projects").update({ status: accepted ? "rendering" : "failed" }).eq("id", id);
  if (!accepted) return NextResponse.json({ error: sent[0]?.error ?? "The render could not be started." }, { status: 502 });
  return NextResponse.json({ queued: accepted, failed: sent.length - accepted, cost, readiness: ready });
}
