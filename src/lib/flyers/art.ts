/* The art on a flier — made for it rather than found for it.
 *
 * A flier built by the page builder is an HTML canvas: every word on it is
 * real text, set in real type, spelled exactly as the brief spelled it,
 * editable and sharp at any size. What used to fill its background was a
 * stock photograph searched for by keyword, or a CSS gradient. Now the
 * picture behind the type is generated for this flier, from the art
 * direction the builder wrote for it — the way a designer commissions a key
 * visual and then sets the type over it:
 *
 *   graphic   (illustration, poster art, abstract, pattern, 3D, texture)
 *             → Ideogram 3 in DESIGN style, then gpt-image-2, then Gemini
 *   photo     (a scene, a person, food, a product, a place)
 *             → gpt-image-2, then Gemini, then Ideogram 3 REALISTIC
 *   stock     (FLIER_ART=stock on the deployment) → Unsplash only
 *
 * and Unsplash ("splash") is the last resort on every chain, so a flier is
 * never left with a hole. The art is always asked for WITHOUT text: an image
 * model's lettering is the part of an AI flier people notice first, and the
 * HTML already sets the words perfectly.
 *
 * Priced per picture made (ART_COST), at most MAX_ART pictures per flier;
 * a library photograph costs nothing extra.
 *
 * Server-only apart from the pure routing at the top. */

import { googleKey } from "@/lib/keys";
import { createHash } from "node:crypto";

import type { ChoiceOptions, ImageProvider, ImageSlot, Shot } from "@/lib/builder/images";

import type { FlyerFormat } from "./types";

export type ArtStyle = "graphic" | "photo";
export type ArtMaker = "ideogram" | "openai" | "gemini";

export const ART_COST = 2;
export const MAX_ART = 3;
/* A page's pictures are stored inline, inside a 2.6MB budget for the whole
   page (images.ts), so generated art is re-encoded before it goes in: a
   1600px JPEG is sharp on any screen and a few hundred kilobytes. */
const ART_MAX_EDGE = 1600;
const ART_QUALITY = 84;

/* The marker the flier blueprint puts on its canvas. */
export const FLIER_MARK = "data-qs-flier";

type Env = Record<string, string | undefined>;

const GRAPHIC = /\b(illustrat|poster art|graphic|abstract|pattern|geometric|texture|3d render|vector|flat|gradient|shapes?|collage|risograph|halftone|neon|isometric|typographic)\w*/i;

/** Which kind of picture the art direction asks for. Pure. */
export function artStyle(shot: string): ArtStyle {
  return GRAPHIC.test(shot) ? "graphic" : "photo";
}

/** The makers to try for a picture, best first, connected only. Pure. */
export function artChain(style: ArtStyle, env: Env = process.env): ArtMaker[] {
  if ((env.FLIER_ART ?? "").trim().toLowerCase() === "stock") return [];
  const order: ArtMaker[] = style === "graphic" ? ["ideogram", "openai", "gemini"] : ["openai", "gemini", "ideogram"];
  const has: Record<ArtMaker, boolean> = {
    ideogram: Boolean(env.IDEOGRAM_API_KEY),
    openai: Boolean(env.OPENAI_API_KEY),
    gemini: Boolean(googleKey(env)),
  };
  return order.filter((maker) => has[maker]);
}

/** The flier format nearest a slot's box. Pure. */
export function formatFor(ratio: string): FlyerFormat {
  const [w, h] = ratio.split(/[/:x]/).map(Number);
  if (!(w > 0 && h > 0)) return "portrait";
  const r = w / h;
  if (r < 0.62) return "story";
  if (r < 0.9) return "portrait";
  if (r <= 1.12) return "square";
  return "landscape";
}

/** The art prompt: the builder's direction, and never any lettering. Pure. */
export function artPrompt(slot: Pick<ImageSlot, "shot" | "alt">, style: ArtStyle): string {
  const direction = (slot.shot || slot.alt).replace(/\s+/g, " ").trim().slice(0, 1200);
  return [
    `Key visual for a printed flier: ${direction}.`,
    style === "graphic"
      ? "Bold, print-ready graphic design, strong composition, rich colour, crisp edges."
      : "Photorealistic, editorial-quality photograph, natural light, true-to-life detail.",
    "Leave calm negative space where headline text will be set over it.",
    "Absolutely no text, letters, numbers, words, logos, signage or watermarks anywhere in the image.",
  ].join(" ");
}

/** Whether a finished page is a flier canvas. Pure. */
export const isFlier = (html: string) => html.includes(FLIER_MARK);

/* ── Making it ────────────────────────────────────────────────────────── */

async function make(maker: ArtMaker, prompt: string, format: FlyerFormat, style: ArtStyle): Promise<Buffer | null> {
  if (maker === "ideogram") {
    const { generateIdeogram } = await import("./providers/ideogram");
    const [image] = await generateIdeogram({
      prompt: `${prompt}${style === "photo" ? " Style: realistic photograph." : ""}`,
      format,
      n: 1,
      negative: "text, letters, words, typography, watermark, logo, signature, blurry, low resolution",
    });
    return image ?? null;
  }
  if (maker === "openai") {
    const { generateOpenAI } = await import("./providers/openai");
    const model = (process.env.OPENAI_IMAGE_MODEL as "gpt-image-2" | "gpt-image-1.5" | undefined) || "gpt-image-2";
    const [image] = await generateOpenAI({ model, prompt, format, n: 1 });
    return image ?? null;
  }
  const { generateGemini } = await import("./providers/gemini");
  const [image] = await generateGemini({ tier: "pro", prompt, format, n: 1, size: "2K" });
  return image ?? null;
}

/** Re-encoded to fit a page: a JPEG, longest edge ART_MAX_EDGE. The original when sharp cannot. */
async function fit(bytes: Buffer): Promise<{ bytes: Buffer; contentType: string }> {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(bytes)
      .resize({ width: ART_MAX_EDGE, height: ART_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: ART_QUALITY, mozjpeg: true })
      .toBuffer();
    return { bytes: out, contentType: "image/jpeg" };
  } catch {
    return { bytes, contentType: "image/png" };
  }
}

/**
 * An image provider for a flier's art slots: generated first, the library
 * after. `made` counts the pictures generated, which is what is charged.
 */
export function flierArtProvider(library: ImageProvider | null, env: Env = process.env): ImageProvider & { made: () => number } {
  let made = 0;
  /* Reserved before a picture is asked for, so slots filled side by side
     cannot together go past MAX_ART. */
  let reserved = 0;
  return {
    name: "flier-art",
    made: () => made,
    async shotFor(slot: ImageSlot, width: number, context?: string, choice?: ChoiceOptions): Promise<Shot | null> {
      const style = artStyle(slot.shot || slot.alt);
      const chain = reserved < MAX_ART ? artChain(style, env) : [];
      if (chain.length) reserved += 1;
      const prompt = artPrompt(slot, style);
      for (const maker of chain) {
        try {
          const raw = await make(maker, prompt, formatFor(slot.ratio), style);
          if (!raw?.length) continue;
          const image = await fit(raw);
          made += 1;
          return {
            id: `ai:${maker}:${createHash("sha256").update(image.bytes).digest("hex").slice(0, 16)}`,
            bytes: image.bytes,
            contentType: image.contentType,
          };
        } catch {
          /* The next maker. */
        }
      }
      if (chain.length) reserved -= 1;
      return library ? library.shotFor(slot, width, context, choice) : null;
    },
  };
}
