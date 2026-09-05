/* Real photographs on a generated page.
 *
 * The rule this replaces said "no external images: use inline SVG, CSS
 * gradients and solid shapes for artwork". It was written against a real
 * failure — a model asked for a photograph invents a stock-photo URL, and every
 * one of those is a broken image — and it worked, in the sense that nothing was
 * ever broken. What it produced instead was a page where every product, every
 * portrait and every hero was a flat vector drawing. Correct, and cartoonish.
 *
 * The fix is not a different instruction. A language model cannot emit a
 * photograph: a JPEG is compressed binary, and base64 written by a model is
 * corrupt bytes and a broken image, which is worse than the drawing. So the
 * page no longer tries. It declares SLOTS — an <img> carrying the art direction
 * for the picture that belongs there — and this module fills them with real
 * pixels after generation, before the page is stored.
 *
 *   <img data-shot="folded ochre wax print fabric, studio light, neutral
 *        background" data-ratio="4/5" data-weight="thumb"
 *        alt="Ochre Adire wax print" src="(placeholder)">
 *
 * Three things fall out of that split, and they are the reason it is a split:
 *
 *   - The model does the part it is good at. Writing art direction is writing,
 *     and "folded ochre wax print, raking light, neutral seamless" is a better
 *     brief than most people would type.
 *   - Nothing is ever broken. The slot ships with a real placeholder in it, so
 *     a page whose fill step is unconfigured, rate-limited or offline is a page
 *     with deliberate neutral panels rather than a page of missing-image icons.
 *   - What should stay vector, stays vector. A chart is data, a logo is a
 *     wordmark, an icon is an icon, and a diagram explains a mechanism. None of
 *     those is improved by being a photograph, and the rules keep them drawn.
 */

/** Where a picture sits, which is what decides how many bytes it may have. */
export type SlotWeight = "hero" | "feature" | "thumb";

export type ImageSlot = {
  /** The whole <img …> tag, so it can be rewritten in place. */
  tag: string;
  /** The art direction the generator wrote. */
  shot: string;
  /** What the picture is. Also the fallback query when there is no shot. */
  alt: string;
  /** "4/5", "16/9" — how it is cropped. */
  ratio: string;
  weight: SlotWeight;
};

/** What a provider gives back for one slot. */
export type Shot = {
  bytes: Buffer;
  contentType: string;
  /** Attribution, where the source requires it. Unsplash does. */
  credit?: { author: string; source: string; url: string };
};

export type ImageProvider = {
  name: string;
  /** Real pixels for one slot at roughly this width, or null if none was found.
   *  `context` describes what was actually built — see fillImages. */
  shotFor(slot: ImageSlot, width: number, context?: string): Promise<Shot | null>;
};

/* How wide a picture is asked for, by where it sits.
 *
 * Requested from the provider at this width rather than resized here: every
 * source worth using takes a width parameter, and asking for the right size is
 * free where scaling it down afterwards would mean carrying an image library
 * into a serverless function to do work somebody else will do for nothing. */
export const WIDTH: Record<SlotWeight, number> = {
  hero: 1400,
  feature: 1000,
  thumb: 560,
};

/* What the whole page may spend on pictures.
 *
 * Base64 costs a third more than the bytes it carries, and this document is
 * stored in a row that is read on every preview. A twelve-product storefront at
 * full size is several megabytes, which is a page that takes a visible moment
 * to open — so the budget is spent in order of weight and the slots that do not
 * fit keep their placeholder. Better a page with eight photographs and four
 * deliberate panels than a page nobody waits for. */
export const IMAGE_BUDGET_BYTES = 2_600_000;

/** Every slot the generator declared, in document order. */
export function readSlots(html: string): ImageSlot[] {
  const slots: ImageSlot[] = [];

  for (const match of html.matchAll(/<img\b[^>]*\bdata-shot\s*=\s*"[^"]*"[^>]*>/gi)) {
    const tag = match[0];
    const attribute = (name: string) =>
      tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? "";

    const weight = attribute("data-weight").toLowerCase();
    slots.push({
      tag,
      shot: attribute("data-shot").trim(),
      alt: attribute("alt").trim(),
      ratio: attribute("data-ratio").trim() || "4/3",
      weight: weight === "hero" || weight === "feature" ? weight : "thumb",
    });
  }

  return slots;
}

/* The placeholder a slot ships with, and keeps when nothing fills it.
 *
 * Deliberately not a drawing of the thing. That is what produced the cartoons:
 * an SVG attempting a photograph of fabric reads as clip art, where a plain
 * toned panel reads as a photograph that has not loaded yet — and on a page
 * where the fill step never runs, a page of quiet panels is a page that looks
 * unfinished on purpose rather than badly made.
 *
 * The tone is derived from the art direction so that a page of placeholders is
 * varied rather than a grid of identical grey rectangles, and stable so that
 * rebuilding the same page does not reshuffle its colours. */
export function placeholderFor(slot: ImageSlot): string {
  let hash = 0;
  for (const character of `${slot.shot}${slot.alt}`) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  const hue = hash % 360;
  const [w, h] = ratioSize(slot.ratio);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 14% 88%)"/><stop offset="1" stop-color="hsl(${hue} 16% 79%)"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function ratioSize(ratio: string): [number, number] {
  const [a, b] = ratio.split("/").map((part) => Number(part.trim()));
  if (!a || !b) return [4, 3];
  return [a, b];
}

/** The order slots are filled in: the pictures that carry the page come first. */
const ORDER: Record<SlotWeight, number> = { hero: 0, feature: 1, thumb: 2 };

export type FillResult = {
  html: string;
  filled: number;
  skipped: number;
  bytes: number;
  credits: { author: string; source: string; url: string }[];
};

/**
 * Fills every slot it can afford, and leaves the rest as they are.
 *
 * Never throws and never returns a page worse than the one it was given: a
 * provider that fails, times out or finds nothing leaves that slot on its
 * placeholder, and the page is stored either way. This runs after generation
 * and before the page is saved, so nobody is waiting on it in a browser — but
 * it is still bounded, because a storefront is a dozen requests and a provider
 * having a bad day should not hold a build open.
 */
export async function fillImages(
  html: string,
  provider: ImageProvider | null,
  options: { budget?: number; timeoutMs?: number; context?: string } = {},
): Promise<FillResult> {
  const slots = readSlots(html);
  const credits: FillResult["credits"] = [];

  if (slots.length === 0) return { html, filled: 0, skipped: 0, bytes: 0, credits };

  const budget = options.budget ?? IMAGE_BUDGET_BYTES;
  const timeoutMs = options.timeoutMs ?? 12_000;

  /* Weight order for spending, document order for rewriting: the hero is
     filled first even when it appears last, and the tags are still replaced
     where they stand. */
  const queue = slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => ORDER[a.slot.weight] - ORDER[b.slot.weight] || a.index - b.index);

  const replacements = new Map<number, string>();
  let spent = 0;
  let filled = 0;

  /* The rewrite below runs whatever happens, including with no provider at
     all. That is not a detail: a slot ships with no src — the model is told to
     leave it out, because one it invented would be broken or overwritten — so
     the pass that puts placeholders in is the only thing standing between an
     unconfigured deployment and a page of broken-image icons. Returning early
     when there was nothing to fetch did exactly that, and it is why this loop
     is a spending decision rather than the whole function. */
  for (const { slot, index } of provider ? queue : []) {
    if (spent >= budget) break;

    let shot: Shot | null = null;
    try {
      shot = await withTimeout(
        provider!.shotFor(slot, WIDTH[slot.weight], options.context),
        timeoutMs,
      );
    } catch {
      shot = null;
    }
    if (!shot) continue;

    const encoded = shot.bytes.toString("base64");
    /* Measured as it will be stored, not as it was downloaded: base64 is the
       thing that has to fit. */
    if (spent + encoded.length > budget) continue;

    spent += encoded.length;
    filled += 1;
    replacements.set(index, `data:${shot.contentType};base64,${encoded}`);
    if (shot.credit) credits.push(shot.credit);
  }

  /* Rewritten by walking the slots in document order and replacing one
     occurrence each, because two products can legitimately carry the same tag
     and a global replace would give them the same photograph. */
  let out = html;
  let cursor = 0;
  slots.forEach((slot, index) => {
    const at = out.indexOf(slot.tag, cursor);
    if (at === -1) return;

    const source = replacements.get(index);
    const rewritten = source
      ? setAttribute(slot.tag, "src", source)
      : setAttribute(slot.tag, "src", placeholderFor(slot));

    out = out.slice(0, at) + rewritten + out.slice(at + slot.tag.length);
    cursor = at + rewritten.length;
  });

  return { html: out, filled, skipped: slots.length - filled, bytes: spent, credits };
}

function setAttribute(tag: string, name: string, value: string): string {
  const escaped = value.replace(/"/g, "&quot;");
  if (new RegExp(`\\b${name}\\s*=\\s*"`, "i").test(tag)) {
    return tag.replace(new RegExp(`\\b${name}\\s*=\\s*"[^"]*"`, "i"), `${name}="${escaped}"`);
  }
  return tag.replace(/<img\b/i, `<img ${name}="${escaped}"`);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/* A few words describing what was built, for the picture search.
 *
 * A brief is written to a model — "Build me an online shop for Adire wax print
 * fabric in Lagos, I want it to feel modern" — and a stock search wants a noun
 * phrase. So the instructions to the builder come out and what is left is the
 * subject: who this is for and what they sell.
 *
 * Kept to a handful of words on purpose. Stock search degrades quickly as a
 * query lengthens, and this is only ever APPENDED to a slot that was too
 * generic on its own — so its job is to add the one distinguishing fact, not to
 * restate the brief.
 */
const INSTRUCTION = new RegExp(
  "\\b(" +
    [
      /* Told to the builder, not about the subject. */
      "build|make|create|design|generate|want|need|please|can you|help",
      /* The artefact, which is the category rather than the thing. */
      "website|web ?site|site|page|app|application|online|store|shop|ecom+erce|blog|landing|platform|portal|news",
      /* Grammar. Left in, a brief yields "for gym" — and "for" is in every
         photograph ever taken. */
      "with|that|which|and|the|an?|my|our|its?|for|in|on|at|of|to|from|about|me|us",
      /* How it should feel, which is art direction rather than subject. */
      "feel|feels|looks?|like|modern|clean|simple|nice|beautiful|professional|minimal|elegant|premium|fun",
    ].join("|") +
    ")\\b",
  "gi",
);

export function searchContext(brief: string, words = 4): string {
  const kept = brief
    .replace(INSTRUCTION, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);

  /* First words rather than most frequent: a brief opens with what it is about
     and trails off into how it should feel, and the opening is the half worth
     searching for. */
  return kept.slice(0, words).join(" ");
}
