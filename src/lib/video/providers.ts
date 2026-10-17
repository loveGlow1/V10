/* The clip engines' own APIs — submit a clip, read where it is, and speak a
 * voice line. One function each, answering instead of throwing.
 *
 *   Higgsfield   POST https://api.higgsfield.ai/{model}?hf_webhook=…
 *                Authorization: Key {HF_API_KEY_ID}:{HF_API_KEY_SECRET}
 *                GET  /requests/{id}/status → status, video.url
 *   MiniMax      POST https://api.minimax.io/v1/video_generation (callback_url)
 *                GET  /v1/query/video_generation?task_id → Success + file_id
 *                GET  /v1/files/retrieve?file_id → file.download_url
 *                POST /v1/t2a_v2 → the voice line, as hex
 *   fal          the queue, through fal.ts's submitFal
 *
 * Every engine calls back to /api/video/{id}/render/clip with an HMAC token
 * for this video, version and scene in the address — and the callback then
 * asks the engine itself before believing anything (clipStatus), so a forged
 * delivery cannot put somebody else's video into a render.
 *
 * Server-only: the keys never leave this file. */

import { type Aspect, type ClipEngine, durationFor } from "./clip-engines";
import { falToken, submitFal } from "./fal";

export const HF_BASE = "https://api.higgsfield.ai";
export const MINIMAX_BASE = "https://api.minimax.io";
export const FAL_SEEDANCE = "fal-ai/bytedance/seedance/v1.5/pro/text-to-video";
export const MINIMAX_VIDEO_MODEL = "MiniMax-Hailuo-2.3";

const HF_MODELS = {
  seedance: { text: "bytedance/seedance-2.0/text-to-video", image: "bytedance/seedance-2.0/image-to-video" },
  kling: { text: "kling-video/v2.5-turbo/pro/text-to-video", image: "kling-video/v2.5-turbo/pro/image-to-video" },
} as const;

export type ClipRequest = { prompt: string; seconds: number; aspect: Aspect; imageUrl?: string | null; key: string };
export type Submitted = { ok: true; id: string; seconds: number } | { ok: false; error: string };
export type ClipState = { state: "running" } | { state: "done"; url: string } | { state: "failed"; error: string };

const hfAuth = () => `Key ${process.env.HF_API_KEY_ID}:${process.env.HF_API_KEY_SECRET}`;
const mmAuth = () => `Bearer ${process.env.MINIMAX_API_KEY}`;
/* Seedance has 3:4, not 4:5; the nearest portrait shape. */
const seedanceAspect = (aspect: Aspect) => (aspect === "4:5" ? "3:4" : aspect);
const https = (value: unknown): string | null => (typeof value === "string" && /^https:\/\//.test(value) ? value : null);

/** The address an engine reports to for one scene of one render. */
export function clipWebhookUrl(origin: string, videoId: string, version: number, scene: number, engine: ClipEngine): string {
  const job = `clip:${scene}`;
  const query = new URLSearchParams({ v: String(version), scene: String(scene), engine, t: falToken(videoId, version, job) });
  return `${origin}/api/video/${videoId}/render/clip?${query}`;
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as Record<string, unknown> | null };
}

async function get(url: string, headers: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000), cache: "no-store" });
  return { status: response.status, json: (await response.json().catch(() => null)) as Record<string, unknown> | null };
}

const MINIMAX_ERRORS: Record<number, string> = {
  1002: "MiniMax is rate-limiting right now",
  1004: "the MiniMax key was refused",
  1008: "the MiniMax account is out of credit",
  1026: "MiniMax refused the prompt as sensitive",
  1027: "MiniMax refused the generated video as sensitive",
  2013: "MiniMax refused the settings",
  2049: "the MiniMax key is not valid",
};

/** Queues one clip. Never throws. */
export async function submitClip(engine: ClipEngine, clip: ClipRequest, webhookUrl: string): Promise<Submitted> {
  const seconds = durationFor(engine, clip.seconds);
  const prompt = clip.prompt.slice(0, 1900);
  try {
    if (engine === "seedance" || engine === "kling") {
      const model = clip.imageUrl ? HF_MODELS[engine].image : HF_MODELS[engine].text;
      const body: Record<string, unknown> =
        engine === "seedance"
          ? {
              prompt,
              duration: seconds,
              resolution: "1080p",
              /* The voice, lip sync and music are laid on by the production
                 line; a clip that brought its own audio would talk over them. */
              generate_audio: false,
              ...(clip.imageUrl ? { image_url: clip.imageUrl } : { aspect_ratio: seedanceAspect(clip.aspect) }),
            }
          : {
              prompt,
              duration: seconds,
              negative_prompt: "blurry, warped hands, extra fingers, distorted face, text artifacts, watermark",
              ...(clip.imageUrl ? { image_url: clip.imageUrl } : {}),
            };
      const sent = await post(`${HF_BASE}/${model}?hf_webhook=${encodeURIComponent(webhookUrl)}`, { Authorization: hfAuth(), "Idempotency-Key": clip.key }, body);
      const id = typeof sent.json?.request_id === "string" ? sent.json.request_id : null;
      return id ? { ok: true, id, seconds } : { ok: false, error: `Higgsfield refused the clip (${sent.status})${sent.json?.detail ? `: ${String(sent.json.detail).slice(0, 200)}` : ""}` };
    }

    if (engine === "minimax") {
      const sent = await post(`${MINIMAX_BASE}/v1/video_generation`, { Authorization: mmAuth() }, {
        model: MINIMAX_VIDEO_MODEL,
        prompt,
        duration: seconds,
        /* 1080P is offered for 6s only; 10s is 768P. */
        resolution: seconds === 6 ? "1080P" : "768P",
        ...(clip.imageUrl ? { first_frame_image: clip.imageUrl } : {}),
        callback_url: webhookUrl,
      });
      const code = Number((sent.json?.base_resp as { status_code?: unknown } | undefined)?.status_code ?? -1);
      const id = typeof sent.json?.task_id === "string" ? sent.json.task_id : null;
      if (code === 0 && id) return { ok: true, id, seconds };
      return { ok: false, error: MINIMAX_ERRORS[code] ? `${MINIMAX_ERRORS[code]}.` : `MiniMax refused the clip (${sent.status}).` };
    }

    if (engine === "seedance-fal") {
      const sent = await submitFal(FAL_SEEDANCE, {
        prompt,
        aspect_ratio: seedanceAspect(clip.aspect),
        resolution: "1080p",
        duration: String(seconds),
        generate_audio: false,
      }, webhookUrl);
      return "requestId" in sent ? { ok: true, id: sent.requestId, seconds } : { ok: false, error: sent.error };
    }

    return { ok: false, error: "That engine is dispatched through n8n." };
  } catch {
    return { ok: false, error: `Could not reach ${engine === "minimax" ? "MiniMax" : engine === "seedance-fal" ? "fal" : "Higgsfield"}.` };
  }
}

/** Where a clip is, asked of the engine itself — the only answer a callback is believed against. */
export async function clipStatus(engine: ClipEngine, id: string): Promise<ClipState> {
  try {
    if (engine === "seedance" || engine === "kling") {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return { state: "failed", error: "Not a Higgsfield request." };
      const read = await get(`${HF_BASE}/requests/${id}/status`, { Authorization: hfAuth() });
      const status = String(read.json?.status ?? "");
      if (status === "completed") {
        const url = https((read.json?.video as { url?: unknown } | undefined)?.url);
        return url ? { state: "done", url } : { state: "failed", error: "Higgsfield finished without a video." };
      }
      if (status === "failed") return { state: "failed", error: String(read.json?.error ?? "Higgsfield could not make this clip.").slice(0, 500) };
      if (status === "nsfw") return { state: "failed", error: "Higgsfield's moderation rejected this scene." };
      if (status === "canceled") return { state: "failed", error: "The clip was cancelled." };
      return { state: "running" };
    }

    if (engine === "minimax") {
      const read = await get(`${MINIMAX_BASE}/v1/query/video_generation?task_id=${encodeURIComponent(id)}`, { Authorization: mmAuth() });
      const status = String(read.json?.status ?? "");
      if (status === "Fail") {
        const code = Number((read.json?.base_resp as { status_code?: unknown } | undefined)?.status_code ?? -1);
        return { state: "failed", error: MINIMAX_ERRORS[code] ? `${MINIMAX_ERRORS[code]}.` : "MiniMax could not make this clip." };
      }
      if (status !== "Success") return { state: "running" };
      const fileId = read.json?.file_id;
      if (!fileId) return { state: "failed", error: "MiniMax finished without a file." };
      const file = await get(`${MINIMAX_BASE}/v1/files/retrieve?file_id=${encodeURIComponent(String(fileId))}`, { Authorization: mmAuth() });
      const url = https((file.json?.file as { download_url?: unknown } | undefined)?.download_url);
      return url ? { state: "done", url } : { state: "failed", error: "MiniMax's file could not be retrieved." };
    }

    /* fal reports through its webhook, which is verified by fal's own
       signature as well as our token; there is nothing to poll here. */
    return { state: "running" };
  } catch {
    return { state: "running" };
  }
}

/* ── Voice ────────────────────────────────────────────────────────────── */

export const MINIMAX_SPEECH_MODEL = "speech-2.6-hd";

/** One voice line through MiniMax's own speech API. MP3 bytes, or why not. */
export async function speak(input: { text: string; voiceId: string; language: string }): Promise<{ ok: true; audio: Buffer } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${MINIMAX_BASE}/v1/t2a_v2`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: mmAuth() },
      body: JSON.stringify({
        model: process.env.MINIMAX_SPEECH_MODEL || MINIMAX_SPEECH_MODEL,
        text: input.text.slice(0, 3000),
        stream: false,
        voice_setting: { voice_id: input.voiceId, speed: 1, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 44100, bitrate: 128000, format: "mp3", channel: 1 },
        language_boost: input.language,
        output_format: "hex",
      }),
      signal: AbortSignal.timeout(45000),
      cache: "no-store",
    });
    const json = (await response.json().catch(() => null)) as { data?: { audio?: string } | null; base_resp?: { status_code?: number } } | null;
    const code = Number(json?.base_resp?.status_code ?? -1);
    const hex = json?.data?.audio;
    if (code === 0 && typeof hex === "string" && hex.length > 0) return { ok: true, audio: Buffer.from(hex, "hex") };
    return { ok: false, error: MINIMAX_ERRORS[code] ? `${MINIMAX_ERRORS[code]}.` : `MiniMax could not voice this line (${response.status}).` };
  } catch {
    return { ok: false, error: "Could not reach MiniMax for the voice." };
  }
}
