import Anthropic from "@anthropic-ai/sdk";

/* What a message in a workspace is asking for.
 *
 * Until now every message was a build. Sending "make the header darker" and
 * sending "build me a law firm site" did the same thing, and "undo that" was
 * built as though it were a design brief. The four cases below are genuinely
 * different, and only one of them should ever replace someone's work.
 *
 * Heuristics first, because they are free, instant and right almost always. The
 * model is asked only when the heuristics decline to guess — and every failure
 * path, including the model being unreachable, resolves to "edit". Failing safe
 * here means changing a page, never wiping one. */

export type Intent = "edit" | "new_project" | "question" | "revert";

export type IntentResult = {
  intent: Intent;
  confidence: number;
  source: "override" | "heuristic" | "model";
};

const REVERT = /\b(undo|revert|go back|restore|previous version|put it back)\b/i;

const QUESTION =
  /^(what|why|how|can you explain|does|do you|is it|are there|which|explain)\b/i;

const NEW_BUILD =
  /\b(build|create|make|generate|start|scaffold)\b.{0,40}\b(new|another|fresh|separate|second|different)\b|^\s*(new project|start over|from scratch)\b/i;

const EDIT_VERBS =
  /\b(change|edit|update|fix|adjust|tweak|move|remove|delete|replace|rename|resize|shrink|enlarge|swap|add|centre|center|align|darken|lighten|increase|decrease|reorder|hide|show)\b/i;

const BACKREF =
  /\b(it|that|this|the (button|hero|nav|navbar|header|footer|card|section|form|modal|sidebar|text|title|heading|logo|background|colour|color|font|spacing|padding|margin|layout|page))\b/i;

const COMPARATIVE =
  /\b(bigger|smaller|darker|lighter|wider|narrower|taller|shorter|bolder|thinner|closer|further|more|less)\b/i;

/** The cheap deterministic pass. Null when genuinely ambiguous. */
export function heuristicIntent(message: string, hasPage: boolean): IntentResult | null {
  const m = message.trim();

  if (REVERT.test(m)) return { intent: "revert", confidence: 0.9, source: "heuristic" };

  /* Nothing built yet, so there is nothing to edit and nothing to lose:
     anything actionable is the first build. */
  if (!hasPage) {
    if (QUESTION.test(m)) return { intent: "question", confidence: 0.8, source: "heuristic" };
    return { intent: "new_project", confidence: 0.9, source: "heuristic" };
  }

  if (NEW_BUILD.test(m)) return { intent: "new_project", confidence: 0.8, source: "heuristic" };

  if (QUESTION.test(m) && !EDIT_VERBS.test(m)) {
    return { intent: "question", confidence: 0.75, source: "heuristic" };
  }

  /* Once a page exists, editing is the default. Imperatives, back references
     and comparatives — "smaller", "move it left", "the hero" — are all edits,
     and none of them read as a brief for a new site. */
  if (EDIT_VERBS.test(m) || BACKREF.test(m) || COMPARATIVE.test(m)) {
    return { intent: "edit", confidence: 0.85, source: "heuristic" };
  }

  /* A handful of words aimed at a page that exists is a note about that page,
     not a specification for another one. */
  if (m.split(/\s+/).length <= 8) {
    return { intent: "edit", confidence: 0.6, source: "heuristic" };
  }

  return null;
}

const ROUTER_SYSTEM = `You classify one message sent to a website builder. The user already has a page built.

Reply with ONLY raw JSON, no markdown fences and no preamble:
{"intent":"edit","confidence":0.0}

intent is exactly one of:
- "edit": change the existing page in any way. This is the default whenever you are unsure.
- "new_project": abandon the current page and build something entirely different.
- "question": asking about the page, not asking for a change.
- "revert": undo the last change.

Choose "new_project" only when the user clearly wants to throw the current page away. Ambiguity always resolves to "edit".`;

/** Classifies a message. Never throws — an unreachable model resolves to "edit". */
export async function classifyIntent(opts: {
  message: string;
  hasPage: boolean;
  history: { from: string; text: string }[];
  override?: Intent | null;
}): Promise<IntentResult> {
  if (opts.override) {
    return { intent: opts.override, confidence: 1, source: "override" };
  }

  const quick = heuristicIntent(opts.message, opts.hasPage);
  if (quick) return quick;

  if (!process.env.ANTHROPIC_API_KEY) {
    return { intent: "edit", confidence: 0.4, source: "model" };
  }

  try {
    /* Haiku, and a 100-token ceiling: this is a routing decision on a short
       message, made before every build, and it is on the path of someone
       waiting. Thinking is off for the same reason — there is nothing here to
       reason about that a sentence of context does not settle. */
    const message = await new Anthropic().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 100,
      system: ROUTER_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Recent conversation:\n${
            opts.history.map((h) => `${h.from}: ${h.text}`).join("\n") || "(none)"
          }\n\nMessage: ${opts.message}`,
        },
      ],
    });

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    const parsed = JSON.parse(text) as { intent?: string; confidence?: number };
    const intent = parsed.intent;

    return {
      intent:
        intent === "new_project" || intent === "question" || intent === "revert"
          ? intent
          : "edit",
      confidence: Number(parsed.confidence ?? 0.5),
      source: "model",
    };
  } catch {
    /* Unreachable, rate limited, or answered with something that is not JSON.
       All of them mean edit: the failure that changes a page is recoverable,
       the failure that replaces one is not. */
    return { intent: "edit", confidence: 0.4, source: "model" };
  }
}
