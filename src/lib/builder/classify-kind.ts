import Anthropic from "@anthropic-ai/sdk";

import {
  bestKindGuess,
  heuristicKind,
  isBuildKind,
  type BuildKind,
  type KindResult,
} from "@/lib/builder/kinds";

/* Deciding what kind of build a brief is, when the free rules could not.
 *
 * Server-only: it imports the SDK, and kinds.ts deliberately does not, so the
 * regexes and the labels can be read by the browser and compiled on their own
 * by tools/check-blueprint.mjs.
 *
 * Same shape as the message router in intent.ts. The heuristics answer almost
 * everything for nothing; the model is asked only about the briefs they
 * declined; and no path throws, because a build that cannot be classified must
 * still be built rather than refused. */

const KIND_SYSTEM = `You decide what kind of thing to build from one description of a website.

Reply with ONLY raw JSON, no markdown fences and no preamble:
{"kind":"landing","confidence":0.0}

kind is exactly one of:
- "landing": one page with one audience and one action. Marketing pages, product launches, waitlists, portfolios, restaurant and event pages, anything whose job is to explain an offer and get one response.
- "ecommerce": a storefront. A catalogue of things for sale, a cart, and a checkout. The commerce is the product, not a mention.
- "blog": a publication. Articles, categories, an archive, an author. WordPress content sites belong here.
- "webapp": software people sign into. Accounts, their own data, several views, a back end behind it.

You are only asked when a fast rule-based pass could not decide, so these are the hard ones. What that pass finds hard:

- A page ABOUT a business is not that business's software. "a page for my clinic with an appointment form" is "landing"; "a system where patients book and manage appointments" is "webapp".
- A page about products is not a store. "a landing page for my new headphones" is "landing" — one product, one pitch. A catalogue you can buy from is "ecommerce".
- A site with a blog on it is not a blog. If articles are one section of a marketing site, it is "landing"; if the articles are the point, it is "blog".
- A dashboard shown as a picture is not an app. A screenshot-style marketing page of a dashboard is "landing"; a dashboard people sign into is "webapp".
- WordPress by itself means "blog". WordPress with a shop, WooCommerce, or products for sale means "ecommerce".

When the brief names the kind outright, that is the answer, even if it mentions other things.
When two readings are genuinely equal, answer "landing" — it is the smallest thing to be wrong about.`;

/**
 * What kind of build this brief describes.
 *
 * Never throws. An unreachable model falls back to whatever the heuristics were
 * leaning towards, which is a better answer than a constant and a worse one
 * than the model's.
 */
export async function classifyKind(opts: {
  brief: string;
  override?: BuildKind | null;
}): Promise<KindResult> {
  /* Rung one: a choice, not a reading. The target chips above the composer say
     what someone wants before they have written a word of it, and nothing
     below is allowed to talk them out of it. */
  if (opts.override) {
    return { kind: opts.override, confidence: 1, source: "selection", reason: "you chose it" };
  }

  const quick = heuristicKind(opts.brief);
  if (quick) return quick;

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      kind: bestKindGuess(opts.brief),
      confidence: 0.4,
      source: "model",
      reason: "closest reading of what you described",
    };
  }

  try {
    /* Haiku and a 100-token ceiling, for the same reason the message router
       uses them: this is one routing decision on a short description, made
       while somebody waits, and there is nothing here that a sentence of
       context does not settle. */
    const message = await new Anthropic().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 100,
      system: KIND_SYSTEM,
      messages: [{ role: "user", content: opts.brief.slice(0, 4000) }],
    });

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    const parsed = JSON.parse(text) as { kind?: string; confidence?: number };

    return {
      kind: isBuildKind(parsed.kind) ? parsed.kind : bestKindGuess(opts.brief),
      confidence: Number(parsed.confidence ?? 0.5),
      source: "model",
      reason: "read from what you described",
    };
  } catch {
    return {
      kind: bestKindGuess(opts.brief),
      confidence: 0.4,
      source: "model",
      reason: "closest reading of what you described",
    };
  }
}
