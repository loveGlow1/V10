/* Runware — one key, many models (MiniMax included), one endpoint.
 *
 *   POST https://api.runware.ai/v1        Authorization: Bearer RUNWARE_API_KEY
 *   body: an ARRAY of tasks, each { taskType, taskUUID, model, … }
 *   answer: { data: [ … ], errors: [ { code, message, taskUUID } ] }
 *
 * Used for three things, each behind its own function here:
 *
 *   videoInference   a scene's clip. Asynchronous: deliveryMethod "async" and a
 *                    webhookURL; the result is then read back with a
 *                    getResponse task (status processing | success, videoURL).
 *                    Default model MiniMax H3 (minimax:h3@0): every aspect from
 *                    text, 4–15s, a first frame through inputs.frameImages.
 *   imageInference   a still (scene frames, flier backgrounds). Synchronous.
 *   audioInference   a voice line: MiniMax Speech 2.8 (minimax:speech@2.8),
 *                    the same MiniMax voice library the direct API uses.
 *
 * Model ids are AIR identifiers and can be changed without a code change:
 * RUNWARE_VIDEO_MODEL, RUNWARE_IMAGE_MODEL, RUNWARE_SPEECH_MODEL. A video
 * model other than the default has to take width/height and 4–15s like H3.
 *
 * Server-only: the key never leaves this file. Never throws. */

import { randomUUID } from "node:crypto";

export const RUNWARE_URL = "https://api.runware.ai/v1";
export const RUNWARE_VIDEO_MODEL = "minimax:h3@0";
export const RUNWARE_IMAGE_MODEL = "runware:101@1";
export const RUNWARE_SPEECH_MODEL = "minimax:speech@2.8";

type Env = Record<string, string | undefined>;
export const runwareConfigured = (env: Env = process.env) => Boolean(env.RUNWARE_API_KEY);

export type RunwareAspect = "9:16" | "1:1" | "16:9" | "4:5";

/* MiniMax H3's 768p sizes. It has 3:4, not 4:5 — the nearest portrait. */
export const H3_SIZE: Record<RunwareAspect, [number, number]> = {
  "9:16": [768, 1344],
  "16:9": [1344, 768],
  "1:1": [768, 768],
  "4:5": [768, 1024],
};

/* Image sizes: multiples of 64, about a megapixel, the shape asked for. */
export const IMAGE_SIZE: Record<RunwareAspect | "2:3" | "3:2", [number, number]> = {
  "9:16": [768, 1344],
  "16:9": [1344, 768],
  "1:1": [1024, 1024],
  "4:5": [896, 1152],
  "2:3": [832, 1216],
  "3:2": [1216, 832],
};

type Item = Record<string, unknown>;
type Answer = { status: number; data: Item[]; errors: Item[] };

const https = (value: unknown): string | null => (typeof value === "string" && /^https:\/\//.test(value) ? value : null);

/** Plain words for Runware's refusals; the code itself when it is new. */
export function runwareError(errors: Item[], status: number): string {
  const first = errors[0];
  const code = String(first?.code ?? "");
  const message = String(first?.message ?? "").slice(0, 200);
  if (status === 401 || /apiKey|unauthori[sz]ed|authentication/i.test(code + message)) return "the Runware key was refused";
  if (/insufficient|credit|balance/i.test(code + message)) return "the Runware account is out of credit";
  if (/nsfw|moderat|safety|sensitive/i.test(code + message)) return "Runware refused the prompt as sensitive";
  if (status === 429 || /rate/i.test(code)) return "Runware is rate-limiting right now";
  return message ? `Runware: ${message}` : `Runware refused it (${status})`;
}

async function call(tasks: Item[], timeoutMs: number, env: Env = process.env): Promise<Answer> {
  const response = await fetch(RUNWARE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RUNWARE_API_KEY}` },
    body: JSON.stringify(tasks),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as { data?: unknown; errors?: unknown } | null;
  return {
    status: response.status,
    data: Array.isArray(json?.data) ? (json.data as Item[]) : [],
    errors: Array.isArray(json?.errors) ? (json.errors as Item[]) : [],
  };
}

/* ── Video ─────────────────────────────────────────────────────────────── */

/** The videoInference task for one clip. Pure (tools/check-runware.mjs). */
export function videoTask(input: {
  taskUUID: string;
  prompt: string;
  seconds: number;
  aspect: RunwareAspect;
  imageUrl?: string | null;
  webhookUrl: string;
  model?: string;
}): Item {
  const [width, height] = H3_SIZE[input.aspect];
  return {
    taskType: "videoInference",
    taskUUID: input.taskUUID,
    model: input.model || RUNWARE_VIDEO_MODEL,
    positivePrompt: input.prompt.slice(0, 1900),
    duration: Math.min(15, Math.max(4, Math.round(input.seconds))),
    /* A first frame decides the shape; H3 refuses width/height beside it. */
    ...(input.imageUrl ? { inputs: { frameImages: [{ image: input.imageUrl, frame: "first" }] } } : { width, height }),
    outputType: "URL",
    outputFormat: "MP4",
    deliveryMethod: "async",
    webhookURL: input.webhookUrl,
  };
}

/** Queues one clip. The id is the task's UUID — what getResponse reads back. */
export async function submitRunwareVideo(input: {
  prompt: string;
  seconds: number;
  aspect: RunwareAspect;
  imageUrl?: string | null;
  webhookUrl: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!runwareConfigured()) return { ok: false, error: "Runware is not connected." };
  const taskUUID = randomUUID();
  try {
    const sent = await call([videoTask({ ...input, taskUUID, model: process.env.RUNWARE_VIDEO_MODEL })], 30000);
    if (sent.errors.length || sent.status >= 400) return { ok: false, error: `${runwareError(sent.errors, sent.status)}.` };
    return { ok: true, id: taskUUID };
  } catch {
    return { ok: false, error: "Could not reach Runware." };
  }
}

/** Where a clip is, asked of Runware itself. */
export async function runwareVideoStatus(id: string): Promise<{ state: "running" } | { state: "done"; url: string } | { state: "failed"; error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { state: "failed", error: "Not a Runware task." };
  try {
    const read = await call([{ taskType: "getResponse", taskUUID: id }], 15000);
    const failed = read.errors.find((item) => !item.taskUUID || item.taskUUID === id);
    if (failed) return { state: "failed", error: `${runwareError([failed], read.status)}.` };
    const item = read.data.find((entry) => entry.taskUUID === id) ?? read.data[0];
    if (!item || item.status === "processing") return { state: "running" };
    if (item.status === "error") return { state: "failed", error: "Runware could not make this clip." };
    const url = https(item.videoURL);
    return url ? { state: "done", url } : item.status === "success" ? { state: "failed", error: "Runware finished without a video." } : { state: "running" };
  } catch {
    return { state: "running" };
  }
}

/* ── Images ────────────────────────────────────────────────────────────── */

/** One or more stills from a prompt. Empty when Runware made none; throws only the reason. */
export async function runwareImages(input: { prompt: string; shape: keyof typeof IMAGE_SIZE; n?: number }): Promise<Buffer[]> {
  if (!runwareConfigured()) throw new Error("Runware is not connected.");
  const [width, height] = IMAGE_SIZE[input.shape];
  const sent = await call(
    [
      {
        taskType: "imageInference",
        taskUUID: randomUUID(),
        model: process.env.RUNWARE_IMAGE_MODEL || RUNWARE_IMAGE_MODEL,
        positivePrompt: input.prompt.slice(0, 2900),
        width,
        height,
        numberResults: Math.min(Math.max(input.n ?? 1, 1), 4),
        outputType: "base64Data",
        outputFormat: "PNG",
      },
    ],
    180000,
  );
  if (sent.errors.length || sent.status >= 400) throw new Error(runwareError(sent.errors, sent.status));
  const images: Buffer[] = [];
  for (const item of sent.data) {
    if (typeof item.imageBase64Data === "string" && item.imageBase64Data.length > 0) images.push(Buffer.from(item.imageBase64Data, "base64"));
  }
  return images;
}

/* ── Voice ─────────────────────────────────────────────────────────────── */

/** One voice line through MiniMax Speech on Runware. MP3 bytes, or why not. */
export async function runwareSpeak(input: { text: string; voiceId: string }): Promise<{ ok: true; audio: Buffer } | { ok: false; error: string }> {
  if (!runwareConfigured()) return { ok: false, error: "Runware is not connected." };
  try {
    const sent = await call(
      [
        {
          taskType: "audioInference",
          taskUUID: randomUUID(),
          model: process.env.RUNWARE_SPEECH_MODEL || RUNWARE_SPEECH_MODEL,
          speech: { text: input.text.slice(0, 3000), voice: input.voiceId },
          outputType: "base64Data",
          outputFormat: "MP3",
        },
      ],
      110000,
    );
    if (sent.errors.length || sent.status >= 400) return { ok: false, error: `${runwareError(sent.errors, sent.status)}.` };
    const item = sent.data[0] ?? {};
    const b64 = [item.audioBase64Data, item.audioBase64].find((value): value is string => typeof value === "string" && value.length > 0);
    if (b64) return { ok: true, audio: Buffer.from(b64, "base64") };
    const url = https(item.audioURL);
    if (url) {
      const file = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (file.ok) return { ok: true, audio: Buffer.from(await file.arrayBuffer()) };
    }
    return { ok: false, error: "Runware returned no audio." };
  } catch {
    return { ok: false, error: "Could not reach Runware for the voice." };
  }
}
