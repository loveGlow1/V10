/* What the message is asking for, decided before anything is generated.
 *
 * The router is heuristics first — free, instant, and right about the cases
 * that actually come up — with a model call only when the regexes genuinely
 * cannot tell. Every fallback resolves to "edit": mistaking an edit for a new
 * build discards the user's work, while mistaking a new build for an edit only
 * produces a patch that does not apply. */

export type Intent = "edit" | "new_project" | "question" | "revert";

export type IntentResult = {
  intent: Intent;
  targets: string[];
  confidence: number;
  source: "override" | "heuristic" | "model";
};

const REVERT = /\b(undo|revert|go back|restore|previous version|put it back)\b/i;

const QUESTION =
  /^(what|why|how|can you explain|does|do you|is it|are there|which|explain)\b/i;

const NEW_BUILD =
  /\b(build|create|make|generate|start|scaffold)\b.{0,40}\b(new|another|fresh|separate|second)\b|^\s*(new project|start over|from scratch)\b/i;

const EDIT_VERBS =
  /\b(change|edit|update|fix|adjust|tweak|move|remove|delete|replace|rename|resize|shrink|enlarge|swap|add|center|align|darken|lighten|increase|decrease|reorder|hide|show)\b/i;

const BACKREF =
  /\b(it|that|this|the (button|hero|nav|navbar|header|footer|card|section|form|modal|sidebar|text|title|heading|logo|background|color|colour|font|spacing|padding|margin|layout|page))\b/i;

const COMPARATIVE =
  /\b(bigger|smaller|darker|lighter|wider|narrower|taller|shorter|bolder|thinner|closer|further|more|less)\b/i;

/** The cheap deterministic pass. Returns null only when genuinely ambiguous. */
export function heuristicIntent(
  message: string,
  hasExistingFiles: boolean,
): IntentResult | null {
  const m = message.trim();

  if (REVERT.test(m)) {
    return { intent: "revert", targets: [], confidence: 0.9, source: "heuristic" };
  }

  // Nothing built yet, so there is nothing to edit: anything actionable is a
  // first build.
  if (!hasExistingFiles) {
    if (QUESTION.test(m)) {
      return { intent: "question", targets: [], confidence: 0.8, source: "heuristic" };
    }
    return { intent: "new_project", targets: [], confidence: 0.9, source: "heuristic" };
  }

  if (NEW_BUILD.test(m)) {
    return { intent: "new_project", targets: [], confidence: 0.8, source: "heuristic" };
  }

  if (QUESTION.test(m) && !EDIT_VERBS.test(m)) {
    return { intent: "question", targets: [], confidence: 0.75, source: "heuristic" };
  }

  // Once something exists, edit is the default. Short imperatives, back
  // references and comparatives are all edits.
  if (EDIT_VERBS.test(m) || BACKREF.test(m) || COMPARATIVE.test(m)) {
    return { intent: "edit", targets: [], confidence: 0.85, source: "heuristic" };
  }

  // "smaller", "more contrast", "the other blue" — a handful of words aimed at
  // something already on screen.
  if (m.split(/\s+/).length <= 8) {
    return { intent: "edit", targets: [], confidence: 0.6, source: "heuristic" };
  }

  return null; // ambiguous — escalate to the model
}

const ROUTER_PROMPT = `You classify a message sent to a website builder.

The user already has a project with these files:
{{FILES}}

Recent conversation:
{{HISTORY}}

Classify the new message into exactly one intent:
- "edit": modify the existing project in any way (default when unsure)
- "new_project": discard current work and build something entirely different
- "question": asking about the project, not requesting a change
- "revert": undo the last change

Only choose "new_project" if the user clearly wants to abandon the current
project. Ambiguity always resolves to "edit".

Also list which existing file paths the change most likely touches.

Respond with ONLY raw JSON, no markdown fences, no preamble:
{"intent":"edit","targets":["path/to/File.tsx"],"confidence":0.0}`;

export async function classifyIntent(opts: {
  message: string;
  filePaths: string[];
  history: { role: string; content: string }[];
  override?: Intent | null;
}): Promise<IntentResult> {
  // The UI said what it wanted. Nothing here is a better guess than that.
  if (opts.override) {
    return { intent: opts.override, targets: [], confidence: 1, source: "override" };
  }

  const quick = heuristicIntent(opts.message, opts.filePaths.length > 0);
  if (quick) return quick;

  const prompt = ROUTER_PROMPT.replace(
    "{{FILES}}",
    opts.filePaths.join("\n") || "(none)",
  ).replace(
    "{{HISTORY}}",
    opts.history.map((h) => `${h.role}: ${h.content}`).join("\n") || "(none)",
  );

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Routing is a one-line classification: the cheapest model that can do
        // it is the right one, and it runs on every ambiguous turn.
        model: "claude-haiku-4-5",
        max_tokens: 200,
        messages: [{ role: "user", content: `${prompt}\n\nMessage: ${opts.message}` }],
      }),
    });
    const data = await res.json();
    const text = (data.content ?? [])
      .filter((block: { type?: string }) => block.type === "text")
      .map((block: { text?: string }) => block.text ?? "")
      .join("")
      .replace(/```json|```/g, "")
      .trim();
    const parsed = JSON.parse(text);
    return {
      intent: (parsed.intent ?? "edit") as Intent,
      targets: Array.isArray(parsed.targets) ? parsed.targets : [],
      confidence: Number(parsed.confidence ?? 0.5),
      source: "model",
    };
  } catch {
    // Unreachable, rate limited, or unparseable. Failing safe means editing —
    // never wiping.
    return { intent: "edit", targets: [], confidence: 0.4, source: "model" };
  }
}
