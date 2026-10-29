/* Whether an image's lettering is what was asked for.
 *
 * Image models — MiniMax most of all, whose training is mostly Chinese — set
 * words the brief never had: Chinese or other scripts, filler, half-letters,
 * a misspelled headline. Somebody paid for that image. So before an image is
 * delivered or charged, Claude Haiku reads it against the exact text it was
 * meant to carry, and an image that fails is dropped (run.ts): never shown,
 * never billed, and when a model's whole set fails, the next model is tried.
 *
 * Lenient where a reader would be: letter case, line breaks and punctuation
 * do not count, and neither does text that is unreadably small or part of a
 * real object in the picture. Strict on what costs trust: any other script,
 * any word that is not in the brief, any word spelled wrong.
 *
 * When the check itself cannot run — no key, the call failing — the image
 * passes: a check that is down must not stop every flier being made.
 *
 * Server-only. */

import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

import type { FlyerSpec } from "./types";

export type TextVerdict = { ok: boolean; reason: string };

/** The words an image is allowed to show. Pure. */
export function allowedText(spec: FlyerSpec, brandName: string): string[] {
  return [spec.headline, spec.subhead, ...(spec.details ?? []), spec.cta, brandName].filter(
    (line): line is string => typeof line === "string" && line.trim().length > 0,
  );
}

const SYSTEM = `You check the lettering on a generated flier image before a customer pays for it. You are given the only text the image is allowed to show. Reply with JSON only: {"ok": true|false, "reason": "short"}.

ok is false when ANY of these is visible and readable:
- characters in a script that the allowed text does not use (for example Chinese, Japanese, Korean, Arabic, Cyrillic when the allowed text is English)
- a word, number or sentence that is not in the allowed text (filler, placeholder, invented slogans, fake website or phone number)
- an allowed word spelled wrong, or letters that are garbled, melted or nonsense

Ignore: letter case, line breaks, punctuation, tiny unreadable texture, and text that is part of a real object in the photo only if it is not readable. A logo-like mark with letters counts as extra text.
ok is true when every readable piece of text is from the allowed text and spelled correctly, or when the image has no text and none was required.`;

export async function checkImageText(image: Buffer, allowed: string[], textRequired: boolean): Promise<TextVerdict> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: true, reason: "unchecked: no key" };
  try {
    /* Readable, and cheap: the long edge at 1024 is plenty to read type. */
    const small = await sharp(image).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    const message = await new Anthropic().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.toString("base64") } },
            {
              type: "text",
              text: textRequired
                ? `Allowed text (nothing else may appear):\n${allowed.map((line) => `- ${line}`).join("\n")}`
                : "No text is allowed on this image at all.",
            },
          ],
        },
      ],
    });
    const raw = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { ok?: unknown; reason?: unknown };
    return { ok: parsed.ok !== false, reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "" };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("flyers: the text check could not run:", error instanceof Error ? error.message : error);
    return { ok: true, reason: "unchecked: check failed" };
  }
}
