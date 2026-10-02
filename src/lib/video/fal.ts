/* fal.ai — the production half of rendering: lip sync, the clone avatar,
 * music, and the final MP4. One key (FAL_KEY), four models:
 *
 *   fal-ai/sync-lipsync/v2                 a clip + a voice line → the clip, lip-synced
 *   fal-ai/bytedance/omnihuman             a photo + a voice line → that person talking (≤30s)
 *   fal-ai/stable-audio-25/text-to-audio   a music prompt → a score
 *   fal-ai/ffmpeg-api/compose              tracks of clips and audio → one MP4
 *
 * Jobs are queued, never waited on: fal POSTs the result to
 * /api/video/{id}/render/fal when it is ready, so nothing here is bound by a
 * function's time limit or n8n's 180s. That address carries our own HMAC token
 * for this video, version and job, and fal signs the request with Ed25519
 * besides — both are checked (route.ts).
 *
 * Server-only. */

import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";

export const FAL = {
  lipsync: "fal-ai/sync-lipsync/v2",
  avatar: "fal-ai/bytedance/omnihuman",
  music: "fal-ai/stable-audio-25/text-to-audio",
  compose: "fal-ai/ffmpeg-api/compose",
} as const;

export const isFalConfigured = (env: Record<string, string | undefined> = process.env) => Boolean(env.FAL_KEY);

/* What a job is, in the callback address: "avatar:3", "music", "compose". */
export type FalJob = { engine: "avatar" | "music" | "compose"; scene: number | null };
export const jobKey = (job: FalJob) => (job.scene === null ? job.engine : `${job.engine}:${job.scene}`);
export function parseJobKey(value: string | null): FalJob | null {
  const match = value?.match(/^(avatar|music|compose)(?::(\d+))?$/);
  if (!match) return null;
  return { engine: match[1] as FalJob["engine"], scene: match[2] ? Number(match[2]) : null };
}

function secret(env: Record<string, string | undefined>) {
  return env.N8N_WEBHOOK_TOKEN || env.SUPABASE_SERVICE_ROLE_KEY || "";
}

export function falToken(videoId: string, version: number, job: string, env: Record<string, string | undefined> = process.env): string {
  return createHmac("sha256", secret(env)).update(["fal", videoId, String(version), job].join("\n")).digest("hex");
}

export function verifyFalToken(videoId: string, version: number, job: string, token: unknown, env: Record<string, string | undefined> = process.env): boolean {
  if (!secret(env) || typeof token !== "string") return false;
  const expected = Buffer.from(falToken(videoId, version, job, env));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function falWebhookUrl(origin: string, videoId: string, version: number, job: FalJob): string {
  const key = jobKey(job);
  const query = new URLSearchParams({ v: String(version), job: key, t: falToken(videoId, version, key) });
  return `${origin}/api/video/${videoId}/render/fal?${query}`;
}

/** Queues a job; fal calls the webhook when it is done. Returns the request id, or the reason it was refused. */
export async function submitFal(model: string, input: Record<string, unknown>, webhookUrl: string): Promise<{ requestId: string } | { error: string }> {
  const key = process.env.FAL_KEY;
  if (!key) return { error: "FAL_KEY is not set." };
  try {
    const response = await fetch(`https://queue.fal.run/${model}?fal_webhook=${encodeURIComponent(webhookUrl)}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as { request_id?: string; detail?: unknown } | null;
    if (!response.ok || !body?.request_id) {
      return { error: `fal refused the job (${response.status})${body?.detail ? `: ${JSON.stringify(body.detail).slice(0, 300)}` : ""}` };
    }
    return { requestId: body.request_id };
  } catch {
    return { error: "Could not reach fal." };
  }
}

/* ── fal's own signature on the webhook ─────────────────────────────────
   Ed25519 over: request id, user id, timestamp and the body's SHA-256 (hex),
   one per line, with keys from fal's JWKS. Checked when the headers are
   present; our HMAC token in the address is the gate either way. */
let jwks: { at: number; keys: { x: string }[] } | null = null;

async function falKeys(): Promise<{ x: string }[]> {
  if (jwks && Date.now() - jwks.at < 24 * 60 * 60 * 1000) return jwks.keys;
  const response = await fetch("https://rest.fal.ai/.well-known/jwks.json", { signal: AbortSignal.timeout(8000) });
  const body = (await response.json()) as { keys?: { x: string }[] };
  jwks = { at: Date.now(), keys: body.keys ?? [] };
  return jwks.keys;
}

export async function verifyFalSignature(headers: Headers, rawBody: string): Promise<"valid" | "invalid" | "absent"> {
  const requestId = headers.get("x-fal-webhook-request-id");
  const userId = headers.get("x-fal-webhook-user-id");
  const timestamp = headers.get("x-fal-webhook-timestamp");
  const signature = headers.get("x-fal-webhook-signature");
  if (!requestId || !userId || !timestamp || !signature) return "absent";
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return "invalid";
  const message = Buffer.from([requestId, userId, timestamp, createHash("sha256").update(rawBody).digest("hex")].join("\n"));
  try {
    for (const key of await falKeys()) {
      const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: key.x }, format: "jwk" });
      if (verify(null, message, publicKey, Buffer.from(signature, "hex"))) return "valid";
    }
    return "invalid";
  } catch {
    /* Keys unreachable: fall back on the token in the address, which is
       already checked, rather than fail every delivery. */
    return "absent";
  }
}

/** The media URL out of whichever model answered. */
export function outputUrl(payload: unknown): string | null {
  const p = (payload ?? {}) as { video?: { url?: string }; audio?: { url?: string }; video_url?: string };
  const url = p.video?.url ?? p.audio?.url ?? p.video_url ?? null;
  return typeof url === "string" && /^https:\/\//.test(url) ? url : null;
}
