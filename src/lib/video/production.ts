/* What happens after each piece of a render arrives — the production line.
 *
 * Called after every result (a clip, a voice line, a lip sync, an avatar,
 * the music). It looks at the version's rows and starts whatever is now
 * possible, exactly once (video_renders has one row per job, so a second
 * caller's insert is refused and it starts nothing):
 *
 *   1. a scene whose clip AND voice are in, and which is on-camera
 *      (engine "avatar", not a clone)        → lip sync (clip + ITS OWN line)
 *   2. a clone's presenter scene whose voice is in → a talking portrait
 *      (photo + voice)
 *   3. nothing left running, every scene has a picture → the final cut: one
 *      MP4, made on this server with ffmpeg (compose-local.ts) — voice, the
 *      score ducked under it, captions — or by fal's compose on the fal line
 *
 * Steps 1 and 2 and the score run on the production engine
 * (engines.ts productionEngine): Runware — sync lipsync-2-pro, Kling Avatar
 * 2.0, ACE-Step — when RUNWARE_API_KEY is set, else fal. Each Runware job is
 * queued async; it reports to /api/video/[id]/render/line and is landed by
 * line-results.ts.
 *
 * Lip sync never runs on the music mix, only on the scene's own voice line,
 * and never with sync's default "bounce", which plays the voice backwards to
 * fill time (runware.ts syncModeFor). A lip sync that fails leaves the scene
 * as it was — the clip with its voice over it — and is not charged.
 *
 * Server-only; runs under the service key (it is called from callbacks). */

import type { SupabaseClient } from "@supabase/supabase-js";

import { avatarTask, lipsyncTask, musicTask, submitRunwareTask, syncModeFor } from "@/lib/runware";
import { randomUUID } from "node:crypto";

import { productionEngine, productionTier, wantsMusic } from "./engines";
import { FAL, falToken, falWebhookUrl, jobKey, submitFal, type FalJob } from "./fal";
import type { ProductionPlan } from "./plan";
import { mediaSeconds } from "./probe";

type Row = { scene: number | null; engine: string; status: string; output_path: string | null };

export async function signedUrl(service: SupabaseClient, output: string | null): Promise<string | null> {
  if (!output) return null;
  if (output.startsWith("https://")) return output;
  if (!output.startsWith("storage:")) return null;
  const { data } = await service.storage.from("video-assets").createSignedUrl(output.slice(8), 60 * 60);
  return data?.signedUrl ?? null;
}

/* Claims a job by inserting its row; false when another caller already has. */
async function claim(service: SupabaseClient, base: { video_id: string; user_id: string; version: number }, job: FalJob): Promise<boolean> {
  const { error } = await service
    .from("video_renders")
    .insert({ ...base, scene: job.scene, engine: job.engine, provider: "fal", status: "running" });
  return !error;
}

async function start(
  service: SupabaseClient,
  base: { video_id: string; user_id: string; version: number },
  origin: string,
  job: FalJob,
  model: string,
  input: Record<string, unknown>,
) {
  if (!(await claim(service, base, job))) return;
  const sent = await submitFal(model, input, falWebhookUrl(origin, base.video_id, base.version, job));
  const filter = service.from("video_renders").update(
    "requestId" in sent ? { provider: `fal:${sent.requestId}` } : { status: "failed", error: sent.error },
  ).eq("video_id", base.video_id).eq("version", base.version).eq("engine", job.engine);
  await (job.scene === null ? filter.is("scene", null) : filter.eq("scene", job.scene));
}

/* ── Runware jobs ───────────────────────────────────────────────────── */

/* A Runware production job's row says "rwline:<task uuid>". Not "runware:",
   which is a scene's clip (clip-engines.ts). */
export const LINE_PREFIX = "rwline:";
export const lineProvider = (taskUUID: string) => `${LINE_PREFIX}${taskUUID}`;
export const lineTaskOf = (provider: string | null | undefined) => (provider?.startsWith(LINE_PREFIX) ? provider.slice(LINE_PREFIX.length) : null);

/** Where Runware reports a production job: our HMAC token for exactly this video, version and job. */
export function lineWebhookUrl(origin: string, videoId: string, version: number, job: FalJob): string {
  const key = jobKey(job);
  const query = new URLSearchParams({ v: String(version), job: key, t: falToken(videoId, version, `line:${key}`) });
  return `${origin}/api/video/${videoId}/render/line?${query}`;
}

async function startRunware(
  service: SupabaseClient,
  base: { video_id: string; user_id: string; version: number },
  origin: string,
  job: FalJob,
  build: (taskUUID: string, webhookUrl: string) => Record<string, unknown>,
) {
  const { error } = await service.from("video_renders").insert({ ...base, scene: job.scene, engine: job.engine, provider: "runware-line", status: "running" });
  if (error) return;
  const taskUUID = randomUUID();
  const sent = await submitRunwareTask(build(taskUUID, lineWebhookUrl(origin, base.video_id, base.version, job)));
  const filter = service
    .from("video_renders")
    .update(sent.ok ? { provider: lineProvider(sent.id), updated_at: new Date().toISOString() } : { status: "failed", error: sent.error })
    .eq("video_id", base.video_id)
    .eq("version", base.version)
    .eq("engine", job.engine);
  await (job.scene === null ? filter.is("scene", null) : filter.eq("scene", job.scene));
}

/** Music for the whole cut, started with the render. */
export async function startMusic(service: SupabaseClient, base: { video_id: string; user_id: string; version: number }, origin: string, plan: ProductionPlan) {
  const line = productionEngine();
  if (!line || !wantsMusic(plan)) return;
  const total = plan.scenes.reduce((sum, scene) => sum + scene.duration, 0);
  if (line === "runware") {
    await startRunware(service, base, origin, { engine: "music", scene: null }, (taskUUID, webhookUrl) =>
      musicTask({ taskUUID, prompt: plan.music, seconds: total + 2, webhookUrl }),
    );
    return;
  }
  const seconds = Math.min(190, Math.max(5, total));
  await start(service, base, origin, { engine: "music", scene: null }, FAL.music, {
    prompt: `${plan.music}. Instrumental background score for a video, no vocals, clean mix.`,
    seconds_total: seconds,
  });
}

/* Without fal: once nothing is running and a scene has a picture, claim the
   compose row and have this server join the scenes (compose-local.ts), in a
   route of its own so the join has its full time budget. */
async function advanceLocal(service: SupabaseClient, videoId: string, version: number, origin: string): Promise<void> {
  try {
    const { data } = await service.from("video_renders").select("scene, engine, status, output_path").eq("video_id", videoId).eq("version", version);
    const rows = (data ?? []) as Row[];
    if (rows.some((row) => row.status === "running" || row.status === "queued") || rows.some((row) => row.engine === "compose")) return;
    if (!rows.some((row) => (row.engine === "video" || row.engine === "avatar") && row.status === "done")) return;
    const { data: video } = await service.from("video_projects").select("user_id").eq("id", videoId).maybeSingle();
    if (!video) return;
    const { error } = await service
      .from("video_renders")
      .insert({ video_id: videoId, user_id: video.user_id, version, scene: null, engine: "compose", provider: "local", status: "running" });
    if (error) return;
    const response = await fetch(`${origin}/api/video/${videoId}/render/compose?v=${version}&t=${falToken(videoId, version, "compose-local")}`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) {
      await service
        .from("video_renders")
        .update({ status: "failed", error: "The final cut could not be started." })
        .eq("video_id", videoId)
        .eq("version", version)
        .eq("engine", "compose");
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("video advance (local):", error);
  }
}

/** Starts whatever the version's rows now allow. Never throws. */
export async function advance(service: SupabaseClient, videoId: string, version: number, origin: string): Promise<void> {
  const line = productionEngine();
  if (!line) {
    await advanceLocal(service, videoId, version, origin);
    return;
  }
  try {
    const { data: video } = await service.from("video_projects").select("id, user_id, pipeline, answers").eq("id", videoId).maybeSingle();
    if (!video) return;
    const { data: planRow } = await service.from("video_versions").select("plan").eq("video_id", videoId).eq("version", version).maybeSingle();
    if (!planRow) return;
    const plan = planRow.plan as ProductionPlan;
    const { data } = await service.from("video_renders").select("scene, engine, status, output_path").eq("video_id", videoId).eq("version", version);
    const rows = (data ?? []) as Row[];
    const base = { video_id: videoId, user_id: video.user_id as string, version };
    const find = (scene: number | null, engine: string) => rows.find((row) => row.scene === scene && row.engine === engine);
    const clone = video.pipeline === "clone";
    const tier = productionTier(((video.answers ?? {}) as Record<string, string>).quality);

    /* 1 and 2: per on-camera scene. */
    let person: string | null = null;
    for (const scene of plan.scenes) {
      if (scene.engine !== "avatar" || find(scene.n, "avatar")) continue;
      const voice = find(scene.n, "voice");
      if (voice?.status !== "done") continue;
      const audioUrl = await signedUrl(service, voice.output_path);
      if (!audioUrl) continue;
      if (clone) {
        if (!person) {
          const { data: asset } = await service.from("video_assets").select("storage_path").eq("video_id", videoId).eq("kind", "person").order("created_at").limit(1).maybeSingle();
          if (asset) person = await signedUrl(service, `storage:${asset.storage_path}`);
        }
        if (!person) {
          await service.from("video_renders").insert({ ...base, scene: scene.n, engine: "avatar", provider: "fal", status: "failed", error: "Upload a clear photo of yourself in the studio, then retry." });
          continue;
        }
        const portrait = person;
        if (line === "runware") {
          await startRunware(service, base, origin, { engine: "avatar", scene: scene.n }, (taskUUID, webhookUrl) =>
            avatarTask({ taskUUID, imageUrl: portrait, audioUrl, tier, webhookUrl }),
          );
        } else {
          await start(service, base, origin, { engine: "avatar", scene: scene.n }, FAL.avatar, { image_url: portrait, audio_url: audioUrl });
        }
      } else {
        const clip = find(scene.n, "video");
        if (clip?.status !== "done") continue;
        const videoUrl = await signedUrl(service, clip.output_path);
        if (!videoUrl) continue;
        /* Measured, not assumed: a line no longer than its clip is synced
           as it is; a line that runs longer loops the picture under it. */
        const [voiceSeconds, clipSeconds] = await Promise.all([mediaSeconds(audioUrl), mediaSeconds(videoUrl)]);
        const syncMode = syncModeFor(voiceSeconds, clipSeconds);
        if (line === "runware") {
          await startRunware(service, base, origin, { engine: "avatar", scene: scene.n }, (taskUUID, webhookUrl) =>
            lipsyncTask({ taskUUID, videoUrl, audioUrl, syncMode, tier, webhookUrl }),
          );
        } else {
          await start(service, base, origin, { engine: "avatar", scene: scene.n }, FAL.lipsync, {
            video_url: videoUrl,
            audio_url: audioUrl,
            model: "lipsync-2",
            sync_mode: syncMode,
          });
        }
      }
    }

    /* 3: the final cut, once nothing is still running — made here unless
       this is the fal line. */
    if (line !== "fal") {
      await advanceLocal(service, videoId, version, origin);
      return;
    }
    const { data: fresh } = await service.from("video_renders").select("scene, engine, status, output_path").eq("video_id", videoId).eq("version", version);
    const now = (fresh ?? []) as Row[];
    if (now.some((row) => row.status === "running" || row.status === "queued") || now.some((row) => row.engine === "compose")) return;

    const pick = (scene: number, engine: string) => now.find((row) => row.scene === scene && row.engine === engine && row.status === "done");
    const videoKeys: { url: string; timestamp: number; duration: number }[] = [];
    const voiceKeys: { url: string; timestamp: number; duration: number }[] = [];
    let at = 0;
    for (const scene of plan.scenes) {
      const talking = pick(scene.n, "avatar");
      const picture = talking ?? pick(scene.n, "video");
      if (!picture) continue;
      const url = await signedUrl(service, picture.output_path);
      if (!url) continue;
      const ms = Math.round(scene.duration * 1000);
      videoKeys.push({ url, timestamp: at, duration: ms });
      /* A lip-synced or avatar clip already carries its line. */
      const voice = talking ? null : pick(scene.n, "voice");
      const voiceUrl = voice ? await signedUrl(service, voice.output_path) : null;
      if (voiceUrl) voiceKeys.push({ url: voiceUrl, timestamp: at, duration: ms });
      at += ms;
    }
    if (!videoKeys.length) return;

    const tracks: Record<string, unknown>[] = [{ id: "video", type: "video", keyframes: videoKeys }];
    if (voiceKeys.length) tracks.push({ id: "voice", type: "audio", keyframes: voiceKeys });
    /* Music goes into the file only when nothing is spoken: compose has no
       volume control, and a score at full level over a voice buries it. With
       a voice it is its own download and plays low under the studio player. */
    const music = now.find((row) => row.engine === "music" && row.status === "done");
    const spoken = voiceKeys.length > 0 || now.some((row) => row.engine === "avatar" && row.status === "done");
    if (music && !spoken) {
      const musicUrl = await signedUrl(service, music.output_path);
      if (musicUrl) tracks.push({ id: "music", type: "audio", keyframes: [{ url: musicUrl, timestamp: 0, duration: at }] });
    }
    await start(service, base, origin, { engine: "compose", scene: null }, FAL.compose, { tracks });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("video advance:", error);
  }
}
