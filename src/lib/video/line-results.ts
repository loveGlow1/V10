/* What happens when a production-line job lands — a lip sync, a talking
 * portrait, the music or fal's final compose — from fal or from Runware.
 *
 * Shared by fal's webhook (/render/fal), Runware's (/render/line) and the
 * studio's recovery poll, so every one lands the same way:
 *
 *   1. the media is copied into the private video-assets bucket (provider
 *      URLs expire); if the copy fails the provider URL is kept;
 *   2. the job's row is marked done or failed;
 *   3. a delivered job is charged once, by its dedupe key — a failed one
 *      never is (a failed lip sync leaves the scene as it was: the clip with
 *      its voice over it);
 *   4. a compose finishes the video; anything else advances the line.
 *
 * Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";

import { chargeCredits } from "@/lib/credits-server";
import { runwareTaskStatus } from "@/lib/runware";

import { announceFinal } from "./announce";
import { productionJobCost, productionTier, settleRunwareCredits } from "./engines";
import type { FalJob } from "./fal";
import type { ProductionPlan } from "./plan";
import { advance, lineTaskOf } from "./production";
import { settleVideo } from "./results";

export type LineLanding = {
  videoId: string;
  version: number;
  job: FalJob;
  /** The media, when it arrived. */
  mediaUrl: string | null;
  error?: string | null;
  /** Credits for a delivered job. */
  cost: number;
  dedupeKey: string;
  origin: string;
};

/** Lands one production job. Never throws. */
export async function landLineJob(service: SupabaseClient, landing: LineLanding): Promise<void> {
  const { videoId: id, version, job, mediaUrl: media } = landing;
  try {
    const { data: video } = await service.from("video_projects").select("id, user_id, title").eq("id", id).maybeSingle();
    if (!video) return;

    let output: string | null = media;
    if (media) {
      try {
        const file = await fetch(media, { signal: AbortSignal.timeout(60000) });
        if (file.ok) {
          const ext = job.engine === "music" ? "mp3" : "mp4";
          const name = job.engine === "compose" ? `final.${ext}` : job.engine === "music" ? `music.${ext}` : `avatar-${job.scene}.${ext}`;
          const path = `${video.user_id}/${id}/v${version}/${name}`;
          const type = file.headers.get("content-type") ?? (ext === "mp3" ? "audio/mpeg" : "video/mp4");
          const { error } = await service.storage.from("video-assets").upload(path, await file.arrayBuffer(), { contentType: type, upsert: true });
          if (!error) output = `storage:${path}`;
        }
      } catch {
        /* Keep the provider's URL; it plays until it expires. */
      }
    }

    const failure = media ? null : String(landing.error ?? "No media was returned.").slice(0, 2000);
    const update = service
      .from("video_renders")
      .update({ status: media ? "done" : "failed", output_path: output, error: failure, updated_at: new Date().toISOString() })
      .eq("video_id", id)
      .eq("version", version)
      .eq("engine", job.engine);
    await (job.scene === null ? update.is("scene", null) : update.eq("scene", job.scene));

    if (media) {
      await chargeCredits(service, {
        userId: video.user_id,
        action: "generate",
        cost: landing.cost,
        description: `Video ${job.engine}${job.scene ? ` ${job.scene}` : ""}: ${video.title}`,
        videoId: id,
        dedupeKey: landing.dedupeKey,
      });
    }

    if (job.engine === "compose") {
      if (media && output?.startsWith("storage:")) {
        await service.from("video_assets").insert({ video_id: id, user_id: video.user_id, kind: "render", storage_path: output.slice(8), mime: "video/mp4" });
      }
      /* The scenes are what the cut is made of; a failed compose still
         leaves a playable video in the studio. */
      await service.from("video_projects").update({ status: "ready" }).eq("id", id);
      if (media) await announceFinal(service, { videoId: id, version, origin: landing.origin });
      return;
    }
    await advance(service, id, version, landing.origin);
    await settleVideo(service, id, version);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("video line landing:", error);
  }
}

/**
 * A Runware production job's state, asked of Runware, and landed when it is
 * finished — from the webhook or from the studio's poll. The charge is what
 * Runware billed (includeCost) in credits, never more than 10% over the
 * quote. "running" when there is nothing to land yet.
 */
export async function settleRunwareLineJob(
  service: SupabaseClient,
  input: { videoId: string; version: number; job: FalJob; provider: string | null; origin: string },
): Promise<"running" | "landed" | "ignored"> {
  const taskUUID = lineTaskOf(input.provider);
  if (!taskUUID) return "ignored";
  const state = await runwareTaskStatus(taskUUID);
  if (state.state === "running") return "running";

  const [{ data: video }, { data: planRow }] = await Promise.all([
    service.from("video_projects").select("pipeline, answers").eq("id", input.videoId).maybeSingle(),
    service.from("video_versions").select("plan").eq("video_id", input.videoId).eq("version", input.version).maybeSingle(),
  ]);
  const plan = planRow?.plan as ProductionPlan | undefined;
  const tier = productionTier(((video?.answers ?? {}) as Record<string, string>).quality);
  const seconds =
    input.job.engine === "music"
      ? (plan?.scenes ?? []).reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0)
      : Number(plan?.scenes.find((scene) => scene.n === input.job.scene)?.duration) || 6;
  const kind = input.job.engine === "music" ? "music" : video?.pipeline === "clone" ? "avatar" : "lipsync";
  const quoted = productionJobCost("runware", kind, seconds, tier);

  await landLineJob(service, {
    videoId: input.videoId,
    version: input.version,
    job: input.job,
    mediaUrl: state.state === "done" ? state.url : null,
    error: state.state === "failed" ? state.error : null,
    cost: state.state === "done" ? settleRunwareCredits(quoted, state.cost) : 0,
    dedupeKey: `video-line:${input.videoId}:${input.version}:${input.job.engine}${input.job.scene === null ? "" : `:${input.job.scene}`}:${taskUUID}`,
    origin: input.origin,
  });
  return "landed";
}
