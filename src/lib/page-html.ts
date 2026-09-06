/* Reading what the generator produced.
 *
 * The page itself is generated in the orchestrator now — n8n has no
 * sixty-second ceiling on a node, and a Vercel function does, which is the
 * whole reason generation moved there. What stays here is everything the app
 * has to do to the result before it will store it: check that it is actually a
 * document, and price the work it represents.
 *
 * Nothing here trusts the input. It is model output shaped by a user's prompt,
 * arriving over HTTP from a workflow anyone with n8n access can edit. */

/* Two limits now, because a page has two kinds of weight and only one of them
   is a problem.
 *
 * MAX_MARKUP_BYTES is the old 400KB, and it still guards the thing it was
 * written for: markup and script that have run away. Past that it is not a page
 * any more.
 *
 * MAX_HTML_BYTES is what may actually be stored, and it is larger because
 * pictures are embedded now — real photographs as base64 data URIs, put in
 * after generation by src/lib/builder/images.ts. Base64 costs a third more than
 * the bytes it carries, so a storefront with a dozen photographs is measured in
 * megabytes rather than kilobytes. fillImages spends against its own budget and
 * stops; this is the backstop under it. */
const MAX_MARKUP_BYTES = 400_000;
const MAX_HTML_BYTES = 4_000_000;

/* Everything that is not an embedded picture. Measuring the markup with a
   megabyte of base64 in it would make the first limit meaningless. */
function markupBytes(html: string): number {
  return Buffer.byteLength(html.replace(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/gi, ""), "utf8");
}

export class PageHtmlError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PageHtmlError";
  }
}

/**
 * The HTML document in `value`, or throws {@link PageHtmlError}.
 *
 * A fenced code block is unwrapped: it is the one deviation a model reliably
 * makes when asked for a bare document, and failing a whole build over a pair
 * of backticks would be its own kind of wrong. Anything else that is not a
 * document is a real failure and is reported as one.
 */
export function readGeneratedDocument(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PageHtmlError("The build produced no page.", 422);
  }

  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n?```$/i);
  const html = (fenced ? fenced[1] : trimmed).trim();

  if (!/^<!doctype html/i.test(html) && !/^<html/i.test(html)) {
    throw new PageHtmlError("What came back was not an HTML document.", 422);
  }

  /* Truncation is the failure that looks like success: a document cut off at
     the model's token ceiling still starts with <!doctype html>, and renders as
     half a page with no error anywhere. The closing tag is what distinguishes
     "finished" from "ran out". */
  if (!/<\/html\s*>\s*$/i.test(html)) {
    throw new PageHtmlError(
      "The page came out longer than one build allows, so it arrived unfinished. Try asking for something simpler, or for one section at a time.",
      422,
    );
  }

  if (markupBytes(html) > MAX_MARKUP_BYTES) {
    throw new PageHtmlError("The page's markup is too large to store.", 413);
  }
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    throw new PageHtmlError("The page is too large to store, even for one with photographs in it.", 413);
  }

  return html;
}

/* ── Showing a model a page that has photographs in it ─────────────────────
 *
 * A stored page carries its pictures inside it as base64 data URIs — that is
 * deliberate, it is what makes the file somebody downloads work anywhere. It
 * also makes the page unreadable to a model.
 *
 * Measured on a real one: 463,340 characters, of which 47,191 were markup and
 * 416,149 were three photographs. Base64 is close to one token per character,
 * so those three pictures were about 370,000 tokens on their own, and every
 * edit posted the whole document. The API answered what it had to answer —
 * "prompt is too long: 377740 tokens > 200000 maximum" — and the page became
 * permanently uneditable the moment it got its images. Not slow. Not
 * expensive. Impossible.
 *
 * The model does not need the bytes. It needs to know an <img> is there, where
 * it sits and what it is called, all of which live in the tag around the src.
 * So the pictures are lifted out before the page is shown, and put back after
 * the change applies — the same trick as an attachment token, for the same
 * reason: nothing that costs a hundred thousand tokens to read and cannot be
 * edited should ever reach a model.
 */

/* Deliberately not a valid URL. A src the model tries to be clever about is a
   src it might rewrite; this one is obviously a placeholder for something. */
const STASHED = (index: number) => `stashed-image-${index}`;

const DATA_URI = /data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/g;

export type StashedImages = { lean: string; images: string[] };

/**
 * The page with its embedded pictures lifted out, and the pictures.
 *
 * The same picture appearing twice is stashed once and pointed at twice, which
 * is both smaller and what somebody meant by using their logo in two places.
 */
export function stashImages(html: string): StashedImages {
  const images: string[] = [];
  const seen = new Map<string, string>();

  const lean = html.replace(DATA_URI, (uri) => {
    const already = seen.get(uri);
    if (already) return already;

    const token = STASHED(images.length);
    images.push(uri);
    seen.set(uri, token);
    return token;
  });

  return { lean, images };
}

/**
 * The page with its pictures put back.
 *
 * A token the edit removed takes its picture with it, which is correct: asking
 * for a photograph to go should make it go. A token that was never handed out —
 * a model inventing one — is emptied rather than left to render as a broken
 * image, the same rule attachments follow.
 */
export function restoreImages(html: string, images: string[]): string {
  let restored = html;

  images.forEach((uri, index) => {
    restored = restored.split(STASHED(index)).join(uri);
  });

  return restored.replace(/stashed-image-\d+/g, "");
}

/**
 * Roughly what this page would have been as a hand-written file tree, which is
 * what a build is priced from.
 *
 * Derived from the page rather than reported by the generator: the number
 * decides what someone is charged, so it must not be a field the workflow could
 * be edited to inflate.
 */
export function filesTouchedFor(html: string): number {
  const sections = (html.match(/<section\b|<main\b|<header\b|<footer\b|<nav\b/gi) ?? []).length;
  return Math.max(3, Math.min(sections, 12));
}
