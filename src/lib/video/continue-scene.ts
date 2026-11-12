/* A waiting scene, filmed from the last frame of the scene before
 * (continuity.ts). Runs in /api/video/[id]/render/continue, which carries
 * ffmpeg.
 *
 *   1. claim the waiting row (once — a second caller finds it taken)
 *   2. the scene before: its clip's last frame, stored beside the render
 *   3. film this scene: a character scene gets the frame as one more
 *      reference picture after the character's own; any other scene starts
 *      from it as its first frame. When the scene before failed there is no
 *      frame, and the scene is filmed as it would have been anyway.
 *
 * Never throws: a scene nothing can film lands as failed, with the reason.
 *
 * Server-only. */

import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import { castPrompt, planReferences, sceneCast } from "./cast";
import { castPictures } from "./characters";
import { type Aspect, type ClipEngine, providerOf, routeClip, tierFrom } from "./clip-engines";
import { CONTINUE_FRAME_NOTE, CONTINUE_NOTE, awaitedScene, lastFrameArgs, withLastFrame } from "./continuity";
import { frameFor } from "./frames";
import { downloadTo, runFfmpeg } from "./media-files";
import type { ProductionPlan } from "./plan";
import { signedUrl } from "./production";
import { clipWebhookUrl, submitClip } from "./providers";
import { clipPrompt } from "./render";
import { landResult } from "./results";

/** The last frame of a clip, stored at `path`. A link to it, or null. */
async function lastFrameOf(service: SupabaseClient, clipUrl: string, path: string): Promise<string | null> {
  const dir = `/tmp/qs-last-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await mkdir(dir, { recursive: true });
    const clip = join(dir, "clip.mp4");
    const frame = join(dir, "last.jpg");
    if (!(await downloadTo(clipUrl, clip, 60_000))) return null;
    await runFfmpeg(lastFrameArgs({ source: clip, out: frame }), 60_000);
    if ((await stat(frame)).size < 1000) return null;
    const { error } = await service.storage.from("video-assets").upload(path, await readFile(frame), { contentType: "image/jpeg", upsert: true });
    if (error) return null;
    return await signedUrl(service, `storage:${path}`);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function continueScene(service: SupabaseClient, input: { videoId: string; version: number; n: number; origin: string }): Promise<void> {
  const { videoId, version, n, origin } = input;
  const row = (await service.from("video_renders").select("provider, status").eq("video_id", videoId).eq("version", version).eq("scene", n).eq("engine", "video").maybeSingle()).data;
  const waitedFor = awaitedScene(row?.provider);
  if (!row || row.status !== "queued" || waitedFor === null) return;
  /* 1. Claimed: only the caller that moves it off "await:" goes on. */
  const { data: claimed } = await service
    .from("video_renders")
    .update({ provider: "continuing", status: "running", updated_at: new Date().toISOString() })
    .eq("video_id", videoId)
    .eq("version", version)
    .eq("scene", n)
    .eq("engine", "video")
    .eq("provider", row.provider)
    .select("id");
  if (!claimed?.length) return;

  try {
    const [{ data: video }, { data: planRow }] = await Promise.all([
      service.from("video_projects").select("user_id, answers").eq("id", videoId).maybeSingle(),
      service.from("video_versions").select("plan").eq("video_id", videoId).eq("version", version).maybeSingle(),
    ]);
    const plan = planRow?.plan as ProductionPlan | undefined;
    const scene = plan?.scenes.find((s) => s.n === n);
    if (!video || !plan || !scene) {
      await landResult(service, { videoId, version, kind: "clip", n, error: "The scene could not be found.", origin });
      return;
    }
    const userId = video.user_id as string;

    /* 2. Where the scene before ended. */
    const { data: before } = await service.from("video_renders").select("status, output_path").eq("video_id", videoId).eq("version", version).eq("scene", waitedFor).eq("engine", "video").maybeSingle();
    const beforeUrl = before?.status === "done" ? await signedUrl(service, before.output_path as string | null) : null;
    const lastFrame = beforeUrl ? await lastFrameOf(service, beforeUrl, `${userId}/${videoId}/v${version}/last-${waitedFor}.jpg`) : null;

    /* 3. Filmed from it. */
    const cast = sceneCast(scene, plan);
    /* The last frame takes a spare slot only — never a character's only picture. */
    const refPlan = planReferences(cast, cast.length ? await castPictures(service, userId, cast.map((c) => c.id)) : {}, { reserve: lastFrame ? 1 : 0 });
    const own = refPlan.images;
    const references = own.length ? withLastFrame(own, lastFrame) : [];
    const frame = lastFrame ?? own[0] ?? (await frameFor(service, { userId, videoId, version, plan, scene }));
    const note = lastFrame ? (references.length ? CONTINUE_NOTE : CONTINUE_FRAME_NOTE) : "";
    const prompt = `${castPrompt(clipPrompt(scene.motionPrompt || scene.visual), cast, refPlan)}${note ? ` ${note}` : ""}`;
    const answers = (video.answers ?? {}) as Record<string, string>;
    const chain: ClipEngine[] = routeClip({
      pipeline: plan.pipeline,
      aspect: plan.aspect as Aspect,
      fromFrame: Boolean(frame),
      tier: tierFrom(process.env, answers.quality),
      references: references.length > 0,
      skip: ["n8n"],
    });
    let reason = "No connected video engine can film this scene.";
    for (const engine of chain) {
      const sent = await submitClip(
        engine,
        { prompt, seconds: scene.duration, aspect: plan.aspect as Aspect, imageUrl: frame, references, key: `${videoId}:${version}:${n}:${engine}:continue` },
        clipWebhookUrl(origin, videoId, version, n, engine),
      );
      if (sent.ok) {
        await service
          .from("video_renders")
          .update({ provider: providerOf(engine, sent.id), status: "running", updated_at: new Date().toISOString() })
          .eq("video_id", videoId)
          .eq("version", version)
          .eq("scene", n)
          .eq("engine", "video");
        return;
      }
      reason = sent.error;
    }
    await landResult(service, { videoId, version, kind: "clip", n, error: reason, origin });
  } catch (error) {
    await landResult(service, { videoId, version, kind: "clip", n, error: error instanceof Error ? error.message : "The scene could not be continued.", origin });
  }
}
