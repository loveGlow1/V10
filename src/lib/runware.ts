/* Runware — one key, many models (MiniMax included), one endpoint.
 *
 *   POST https://api.runware.ai/v1        Authorization: Bearer RUNWARE_API_KEY
 *   body: an ARRAY of tasks, each { taskType, taskUUID, model, … }
 *   answer: { data: [ … ], errors: [ { code, message, taskUUID } ] }
 *
 * Used for these, each behind its own function here:
 *
 *   videoInference   a scene's clip. Asynchronous: deliveryMethod "async" and a
 *                    webhookURL; the result is then read back with a
 *                    getResponse task (status processing | success, videoURL).
 *                    Default model MiniMax H3 (minimax:h3@0): every aspect from
 *                    text, 4–15s, a first frame through inputs.frameImages.
 *   imageInference   a still (scene frames, flier backgrounds). Synchronous.
 *   audioInference   a voice line: MiniMax Speech 2.8 (minimax:speech@2.8),
 *                    the same MiniMax voice library the direct API uses.
 *   production       lip sync (sync:lipsync-2-pro@1: inputs.video +
 *                    inputs.audio), a talking portrait (klingai:avatar@2.0)
 *                    and the music bed (runware:ace-step@v1.5-turbo), each
 *                    queued async and read back with getResponse.
 *
 * Every task is sent with includeCost, so what Runware charged comes back.
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
    includeCost: true,
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
  const status = await runwareTaskStatus(id);
  return status.state === "done" ? { state: "done", url: status.url } : status;
}

/**
 * Where any queued task is — a clip, a lip sync, an avatar, a score — asked
 * of Runware itself with getResponse. `cost` is what Runware charged in USD
 * (every task is sent with includeCost), when it said.
 */
export async function runwareTaskStatus(
  id: string,
): Promise<{ state: "running" } | { state: "done"; url: string; cost: number | null } | { state: "failed"; error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { state: "failed", error: "Not a Runware task." };
  try {
    const read = await call([{ taskType: "getResponse", taskUUID: id }], 15000);
    const failed = read.errors.find((item) => !item.taskUUID || item.taskUUID === id);
    if (failed) return { state: "failed", error: `${runwareError([failed], read.status)}.` };
    const item = read.data.find((entry) => entry.taskUUID === id) ?? read.data[0];
    if (!item || item.status === "processing") return { state: "running" };
    if (item.status === "error") return { state: "failed", error: `Runware could not make it${typeof item.message === "string" ? `: ${item.message.slice(0, 200)}` : ""}.` };
    const url = https(item.videoURL) ?? https(item.audioURL);
    const cost = typeof item.cost === "number" && Number.isFinite(item.cost) ? item.cost : null;
    return url ? { state: "done", url, cost } : item.status === "success" ? { state: "failed", error: "Runware finished without a file." } : { state: "running" };
  } catch {
    return { state: "running" };
  }
}

/* ── The production line: lip sync, avatars, music ───────────────────── */

/* Every schema below is additionalProperties:false at Runware (checked
   against model_schema), so these builders send nothing else. */
export const RUNWARE_LIPSYNC_MODEL = { final: "sync:lipsync-2-pro@1", draft: "sync:lipsync-2@1" } as const;
export const RUNWARE_AVATAR_MODEL = { final: "klingai:avatar@2.0-pro", draft: "klingai:avatar@2.0-standard" } as const;
export const RUNWARE_MUSIC_MODEL = "runware:ace-step@v1.5-turbo";

export type SyncMode = "cut_off" | "loop" | "silence";

/**
 * How sync handles a line and a clip of different lengths. Never "bounce",
 * its default, which plays the voice backwards to fill the time. A line no
 * longer than its clip is cut at the clip's end (nothing to cut); a line that
 * runs longer than its clip loops the PICTURE under the whole line rather
 * than cutting the words off. Unknown lengths: cut_off, which can never
 * repeat or reverse the voice. Pure.
 */
export function syncModeFor(voiceSeconds: number | null, clipSeconds: number | null): SyncMode {
  if (!voiceSeconds || !clipSeconds) return "cut_off";
  return voiceSeconds > clipSeconds + 0.25 ? "loop" : "cut_off";
}

/** A clip and its own voice line → the clip, lip-synced. Pure. */
export function lipsyncTask(input: { taskUUID: string; videoUrl: string; audioUrl: string; syncMode: SyncMode; tier?: "final" | "draft"; webhookUrl: string }): Item {
  return {
    taskType: "videoInference",
    taskUUID: input.taskUUID,
    model: RUNWARE_LIPSYNC_MODEL[input.tier ?? "final"],
    inputs: { video: input.videoUrl, audio: input.audioUrl },
    providerSettings: { sync: { syncMode: input.syncMode, activeSpeakerDetection: true, occlusionDetectionEnabled: true } },
    outputType: "URL",
    outputFormat: "MP4",
    deliveryMethod: "async",
    webhookURL: input.webhookUrl,
    includeCost: true,
  };
}

/** One portrait and a voice line → that person talking. Pure. */
export function avatarTask(input: { taskUUID: string; imageUrl: string; audioUrl: string; tier?: "final" | "draft"; webhookUrl: string }): Item {
  return {
    taskType: "videoInference",
    taskUUID: input.taskUUID,
    model: RUNWARE_AVATAR_MODEL[input.tier ?? "final"],
    positivePrompt: "Natural talking performance, precise lip sync, subtle head movement, steady camera.",
    inputs: { image: input.imageUrl, audio: input.audioUrl },
    outputType: "URL",
    outputFormat: "MP4",
    deliveryMethod: "async",
    webhookURL: input.webhookUrl,
    includeCost: true,
  };
}

/**
 * Music. Without lyrics an instrumental bed; with lyrics (10 to 3000
 * characters) a song sung in `vocalLanguage`. ACE-Step makes 30s at the
 * least; the cut trims it. Queued with a webhook, or answered in the same
 * request without one. Pure.
 */
export function musicTask(input: { taskUUID: string; prompt: string; seconds: number; webhookUrl?: string; lyrics?: string; vocalLanguage?: string }): Item {
  const lyrics = input.lyrics?.trim().slice(0, 3000);
  const sung = Boolean(lyrics && lyrics.length >= 10);
  return {
    taskType: "audioInference",
    taskUUID: input.taskUUID,
    model: RUNWARE_MUSIC_MODEL,
    positivePrompt: (sung ? input.prompt : `${input.prompt}. Instrumental background score, no vocals, clean mix.`).slice(0, 3000),
    duration: Math.min(300, Math.max(30, Math.ceil(input.seconds))),
    settings: sung ? { lyrics, vocalLanguage: /^[a-z]{2,3}$/.test(input.vocalLanguage ?? "") ? input.vocalLanguage : "en" } : { vocalLanguage: "unknown" },
    outputType: "URL",
    outputFormat: "MP3",
    ...(input.webhookUrl ? { deliveryMethod: "async", webhookURL: input.webhookUrl } : {}),
    includeCost: true,
  };
}

/** Music made now, in this request (ACE-Step answers in seconds). The MP3 and what Runware charged. */
export async function runwareMusic(input: { prompt: string; seconds: number; lyrics?: string; vocalLanguage?: string }): Promise<{ ok: true; audio: Buffer; cost: number | null } | { ok: false; error: string }> {
  if (!runwareConfigured()) return { ok: false, error: "Music needs the Runware key (RUNWARE_API_KEY) on this deployment." };
  try {
    const sent = await call([musicTask({ ...input, taskUUID: randomUUID() })], 110000);
    if (sent.errors.length || sent.status >= 400) return { ok: false, error: `${runwareError(sent.errors, sent.status)}.` };
    const item = sent.data[0] ?? {};
    const url = https(item.audioURL);
    if (!url) return { ok: false, error: "Runware returned no music." };
    const file = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!file.ok) return { ok: false, error: "The music could not be fetched from Runware." };
    return { ok: true, audio: Buffer.from(await file.arrayBuffer()), cost: typeof item.cost === "number" ? item.cost : null };
  } catch {
    return { ok: false, error: "Could not reach Runware for the music." };
  }
}

/** Queues one task built above. The id is its UUID — what getResponse reads back. */
export async function submitRunwareTask(task: Item): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!runwareConfigured()) return { ok: false, error: "Runware is not connected." };
  const id = String(task.taskUUID ?? "");
  try {
    const sent = await call([task], 30000);
    if (sent.errors.length || sent.status >= 400) return { ok: false, error: `${runwareError(sent.errors, sent.status)}.` };
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not reach Runware." };
  }
}

/* ── Characters: the same face in every scene ──────────────────────────── */

/* Reference-to-video: the character's pictures are passed with EVERY scene
   (never a chain of frames, which drifts). MiniMax H3 first — ByteDance's
   moderation refuses realistic human faces as references, so Seedance 2.0 is
   the second try. Both take width/height beside referenceImages, which keeps
   the scene's shape (a resolution preset would take the pictures' shape). */
export const REFERENCE_VIDEO_MODEL = { h3: "minimax:h3@0", seedance: "bytedance:seedance@2.0" } as const;
const SEEDANCE_720: Record<RunwareAspect, [number, number]> = { "9:16": [720, 1280], "16:9": [1280, 720], "1:1": [960, 960], "4:5": [834, 1112] };

/** One scene filmed from a character's reference pictures. Pure. */
export function referenceVideoTask(input: {
  taskUUID: string;
  engine: keyof typeof REFERENCE_VIDEO_MODEL;
  prompt: string;
  seconds: number;
  aspect: RunwareAspect;
  references: string[];
  webhookUrl: string;
}): Item {
  const [width, height] = input.engine === "h3" ? H3_SIZE[input.aspect] : SEEDANCE_720[input.aspect];
  return {
    taskType: "videoInference",
    taskUUID: input.taskUUID,
    model: REFERENCE_VIDEO_MODEL[input.engine],
    positivePrompt: input.prompt.slice(0, input.engine === "h3" ? 6900 : 9900),
    width,
    height,
    duration: Math.min(15, Math.max(4, Math.round(input.seconds))),
    inputs: { referenceImages: input.references.slice(0, 9) },
    /* The voice, lip sync and music come from the production line. */
    ...(input.engine === "seedance" ? { settings: { audio: false } } : {}),
    outputType: "URL",
    outputFormat: "MP4",
    deliveryMethod: "async",
    webhookURL: input.webhookUrl,
    includeCost: true,
  };
}

export async function submitReferenceVideo(input: Omit<Parameters<typeof referenceVideoTask>[0], "taskUUID">): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!input.references.length) return { ok: false, error: "This scene's character has no reference pictures." };
  return submitRunwareTask(referenceVideoTask({ ...input, taskUUID: randomUUID() }));
}

/* The reference sheet: Seedream 4.5. A front portrait from words alone (it
   needs at least 3.7 MP), then each other view made FROM that portrait, so
   the face is the same in all of them. */
export const SHEET_MODEL = "bytedance:seedream@4.5";
export const SHEET_VIEWS = [
  { id: "front", prompt: "Character reference, front view, head and shoulders, looking straight at the camera, neutral relaxed expression" },
  { id: "three-quarter", prompt: "The same person as in the reference image, three-quarter view turned slightly to the side, from the waist up" },
  { id: "full-body", prompt: "The same person as in the reference image, full body standing, facing the camera, whole outfit and shoes visible" },
] as const;

/** One view of a character's reference sheet. Pure. */
export function sheetTask(input: { taskUUID: string; view: (typeof SHEET_VIEWS)[number]; descriptor: string; references?: string[] }): Item {
  const keep = input.references?.length ? " Same face, same hair, same skin tone, same outfit and accessories as in the reference image." : "";
  return {
    taskType: "imageInference",
    taskUUID: input.taskUUID,
    model: SHEET_MODEL,
    positivePrompt: `${input.view.prompt}.${keep} Plain light grey studio background, soft even light, photorealistic, no text. Character: ${input.descriptor}`.slice(0, 2950),
    ...(input.references?.length ? { inputs: { referenceImages: input.references.slice(0, 4) }, resolution: "2K" } : { width: 1536, height: 2560 }),
    outputType: "base64Data",
    outputFormat: "JPG",
    includeCost: true,
  };
}

/** One sheet view, made now. The JPEG and what Runware charged. */
export async function runwareSheetImage(input: Omit<Parameters<typeof sheetTask>[0], "taskUUID">): Promise<{ ok: true; image: Buffer; cost: number | null } | { ok: false; error: string }> {
  if (!runwareConfigured()) return { ok: false, error: "Characters need the Runware key (RUNWARE_API_KEY) on this deployment." };
  try {
    const sent = await call([sheetTask({ ...input, taskUUID: randomUUID() })], 110000);
    if (sent.errors.length || sent.status >= 400) return { ok: false, error: `${runwareError(sent.errors, sent.status)}.` };
    const item = sent.data[0] ?? {};
    const b64 = typeof item.imageBase64Data === "string" ? item.imageBase64Data : null;
    if (!b64) return { ok: false, error: "Runware returned no picture." };
    return { ok: true, image: Buffer.from(b64, "base64"), cost: typeof item.cost === "number" ? item.cost : null };
  } catch {
    return { ok: false, error: "Could not reach Runware for the character." };
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
        includeCost: true,
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
          includeCost: true,
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
