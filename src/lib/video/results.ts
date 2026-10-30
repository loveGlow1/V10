/* What happens when a clip or a voice line arrives — from any engine.
 *
 * Shared by the n8n callback, the clip engines' webhook and the studio's
 * recovery poll, so every route lands a result the same way:
 *
 *   1. the media is copied into the private video-assets bucket (provider
 *      URLs expire); if the copy fails the provider URL is kept;
 *   2. the job's row is marked done or failed;
 *   3. a delivered job is charged — once, by its dedupe key, at the price of
 *      the engine that made it — and a failed one is never charged;
 *   4. the production line is advanced (lip sync, avatar, the final cut);
 *   5. when nothing of the version is still running, the video is finished.
 *
 * A clip that FAILS on one engine is handed to the next one in its chain
 * before it is called failed: retryClip. The chain only moves forward, so a
 * scene is tried at most once per engine.
 *
 * Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";

import { chargeCredits } from "@/lib/credits-server";

import { type Aspect, type ClipEngine, clipCost, parseProvider, providerOf, routeClip, tierFrom } from "./clip-engines";
import { frameFor } from "./frames";
import type { ProductionPlan } from "./plan";
import { advance } from "./production";
import { clipWebhookUrl, speak, submitClip } from "./providers";
import { VOICE_COST, clipPrompt, languageFor, voiceIdFor } from "./render";

export type Landing = {
  videoId: string;
  version: number;
  kind: "clip" | "voice";
  n: number;
  /** The media, when it arrived. */
  url?: string | null;
  /** Bytes already in hand (a voice line made in this request). */
  bytes?: Buffer | null;
  error?: string | null;
  /** The engine that made a clip — decides its price. */
  engine?: ClipEngine | null;
  origin: string;
};

/** Lands one result. Never throws. */
export async function landResult(service: SupabaseClient, landing: Landing): Promise<void> {
  const { videoId: id, version, kind, n } = landing;
  const { data: video } = await service.from("video_projects").select("id, user_id, title").eq("id", id).maybeSingle();
  if (!video) return;
  const engine = kind === "clip" ? "video" : "voice";
  const url = landing.url && /^https:\/\//.test(landing.url) ? landing.url : null;
  const delivered = Boolean(url || landing.bytes?.length);

  let output: string | null = url;
  try {
    let body: ArrayBuffer | Buffer | null = landing.bytes ?? null;
    let type = kind === "clip" ? "video/mp4" : "audio/mpeg";
    if (!body && url) {
      const media = await fetch(url, { signal: AbortSignal.timeout(40000) });
      if (media.ok) {
        type = media.headers.get("content-type") ?? type;
        body = await media.arrayBuffer();
      }
    }
    if (body) {
      const path = `${video.user_id}/${id}/v${version}/${kind}-${n}.${kind === "clip" ? "mp4" : "mp3"}`;
      const { error } = await service.storage.from("video-assets").upload(path, body, { contentType: type, upsert: true });
      if (!error) output = `storage:${path}`;
    }
  } catch {
    /* Keep the provider URL; it plays until it expires. */
  }

  await service
    .from("video_renders")
    .update({
      status: delivered && output ? "done" : "failed",
      output_path: output,
      error: delivered && output ? null : String(landing.error ?? "Nothing was returned.").slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("video_id", id)
    .eq("version", version)
    .eq("scene", n)
    .eq("engine", engine);

  if (delivered && output) {
    await chargeCredits(service, {
      userId: video.user_id,
      action: "generate",
      cost: kind === "clip" ? clipCost(landing.engine ?? null) : VOICE_COST,
      description: `Video ${kind} ${n}: ${video.title}`,
      dedupeKey: `video-job:${id}:${version}:${kind}:${n}`,
    });
  }

  await advance(service, id, version, landing.origin);
  await settleVideo(service, id, version);
}

/** Finished when nothing is still running: ready if any picture landed. */
export async function settleVideo(service: SupabaseClient, id: string, version: number): Promise<void> {
  const { data: rows } = await service.from("video_renders").select("engine, status").eq("video_id", id).eq("version", version);
  const open = (rows ?? []).some((row) => row.status === "running" || row.status === "queued");
  if (open) return;
  const pictures = (rows ?? []).some((row) => (row.engine === "video" || row.engine === "avatar") && row.status === "done");
  await service.from("video_projects").update({ status: pictures ? "ready" : "failed" }).eq("id", id);
}

/**
 * A clip failed on `failed`: hand it to the next engine in its chain. True
 * when another engine took it (the row stays running), false when none is
 * left and it should be landed as failed.
 */
export async function retryClip(
  service: SupabaseClient,
  input: { videoId: string; version: number; n: number; failed: ClipEngine; origin: string },
): Promise<boolean> {
  const [{ data: video }, { data: planRow }] = await Promise.all([
    service.from("video_projects").select("user_id, answers").eq("id", input.videoId).maybeSingle(),
    service.from("video_versions").select("plan").eq("video_id", input.videoId).eq("version", input.version).maybeSingle(),
  ]);
  const plan = planRow?.plan as ProductionPlan | undefined;
  const scene = plan?.scenes.find((s) => s.n === input.n);
  if (!video || !plan || !scene) return false;

  /* The same frame the first engine started from, so the next one keeps the
     same face and the same photo. */
  const frame = await frameFor(service, { userId: video.user_id as string, videoId: input.videoId, version: input.version, plan, scene });
  const answers = (video.answers ?? {}) as Record<string, string>;
  const chain = routeClip({ pipeline: plan.pipeline, aspect: plan.aspect as Aspect, fromFrame: Boolean(frame), tier: tierFrom(process.env, answers.quality) });
  /* Forward only, and never back to n8n: a clip handed on from n8n has
     already had its turn on the usage credit. */
  const next = chain.slice(chain.indexOf(input.failed) + 1).filter((engine) => engine !== "n8n");
  for (const engine of next) {
    const sent = await submitClip(
      engine,
      { prompt: clipPrompt(scene.motionPrompt || scene.visual, Boolean(scene.voiceover.trim())), seconds: scene.duration, aspect: plan.aspect as Aspect, imageUrl: frame, key: `${input.videoId}:${input.version}:${input.n}:${engine}` },
      clipWebhookUrl(input.origin, input.videoId, input.version, input.n, engine),
    );
    if (sent.ok) {
      await service
        .from("video_renders")
        .update({ provider: providerOf(engine, sent.id), status: "running", updated_at: new Date().toISOString() })
        .eq("video_id", input.videoId)
        .eq("version", input.version)
        .eq("scene", input.n)
        .eq("engine", "video");
      return true;
    }
  }
  return false;
}

/** The engine a running clip row is on, from its provider column. */
export const engineOfRow = (provider: string | null | undefined) => parseProvider(provider);

/**
 * Every n8n job of a render that is still waiting, handed on at once — the
 * moment n8n says its MiniMax usage credit is spent (credit.ts). Clips go to
 * the next engine in their chain; voice lines to MiniMax speech when there is
 * a key. A job nothing else can take is left to report or time out as it was.
 */
export async function failoverN8n(service: SupabaseClient, input: { videoId: string; version: number; origin: string }): Promise<number> {
  const { data: rows } = await service
    .from("video_renders")
    .select("scene, engine")
    .eq("video_id", input.videoId)
    .eq("version", input.version)
    .eq("provider", "n8n:minimax")
    .eq("status", "running");
  const waiting = (rows ?? []).filter((row): row is { scene: number; engine: string } => row.scene !== null);
  if (!waiting.length) return 0;

  const [{ data: planRow }, { data: video }] = await Promise.all([
    service.from("video_versions").select("plan").eq("video_id", input.videoId).eq("version", input.version).maybeSingle(),
    service.from("video_projects").select("answers").eq("id", input.videoId).maybeSingle(),
  ]);
  const plan = planRow?.plan as ProductionPlan | undefined;
  const answers = (video?.answers ?? {}) as Record<string, string>;

  const moved = await Promise.all(
    waiting.map(async (row) => {
      if (row.engine === "video") return retryClip(service, { videoId: input.videoId, version: input.version, n: row.scene, failed: "n8n", origin: input.origin });
      if (row.engine !== "voice" || !process.env.MINIMAX_API_KEY || !plan) return false;
      const line = plan.scenes.find((scene) => scene.n === row.scene)?.voiceover.replace(/^[A-Z][A-Za-z .'-]{0,24}:\s*/, "").trim();
      if (!line) return false;
      /* Claimed first, so a late n8n reply for the same line is ignored. */
      await service
        .from("video_renders")
        .update({ provider: "minimax:speech", updated_at: new Date().toISOString() })
        .eq("video_id", input.videoId)
        .eq("version", input.version)
        .eq("scene", row.scene)
        .eq("engine", "voice");
      const spoken = await speak({ text: line, voiceId: voiceIdFor(answers), language: languageFor(answers) });
      await landResult(service, { videoId: input.videoId, version: input.version, kind: "voice", n: row.scene, bytes: spoken.ok ? spoken.audio : null, error: spoken.ok ? null : spoken.error, origin: input.origin });
      return true;
    }),
  );
  return moved.filter(Boolean).length;
}
