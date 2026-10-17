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

import { NextResponse, after } from "next/server";

import { currentBalance } from "@/lib/credits-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { type Aspect, providerOf, routeClip, tierFrom, voiceDirect } from "@/lib/video/clip-engines";
import { readiness, renderCost } from "@/lib/video/engines";
import { ensureKeyframe, wantsKeyframe } from "@/lib/video/frames";
import { clipWebhookUrl, speak, submitClip } from "@/lib/video/providers";
import { landResult } from "@/lib/video/results";
import { advance, startMusic } from "@/lib/video/production";
import type { ProductionPlan } from "@/lib/video/plan";
import { dispatchJobs, engineOf, jobCost, jobsFor, languageFor, type RenderJob, voiceIdFor } from "@/lib/video/render";

import { videoSession } from "../../shared";

/* Dispatching a job per scene and voice line, in parallel — and, for a UGC
   video, making its creator keyframe first. */
export const maxDuration = 300;

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

  const quality = answers.quality ?? null;
  const tier = tierFrom(process.env, quality);
  const cost = body.retryFailed === true ? jobCost(jobs) : renderCost(plan, process.env, quality);
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
    keys.map((key) => ({ video_id: id, user_id: userId, version, scene: key.scene, engine: key.engine, provider: key.engine === "voice" && voiceDirect(process.env, tier) ? "minimax:speech" : "n8n:minimax", status: "running" })),
  );
  if (insertError) return NextResponse.json({ error: "Could not start the render." }, { status: 500 });

  const origin = new URL(request.url).origin;
  const callbackUrl = `${origin}/api/video/${id}/render/callback`;
  const fail = (job: RenderJob, error: string) =>
    supabase
      .from("video_renders")
      .update({ status: "failed", error })
      .eq("video_id", id)
      .eq("version", version)
      .eq("scene", job.n)
      .eq("engine", engineOf(job.kind));

  /* The creator keyframe, once per version, before any on-camera clip. */
  const writer = createSupabaseServiceClient();
  const keyframe =
    writer && wantsKeyframe(plan, (refs ?? []).some((asset) => asset.kind === "person"))
      ? await ensureKeyframe(writer, { userId, videoId: id, version, plan })
      : null;

  const sent: { job: RenderJob; ok: boolean; error?: string }[] = [];
  const voices: Extract<RenderJob, { kind: "voice" }>[] = [];
  const toN8n = async (job: RenderJob) => (await dispatchJobs({ videoId: id, version, userId, aspect: plan.aspect, callbackUrl, jobs: [job] }))[0];

  /* Each job walks its chain in order. On the default "credit" tier n8n —
     the MiniMax usage credit — is first, and a paid engine is only reached
     when n8n refuses the job; a clip n8n later FAILS is handed on by the
     callback (results.ts retryClip). */
  await Promise.all(
    jobs.map(async (job) => {
      if (job.kind === "voice") {
        if (voiceDirect(process.env, tier)) {
          voices.push(job);
          return;
        }
        const result = await toN8n(job);
        if (result.ok) sent.push(result);
        else if (process.env.MINIMAX_API_KEY) {
          /* n8n could not take it: the same MiniMax voice, direct. */
          await supabase.from("video_renders").update({ provider: "minimax:speech" }).eq("video_id", id).eq("version", version).eq("scene", job.n).eq("engine", "voice");
          voices.push(job);
        } else {
          await fail(job, result.error ?? "Not sent.");
          sent.push(result);
        }
        return;
      }
      const scene = plan.scenes.find((entry) => entry.n === job.n);
      const frame = firstFrameUrl ?? (scene?.engine === "avatar" ? keyframe : null);
      const chain = routeClip({ pipeline: plan.pipeline, aspect: plan.aspect as Aspect, fromFrame: Boolean(frame), tier });
      let reason = "No connected video engine can make this scene at this aspect ratio.";
      for (const engine of chain) {
        if (engine === "n8n") {
          const result = await toN8n(frame ? { ...job, imageUrl: frame } : job);
          if (result.ok) {
            await supabase.from("video_renders").update({ provider: providerOf("n8n", "") }).eq("video_id", id).eq("version", version).eq("scene", job.n).eq("engine", "video");
            sent.push({ job, ok: true });
            return;
          }
          reason = result.error ?? reason;
          continue;
        }
        const result = await submitClip(
          engine,
          { prompt: scene?.motionPrompt || job.prompt, seconds: scene?.duration ?? job.duration, aspect: plan.aspect as Aspect, imageUrl: frame, key: `${id}:${version}:${job.n}:${engine}` },
          clipWebhookUrl(origin, id, version, job.n, engine),
        );
        if (result.ok) {
          await supabase
            .from("video_renders")
            .update({ provider: providerOf(engine, result.id) })
            .eq("video_id", id)
            .eq("version", version)
            .eq("scene", job.n)
            .eq("engine", "video");
          sent.push({ job, ok: true });
          return;
        }
        reason = result.error;
      }
      await fail(job, reason);
      sent.push({ job, ok: false, error: reason });
    }),
  );

  /* Voice lines straight from MiniMax, after the answer: each takes a few
     seconds, and the studio watches the rows fill in. */
  if (voices.length && writer) {
    const voiceId = voiceIdFor(answers);
    after(async () => {
      await Promise.all(
        voices.map(async (job) => {
          const spoken = await speak({ text: job.text, voiceId, language: languageFor(answers) });
          await landResult(writer, {
            videoId: id,
            version,
            kind: "voice",
            n: job.n,
            bytes: spoken.ok ? spoken.audio : null,
            error: spoken.ok ? null : spoken.error,
            origin,
          });
        }),
      );
    });
    for (const job of voices) sent.push({ job, ok: true });
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
