/* Rendering through n8n — the app's half of the Video Render workflow
 * (n8n/video-render.workflow.ts, "QuickStark.Ai — Video Render").
 *
 * The instance caps an execution at 180 seconds, and one MiniMax clip can take
 * most of that. So a render is not one execution looping over scenes — it is
 * one JOB per execution: each scene's clip, and each scene's voice line, sent
 * separately and in parallel. Each job reports back on its own to
 * /api/video/{id}/render/callback. One slow or failed scene costs one scene.
 *
 * Trust: the app calls n8n with X-QuickStark-Token (the webhook's Header Auth),
 * and n8n calls back with the same header plus a signature over this video,
 * version and owner, so a callback can only ever write to the render it was
 * sent for.
 *
 * Server-only. */

import { createHmac, timingSafeEqual } from "node:crypto";

import { WEBHOOK_TOKEN_HEADER } from "@/lib/n8n";

import { CLIP_COST, VOICE_COST } from "./engines";
import type { ProductionPlan } from "./plan";

export { CLIP_COST, VOICE_COST };

/* A clip that has not reported in this long is not coming: the instance stops
   an execution at 180s, and this leaves room for n8n's own queue. */
export const MAX_CLIP_SECONDS = 6;

export const STALE_AFTER_MS = 8 * 60 * 1000;
/* fal's jobs (lip sync, avatar, music, the final compose) queue and can take
   longer; they are given more room before being called lost. */
export const FAL_STALE_AFTER_MS = 25 * 60 * 1000;

const MAX_AGE_MS = 3 * 60 * 60 * 1000;

export type RenderJob =
  | { kind: "clip"; n: number; duration: number; prompt: string; imageUrl?: string }
  | { kind: "voice"; n: number; text: string; voiceId: string; language: string };

export function videoWebhookUrl(env: Record<string, string | undefined> = process.env): string | null {
  if (env.N8N_VIDEO_WEBHOOK_URL) return env.N8N_VIDEO_WEBHOOK_URL;
  if (!env.N8N_WEBHOOK_URL) return null;
  try {
    return `${new URL(env.N8N_WEBHOOK_URL).origin}/webhook/api/v1/video-render`;
  } catch {
    return null;
  }
}

export function isRenderConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(videoWebhookUrl(env) && env.N8N_WEBHOOK_TOKEN);
}

/* MiniMax system voices. Two, chosen to read clearly in English; the language
   boost carries the other languages. */
export function voiceIdFor(answers: Record<string, string>): string {
  const asked = `${answers.voice ?? ""} ${answers.creator ?? ""}`;
  return /\bmale\b/i.test(asked) && !/female/i.test(asked) ? "English_Trustworth_Man" : "English_Graceful_Lady";
}

const LANGUAGES = ["English", "French", "Spanish", "Portuguese", "German", "Italian", "Arabic", "Chinese", "Japanese", "Korean"];
export function languageFor(answers: Record<string, string>): string {
  return LANGUAGES.includes(answers.language ?? "") ? answers.language : "auto";
}

/** Every job a plan needs: a clip per scene, a voice line per spoken scene. */
export function jobsFor(plan: ProductionPlan, answers: Record<string, string>, opts: { firstFrameUrl?: string | null } = {}): RenderJob[] {
  const voiceId = voiceIdFor(answers);
  const language = languageFor(answers);
  const jobs: RenderJob[] = [];
  for (const scene of plan.scenes) {
    /* A clone's presenter scene is made by the avatar engine from the person's
       own photo and voice line — a generated clip of a stranger would be
       thrown away, so none is ordered. */
    if (plan.pipeline === "clone" && scene.engine === "avatar") {
      const line = scene.voiceover.replace(/^[A-Z][A-Za-z .'-]{0,24}:\s*/, "").trim();
      if (line) jobs.push({ kind: "voice", n: scene.n, text: line, voiceId, language });
      continue;
    }
    /* At most 6s a clip: a 4s MiniMax-H3 clip took ~126s in testing, against
       the instance's 180s run limit. A longer scene holds its last frame
       while its line finishes (the studio's FinalCut). */
    jobs.push({
      kind: "clip",
      n: scene.n,
      duration: Math.min(MAX_CLIP_SECONDS, Math.max(4, scene.duration)),
      prompt: scene.motionPrompt || scene.visual,
      /* Photo → Video animates the photo itself: it is the first frame. */
      ...(opts.firstFrameUrl ? { imageUrl: opts.firstFrameUrl } : {}),
    });
    /* "NAME: line" is dialogue; the name is for the script, not the voice. */
    const text = scene.voiceover.replace(/^[A-Z][A-Za-z .'-]{0,24}:\s*/, "").trim();
    if (text) jobs.push({ kind: "voice", n: scene.n, text, voiceId, language });
  }
  return jobs;
}

export const jobCost = (jobs: RenderJob[]) => jobs.reduce((sum, job) => sum + (job.kind === "clip" ? CLIP_COST : VOICE_COST), 0);

/* The engine a job's row is filed under in video_renders. */
export const engineOf = (kind: RenderJob["kind"]) => (kind === "clip" ? "video" : "voice");

function claim(videoId: string, version: number, userId: string, issuedAt: number) {
  return [videoId, String(version), userId, String(issuedAt)].join("\n");
}

export function signRender(videoId: string, version: number, userId: string, env: Record<string, string | undefined> = process.env): string | null {
  const key = env.N8N_WEBHOOK_TOKEN;
  if (!key) return null;
  const issuedAt = Date.now();
  return `${issuedAt}.${createHmac("sha256", key).update(claim(videoId, version, userId, issuedAt)).digest("hex")}`;
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyRender(videoId: string, version: number, userId: string, signature: unknown, env: Record<string, string | undefined> = process.env): boolean {
  const key = env.N8N_WEBHOOK_TOKEN;
  if (!key || typeof signature !== "string") return false;
  const [issuedRaw, mac] = signature.split(".");
  const issuedAt = Number(issuedRaw);
  if (!mac || !Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > MAX_AGE_MS) return false;
  return same(mac, createHmac("sha256", key).update(claim(videoId, version, userId, issuedAt)).digest("hex"));
}

/** Whether a request carries the shared webhook token. */
export function hasWebhookToken(headers: Headers, env: Record<string, string | undefined> = process.env): boolean {
  const key = env.N8N_WEBHOOK_TOKEN;
  const given = headers.get(WEBHOOK_TOKEN_HEADER);
  return Boolean(key && given && same(given, key));
}

/** Sends each job to the workflow. Returns which were accepted. Never throws. */
export async function dispatchJobs(input: {
  videoId: string;
  version: number;
  userId: string;
  aspect: string;
  callbackUrl: string;
  jobs: RenderJob[];
}): Promise<{ job: RenderJob; ok: boolean; error?: string }[]> {
  const url = videoWebhookUrl();
  const token = process.env.N8N_WEBHOOK_TOKEN;
  const signature = signRender(input.videoId, input.version, input.userId);
  if (!url || !token || !signature) return input.jobs.map((job) => ({ job, ok: false, error: "Rendering is not configured." }));

  return Promise.all(
    input.jobs.map(async (job) => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", [WEBHOOK_TOKEN_HEADER]: token },
          body: JSON.stringify({ videoId: input.videoId, version: input.version, signature, aspect: input.aspect, callbackUrl: input.callbackUrl, job }),
          signal: AbortSignal.timeout(15000),
          cache: "no-store",
        });
        if (response.ok) return { job, ok: true };
        return {
          job,
          ok: false,
          error: response.status === 404 ? "The render workflow is not published." : response.status === 403 ? "The render workflow rejected the token." : `The render workflow answered ${response.status}.`,
        };
      } catch {
        return { job, ok: false, error: "Could not reach the render workflow." };
      }
    }),
  );
}
