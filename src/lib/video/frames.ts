/* The frame a scene starts from — and the creator keyframe that keeps a UGC
 * video's person the same person in every shot.
 *
 * Text-to-video invents a new face for every scene. That is the tell of an
 * AI ad: the creator in the hook is not the one holding the product. The
 * industry fix is a keyframe — one still of the creator, made once — that
 * every on-camera scene animates from. So:
 *
 *   photo_to_video   every scene starts from the photo the person uploaded
 *   on-camera scenes (avatar) of a UGC, ad or social video with no clone
 *                    photo: one generated creator keyframe, made from the
 *                    plan's character lock, at the video's exact aspect
 *   everything else  no frame — text-to-video
 *
 * The keyframe is made with Ideogram 3 (photoreal, exact aspect ratios),
 * then Gemini, then OpenAI, whichever is connected, and kept in video-assets
 * as a render asset of the version so a retry starts from the same face.
 *
 * Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Aspect } from "./clip-engines";
import type { ProductionPlan, Scene } from "./plan";

const KEYFRAME_PIPELINES = ["ugc_influencer", "commercial_ad", "social_video"];

export const keyframePath = (userId: string, videoId: string, version: number) => `${userId}/${videoId}/v${version}/keyframe.png`;

/** Whether this plan's on-camera scenes should start from one creator keyframe. */
export function wantsKeyframe(plan: ProductionPlan, hasPhoto: boolean): boolean {
  return !hasPhoto && KEYFRAME_PIPELINES.includes(plan.pipeline) && plan.scenes.some((scene) => scene.engine === "avatar");
}

/** The still the keyframe model is asked for. Pure. */
export function keyframePrompt(plan: ProductionPlan): string {
  const first = plan.scenes.find((scene) => scene.engine === "avatar");
  const locks = Object.entries(plan.locks ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  return [
    "A single photorealistic frame from a smartphone video: one content creator facing the camera, mid-sentence, natural expression.",
    first ? `Scene: ${first.visual}. Shot: ${first.shot}.` : "",
    locks ? `Must match exactly: ${locks}.` : "",
    "Natural window light, true-to-life skin texture, realistic hands, candid UGC look, shallow depth of field.",
    "No text, no captions, no logos, no watermark. A fictional person, not resembling any real celebrity or influencer.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1800);
}

const IDEOGRAM_AR: Record<Aspect, string> = { "9:16": "9x16", "1:1": "1x1", "16:9": "16x9", "4:5": "4x5" };

async function ideogram(prompt: string, aspect: Aspect): Promise<Buffer | null> {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("aspect_ratio", IDEOGRAM_AR[aspect]);
  form.append("rendering_speed", "QUALITY");
  form.append("magic_prompt", "OFF");
  form.append("style_type", "REALISTIC");
  form.append("num_images", "1");
  form.append("negative_prompt", "text, watermark, logo, distorted hands, extra fingers, plastic skin, celebrity likeness");
  const response = await fetch("https://api.ideogram.ai/v1/ideogram-v3/generate", {
    method: "POST",
    headers: { "Api-Key": process.env.IDEOGRAM_API_KEY ?? "" },
    body: form,
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) return null;
  const json = (await response.json().catch(() => null)) as { data?: { url?: string }[] } | null;
  const url = json?.data?.[0]?.url;
  if (!url) return null;
  const image = await fetch(url, { signal: AbortSignal.timeout(30000) });
  return image.ok ? Buffer.from(await image.arrayBuffer()) : null;
}

async function gemini(prompt: string, aspect: Aspect): Promise<Buffer | null> {
  const { generateGemini } = await import("@/lib/flyers/providers/gemini");
  const format = aspect === "9:16" ? "story" : aspect === "1:1" ? "square" : aspect === "16:9" ? "landscape" : "portrait";
  const [image] = await generateGemini({ tier: "pro", prompt, format, n: 1, size: "2K" });
  return image ?? null;
}

async function openai(prompt: string, aspect: Aspect): Promise<Buffer | null> {
  const { generateOpenAI } = await import("@/lib/flyers/providers/openai");
  const format = aspect === "9:16" ? "story" : aspect === "1:1" ? "square" : aspect === "16:9" ? "landscape" : "portrait";
  const [image] = await generateOpenAI({ model: (process.env.OPENAI_IMAGE_MODEL as "gpt-image-2" | "gpt-image-1.5") || "gpt-image-1.5", prompt, format, n: 1 });
  return image ?? null;
}

/** Makes (or finds) the version's creator keyframe. A signed URL, or null when none can be made. */
export async function ensureKeyframe(
  service: SupabaseClient,
  input: { userId: string; videoId: string; version: number; plan: ProductionPlan },
): Promise<string | null> {
  const path = keyframePath(input.userId, input.videoId, input.version);
  const existing = await service.storage.from("video-assets").createSignedUrl(path, 6 * 60 * 60);
  if (existing.data?.signedUrl) return existing.data.signedUrl;

  const prompt = keyframePrompt(input.plan);
  const aspect = input.plan.aspect as Aspect;
  const makers: (() => Promise<Buffer | null>)[] = [];
  if (process.env.IDEOGRAM_API_KEY) makers.push(() => ideogram(prompt, aspect));
  if (process.env.GEMINI_API_KEY) makers.push(() => gemini(prompt, aspect));
  if (process.env.OPENAI_API_KEY) makers.push(() => openai(prompt, aspect));

  for (const make of makers) {
    try {
      const image = await make();
      if (!image?.length) continue;
      const { error } = await service.storage.from("video-assets").upload(path, image, { contentType: "image/png", upsert: true });
      if (error) continue;
      await service.from("video_assets").insert({ video_id: input.videoId, user_id: input.userId, kind: "render", storage_path: path, mime: "image/png" });
      const signed = await service.storage.from("video-assets").createSignedUrl(path, 6 * 60 * 60);
      return signed.data?.signedUrl ?? null;
    } catch {
      /* The next maker. */
    }
  }
  return null;
}

/** The frame one scene starts from, or null for text-to-video. */
export async function frameFor(
  service: SupabaseClient,
  input: { userId: string; videoId: string; version: number; plan: ProductionPlan; scene: Pick<Scene, "engine"> },
): Promise<string | null> {
  if (input.plan.pipeline === "photo_to_video") {
    const { data: photo } = await service.from("video_assets").select("storage_path").eq("video_id", input.videoId).eq("kind", "photo").order("created_at").limit(1).maybeSingle();
    if (!photo) return null;
    const { data } = await service.storage.from("video-assets").createSignedUrl(photo.storage_path, 6 * 60 * 60);
    return data?.signedUrl ?? null;
  }
  if (input.scene.engine !== "avatar") return null;
  const path = keyframePath(input.userId, input.videoId, input.version);
  const { data } = await service.storage.from("video-assets").createSignedUrl(path, 6 * 60 * 60);
  return data?.signedUrl ?? null;
}
