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
 *   { onlyMissing: true } send only the jobs this version has no piece for —
 *                         an edit (apply-edit.ts) files what carries over first
 *
 * Nothing is sent unless every required engine is connected and the account
 * can cover the render. Credits are charged per job as each one arrives —
 * never for one that failed. */

import { NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { currentBalance } from "@/lib/credits-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { type Aspect, type ClipEngine, canSpeak, providerOf, routeClip, tierFrom, voiceDirect } from "@/lib/video/clip-engines";
import { cutCost, readiness, renderCost } from "@/lib/video/engines";
import { creditsLabel } from "@/lib/video/pricing";
import { n8nPausedUntil } from "@/lib/video/credit";
import { ensureKeyframe, ensureSceneFrame, wantsKeyframe } from "@/lib/video/frames";
import { clipWebhookUrl, speak, submitClip } from "@/lib/video/providers";
import { landResult } from "@/lib/video/results";
import { advance, startMusic } from "@/lib/video/production";
import { fileUploads } from "@/lib/video/uploads-render";
import { castPrompt, planReferences, sceneCast } from "@/lib/video/cast";
import { castPictures } from "@/lib/video/characters";
import { awaitProvider, continuityLinks } from "@/lib/video/continuity";
import { LOOK_NOTE, lookFrames } from "@/lib/video/look";
import { releaseWaiting } from "@/lib/video/continuity-release";
import type { ProductionPlan } from "@/lib/video/plan";
import { clipPrompt, dispatchJobs, engineOf, jobCost, jobsFor, languageFor, type RenderJob } from "@/lib/video/render";


/** Step 5 for one video: every clip and voice line of its current version, sent. The render route and the workspace both start renders here. */
export async function startRender(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  body: { retryFailed?: unknown; onlyMissing?: unknown },
  origin: string,
): Promise<NextResponse> {
  const { data: video } = await supabase.from("video_projects").select("id, current_version, answers, status").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });
  const version = video.current_version as number;

  const { data: row } = await supabase.from("video_versions").select("plan").eq("video_id", id).eq("version", version).maybeSingle();
  if (!row) return NextResponse.json({ error: "Plan the video first." }, { status: 400 });
  const plan = row.plan as ProductionPlan;

  const ready = readiness(plan);
  if (!ready.ready) {
    return NextResponse.json(
      {
        error: plan.pipeline === "clone" ? "Your clone needs the avatar and lip-sync engine, which isn't connected yet." : "Generating isn't connected yet for this video.",
        missing: ready.engines.filter((entry) => entry.required && entry.health !== "available"),
        readiness: ready,
      },
      { status: 409 },
    );
  }

  const answers = (video.answers ?? {}) as Record<string, string>;
  /* Nothing here is free: every path below checks it can be paid for first. */
  const covers = async (needed: number) => {
    const service = createSupabaseServiceClient();
    const balance = service ? await currentBalance(service, userId) : null;
    return !balance || balance.daily + balance.rollover + balance.monthly + balance.topUp >= needed;
  };
  const shortOf = (needed: number) =>
    NextResponse.json({ error: `This needs ${creditsLabel(needed)}. Top up to make the cut.` }, { status: 402 });
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
    for (const row of [...falFailed, ...(existing ?? []).filter((r) => r.engine === "compose" || r.engine === "part")]) {
      await supabase.from("video_renders").delete().eq("id", row.id);
    }
    if (jobs.length === 0) {
      const service = createSupabaseServiceClient();
      if (service) {
        const base = { video_id: id, user_id: userId, version };
        if (falFailed.some((r) => r.engine === "music")) await startMusic(service, base, origin, plan);
        await advance(service, id, version, origin);
      }
      await supabase.from("video_projects").update({ status: "rendering" }).eq("id", id);
      return NextResponse.json({ queued: falFailed.length, failed: 0, readiness: ready });
    }
  } else if (body.onlyMissing === true) {
    /* An edit: what carried over is already here; make the rest. */
    const have = new Set((existing ?? []).filter((r) => r.status !== "failed").map((r) => `${r.engine}:${r.scene}`));
    jobs = jobs.filter((job) => !have.has(`${engineOf(job.kind)}:${job.n}`) && !(job.kind === "clip" && have.has(`avatar:${job.n}`)));
    for (const row of (existing ?? []).filter((r) => r.status === "failed" || r.engine === "compose" || r.engine === "part")) {
      await supabase.from("video_renders").delete().eq("id", row.id);
    }
    if (jobs.length === 0 && !(await covers(cutCost(plan)))) return shortOf(cutCost(plan));
    const filed = await fileUploads(supabase, { videoId: id, userId, version, plan });
    if (jobs.length === 0) {
      const service = createSupabaseServiceClient();
      if (service) {
        if (!(existing ?? []).some((r) => r.engine === "music" && r.status !== "failed")) await startMusic(service, { video_id: id, user_id: userId, version }, origin, plan);
        await advance(service, id, version, origin);
      }
      await supabase.from("video_projects").update({ status: "rendering" }).eq("id", id);
      return NextResponse.json({ queued: filed, failed: 0, cost: 0, readiness: ready });
    }
  } else if ((existing ?? []).some((r) => r.status === "queued" || r.status === "running")) {
    return NextResponse.json({ error: "This version is already generating." }, { status: 409 });
  } else {
    /* A fresh render: nothing of the last one carries over. */
    await supabase.from("video_renders").delete().eq("video_id", id).eq("version", version);
  }

  /* The person's own clips, pictures and music: filed as they are, free. */
  if (jobs.length === 0 && body.retryFailed !== true && body.onlyMissing !== true && !(await covers(renderCost(plan, process.env, answers.quality ?? null)))) {
    return shortOf(renderCost(plan, process.env, answers.quality ?? null));
  }
  const uploaded = body.retryFailed === true ? 0 : body.onlyMissing === true ? 0 : await fileUploads(supabase, { videoId: id, userId, version, plan });
  if (jobs.length === 0) {
    if (!uploaded) return NextResponse.json({ error: "There is nothing to generate in this plan yet." }, { status: 400 });
    const service = createSupabaseServiceClient();
    if (service) {
      await startMusic(service, { video_id: id, user_id: userId, version }, origin, plan);
      await advance(service, id, version, origin);
    }
    await supabase.from("video_projects").update({ status: "rendering" }).eq("id", id);
    return NextResponse.json({ queued: uploaded, failed: 0, cost: renderCost(plan, process.env, answers.quality ?? null), readiness: ready });
  }

  const quality = answers.quality ?? null;
  const tier = tierFrom(process.env, quality);
  /* Spent MiniMax usage credit pauses n8n for everybody: straight to the main
     API until it is worth trying again (lib/video/credit.ts). */
  const n8nPaused = Boolean(await n8nPausedUntil(createSupabaseServiceClient()));
  const skip: ClipEngine[] = n8nPaused ? ["n8n"] : [];
  const cost = body.retryFailed === true || body.onlyMissing === true ? jobCost(jobs) + cutCost(plan) : renderCost(plan, process.env, quality, skip);
  const service = createSupabaseServiceClient();
  if (service) {
    const balance = await currentBalance(service, userId);
    if (balance && balance.daily + balance.rollover + balance.monthly + balance.topUp < cost) {
      return NextResponse.json({ error: `Generating this needs ${cost} credits. Top up to generate it.` }, { status: 402 });
    }
  }

  /* One row per job, replacing this version's earlier rows for the same jobs. */
  const keys = jobs.map((job) => ({ scene: job.n, engine: engineOf(job.kind) }));
  for (const key of keys) {
    await supabase.from("video_renders").delete().eq("video_id", id).eq("version", version).eq("scene", key.scene).eq("engine", key.engine);
  }
  const { error: insertError } = await supabase.from("video_renders").insert(
    keys.map((key) => ({ video_id: id, user_id: userId, version, scene: key.scene, engine: key.engine, provider: key.engine === "voice" && voiceDirect(process.env, tier, n8nPaused) ? "minimax:speech" : "n8n:minimax", status: "running" })),
  );
  if (insertError) return NextResponse.json({ error: "Could not start generating." }, { status: 500 });

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
  /* The cast's reference pictures, read for this video's owner only. */
  const pictures = plan.characters?.length ? await castPictures(writer ?? supabase, userId, plan.characters.map((c) => c.id)) : {};
  const keyframe =
    writer && wantsKeyframe(plan, (refs ?? []).some((asset) => asset.kind === "person"))
      ? await ensureKeyframe(writer, { userId, videoId: id, version, plan })
      : null;

  /* The look of the person's footage, when they marked a clip as the reference. */
  const look = writer ? await lookFrames(writer, plan) : [];
  const sent: { job: RenderJob; ok: boolean; error?: string }[] = [];
  /* Scenes that carry on from the one before wait for its last frame
     (continuity.ts); every other scene is filmed at once. */
  const links = continuityLinks(plan);
  const clipJobs = new Set(jobs.filter((job) => job.kind === "clip").map((job) => job.n));
  const releaseNow: number[] = [];
  const voices: Extract<RenderJob, { kind: "voice" }>[] = [];
  const toN8n = async (job: RenderJob) => (await dispatchJobs({ videoId: id, version, userId, aspect: plan.aspect, callbackUrl, jobs: [job] }))[0];

  /* Each job walks its chain in order. On the default "credit" tier n8n —
     the MiniMax usage credit — is first, and a paid engine is only reached
     when n8n refuses the job; a clip n8n later FAILS is handed on by the
     callback (results.ts retryClip). */
  /* A few at a time: a film can have hundreds of scenes, and the engines
     limit how many requests arrive at once. */
  await inBatches(
    jobs,
    8,
    async (job) => {
      if (job.kind === "voice") {
        if (voiceDirect(process.env, tier, n8nPaused)) {
          voices.push(job);
          return;
        }
        const result = await toN8n(job);
        if (result.ok) sent.push(result);
        else if (canSpeak()) {
          /* n8n could not take it: the same MiniMax voice, direct. */
          await supabase.from("video_renders").update({ provider: "minimax:speech" }).eq("video_id", id).eq("version", version).eq("scene", job.n).eq("engine", "voice");
          voices.push(job);
        } else {
          await fail(job, result.error ?? "Not sent.");
          sent.push(result);
        }
        return;
      }
      const waitsFor = links.get(job.n);
      if (waitsFor !== undefined) {
        await supabase
          .from("video_renders")
          .update({ status: "queued", provider: awaitProvider(waitsFor) })
          .eq("video_id", id)
          .eq("version", version)
          .eq("scene", job.n)
          .eq("engine", "video");
        /* The scene before is already made (an edit kept it): start at once. */
        if (!clipJobs.has(waitsFor)) releaseNow.push(waitsFor);
        sent.push({ job, ok: true });
        return;
      }
      const scene = plan.scenes.find((entry) => entry.n === job.n);
      /* A scene with a character is filmed from that character's pictures —
         the same pictures for every scene, so the face never drifts. When
         no reference engine takes it, it starts from their front picture. */
      const cast = scene ? sceneCast(scene, plan) : [];
      /* Pictures shared fairly: everyone's front first, then extra angles,
         and the prompt says which pictures are whose. A scene that will
         wait for its last frame is held back below. */
      const refPlan = planReferences(cast, pictures, { reserve: look.length ? Math.min(look.length, 3) : 0 });
      /* The characters' own pictures first, then the look of the person's footage (look.ts). */
      const references = scene && !scene.source ? [...refPlan.images, ...look].slice(0, 9) : refPlan.images;
      let frame: string | null = refPlan.images[0] ?? firstFrameUrl ?? (scene?.engine === "avatar" ? keyframe : null);
      let chain = routeClip({ pipeline: plan.pipeline, aspect: plan.aspect as Aspect, fromFrame: Boolean(frame), tier, skip, references: references.length > 0 });
      /* No connected engine can film this scene from text at this shape:
         make a still of it and animate that (frames.ts). */
      if (!chain.length && !frame && scene && writer) {
        frame = await ensureSceneFrame(writer, { userId, videoId: id, version, plan, scene });
        if (frame) chain = routeClip({ pipeline: plan.pipeline, aspect: plan.aspect as Aspect, fromFrame: true, tier, skip });
      }
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
          { prompt: scene ? `${castPrompt(clipPrompt(scene.motionPrompt || scene.visual), cast, refPlan)}${look.length && references.length > refPlan.images.length ? ` ${LOOK_NOTE}` : ""}` : job.prompt, seconds: scene?.duration ?? job.duration, aspect: plan.aspect as Aspect, imageUrl: frame, references, key: `${id}:${version}:${job.n}:${engine}` },
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
    },
  );

  /* Voice lines straight from MiniMax, after the answer: each takes a few
     seconds, and the studio watches the rows fill in. */
  if (voices.length && writer) {
    after(async () => {
      await Promise.all(
        voices.map(async (job) => {
          const spoken = await speak({ text: job.text, voiceId: job.voiceId, language: languageFor(answers) });
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

  if (releaseNow.length && writer) {
    for (const before of [...new Set(releaseNow)]) await releaseWaiting(writer, { videoId: id, version, n: before, origin });
  }

  const accepted = sent.filter((entry) => entry.ok).length + uploaded;
  if (accepted && body.retryFailed !== true && body.onlyMissing !== true) {
    const service = createSupabaseServiceClient();
    if (service) await startMusic(service, { video_id: id, user_id: userId, version }, origin, plan);
  }
  await supabase.from("video_projects").update({ status: accepted ? "rendering" : "failed" }).eq("id", id);
  if (!accepted) return NextResponse.json({ error: sent[0]?.error ?? "Generating could not be started." }, { status: 502 });
  return NextResponse.json({ queued: accepted, failed: sent.length - accepted, cost, readiness: ready });
}

/** Runs `work` over every item, at most `size` at once. */
async function inBatches<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await work(item);
      }
    }),
  );
}
