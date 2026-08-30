import Anthropic from "@anthropic-ai/sdk";

/* Where the app is actually built.
 *
 * One prompt in, one complete standalone HTML document out — markup, styles and
 * whatever interactivity the page needs, in a single file. That is the whole
 * artifact for now: it is what the preview panel renders, what a later publish
 * step would deploy, and the smallest thing that is genuinely a built page
 * rather than a description of one.
 *
 * The output is never trusted by this app. It is model output shaped by a
 * user's prompt, so it is stored as text and served under a sandboxing CSP that
 * puts it in an opaque origin — see src/app/preview/[projectId]/route.ts. This
 * module's job is to produce it, not to vouch for it. */

export const GENERATION_MODEL = "claude-opus-5";

/* The page has to be finishable inside one response. 16k is a large, complete
   landing page with room to spare; a page that needs more than this is a page
   that should have been a multi-file project, which is the next artifact, not
   this one. */
const MAX_TOKENS = 16_000;

/* Roughly what a page of this size would have been as a hand-written file tree,
   and what /api/build prices the build from. Derived rather than invented: the
   model reports nothing about effort, and the caller needs a number that moves
   with the work. */
function filesTouchedFor(html: string): number {
  /* A section is about a file's worth of work. Bounded so a very long page
     cannot price a single build at more than the generate band allows anyway. */
  const sections = (html.match(/<section\b|<main\b|<header\b|<footer\b|<nav\b/gi) ?? []).length;
  return Math.max(3, Math.min(sections, 12));
}

const SYSTEM = `You build complete, production-quality web pages as a single self-contained HTML file.

OUTPUT FORMAT — this is absolute:
- Reply with the HTML document and nothing else. No prose before it, no explanation after it, no markdown fences.
- Start at <!doctype html> and end at </html>.

WHAT TO BUILD:
- One file. Inline all CSS in a <style> tag and all JavaScript in a <script> tag. No build step, no imports, no bundler.
- Tailwind is available: <script src="https://cdn.tailwindcss.com"></script>. Use it, or write plain CSS — whichever suits the design. Google Fonts may be linked.
- No other external scripts, and no external images: use inline SVG, CSS gradients, and solid shapes for artwork. A broken <img> to a stock-photo URL is worse than no image, and every such URL is broken.
- Real, specific copy written for this product. Never "Lorem ipsum" and never "Your headline here".
- Responsive from 320px up. Semantic HTML, labelled form controls, alt text, visible focus states, sufficient contrast.
- Make it look designed rather than defaulted: a considered type scale, deliberate spacing, a coherent palette, and restrained motion.
- Forms and interactive controls should behave — validate and respond in-page. There is no backend, so never post to one; show the state a real submission would produce.

If the request is for an app rather than a page, build its interface and make it work client-side, holding state in memory.`;

export type GeneratedPage = {
  html: string;
  model: string;
  filesTouched: number;
};

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

/* The model is asked for a bare document, and asking is not the same as
   getting: a fenced block is the one deviation worth expecting, and unwrapping
   it is cheaper than failing the build over a pair of backticks. Anything else
   that is not a document is a real failure and is reported as one. */
function extractDocument(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n?```$/i);
  const body = (fenced ? fenced[1] : trimmed).trim();

  if (!/^<!doctype html/i.test(body) && !/^<html/i.test(body)) {
    throw new GenerationError("The model did not return an HTML document.", 502);
  }
  return body;
}

/**
 * Builds a page from a description. Throws {@link GenerationError} with a
 * status the route can pass on.
 */
export async function generatePage({
  prompt,
  projectName,
  previousHtml,
}: {
  prompt: string;
  projectName: string;
  /** The page as it stands, when this build is a change to an existing one. */
  previousHtml?: string | null;
}): Promise<GeneratedPage> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new GenerationError(
      "Building is not connected yet — ANTHROPIC_API_KEY is not set.",
      503,
    );
  }

  const client = new Anthropic();

  /* A second message in a workspace is a change to the app, not a new one, so
     the current page goes in and the model edits it. Without this every
     follow-up would silently throw away the last build and start over — which
     is what "make the header darker" must never do. */
  const instruction = previousHtml
    ? `This is the current page for "${projectName}":\n\n${previousHtml}\n\nApply this change, and return the complete updated document:\n\n${prompt}`
    : `Build this, for a project called "${projectName}":\n\n${prompt}`;

  let message: Anthropic.Message;
  try {
    /* Streamed because the response is long: a non-streaming request at this
       max_tokens is the shape that hits an HTTP timeout rather than an answer.
       The final message is all this needs — there is nowhere to show tokens as
       they arrive, since the caller is n8n. */
    message = await client.messages
      .stream({
        model: GENERATION_MODEL,
        max_tokens: MAX_TOKENS,
        /* Design work benefits from thinking; the whole chain has 60 seconds,
           which is what keeps the effort off the top of the range. */
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: SYSTEM,
        messages: [{ role: "user", content: instruction }],
      })
      .finalMessage();
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new GenerationError("ANTHROPIC_API_KEY was rejected.", 502);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new GenerationError("The model is rate limited — try again shortly.", 429);
    }
    if (error instanceof Anthropic.APIError) {
      throw new GenerationError(`The model could not be reached (${error.status}).`, 502);
    }
    throw new GenerationError("The model could not be reached.", 502);
  }

  /* Checked before the content is read, because a refusal is a 200 with no
     answer in it — and here it means a prompt the model declined to build. */
  if (message.stop_reason === "refusal") {
    throw new GenerationError(
      "The model declined to build that. Try describing the page differently.",
      422,
    );
  }

  /* Narrowed rather than indexed: with thinking on, content[0] is a thinking
     block, not the text. */
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (!text.trim()) {
    throw new GenerationError("The model returned nothing.", 502);
  }

  /* A page cut off at the token ceiling is a broken document — unclosed tags,
     half a stylesheet — and looks in the preview like the build failed
     mysteriously. Better to say which it was. */
  if (message.stop_reason === "max_tokens") {
    throw new GenerationError(
      "The page came out longer than one build allows. Try asking for something simpler, or for one section at a time.",
      502,
    );
  }

  const html = extractDocument(text);
  return { html, model: message.model, filesTouched: filesTouchedFor(html) };
}
