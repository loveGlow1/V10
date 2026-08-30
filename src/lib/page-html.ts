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

/* A page has to be finishable and storable. Past this it is not a landing page
   any more, and it is worth refusing rather than putting a megabyte of
   something into a row that is read on every preview. */
const MAX_HTML_BYTES = 400_000;

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

  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    throw new PageHtmlError("The page is too large to store.", 413);
  }

  return html;
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
