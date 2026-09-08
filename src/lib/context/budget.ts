/* How much the model can actually be told, and how much of that is spoken for.
 *
 * Everything in this app that reaches a model used to be capped in characters
 * or in words — 80,000 characters of instruction, 1,000 words of carried brief,
 * the last six turns — and every one of those numbers was chosen by hand for
 * one model on one path. None of them is what the model measures. A page is
 * markup, which tokenises far denser than prose; a screenshot costs over a
 * thousand tokens and used to be counted as nothing at all; and a limit written
 * for Haiku's 200K window was still being applied when the same work was routed
 * to Sonnet's million.
 *
 * So this module owns one question — GIVEN THIS MODEL AND THIS TASK, HOW MANY
 * TOKENS MAY THE INPUT BE — and every caller asks it rather than carrying a
 * constant of its own.
 *
 * ── Estimated, not counted, and deliberately ──────────────────────────────
 *
 * Anthropic will count exactly (`/v1/messages/count_tokens`), and that is a
 * network round trip per request on a path that has sixty seconds for the whole
 * edit. An estimate that is always slightly HIGH costs a little unused window;
 * a round trip costs a second of the user's time on every message and one more
 * thing that can fail. So the estimate is local, deterministic, and biased
 * upward — see CHARS_PER_TOKEN.
 *
 * Nothing here calls a model, reaches a network or reads a database. It is
 * arithmetic, which is what lets the same functions run in the composer to
 * predict a fit and on the server to enforce one. */

import { MODELS, modelById } from "@/app/dashboard/models";

/* Characters per token, biased low so the token estimate comes out high.
 *
 * English prose runs about 4. HTML, CSS and code run nearer 3 — tags, braces
 * and hyphenated class names split into many small tokens — and this app's
 * largest inputs are exactly that: whole generated pages. 3.5 sits under the
 * mixed case, so a 46,000-character page is estimated at about 13,100 tokens
 * against a true count nearer 12,000.
 *
 * The direction is the point. Overestimating means the request is a little
 * smaller than it could have been; underestimating means a 400 from the API
 * after the user has waited, which is the failure this whole module exists to
 * make impossible. */
const CHARS_PER_TOKEN = 3.5;

/* What one attached image costs before anybody looks at it.
 *
 * Images are not free and were being treated as free: a screenshot at roughly
 * 1,100×800 is about 1,600 tokens, and an edit can carry several. A message
 * with four screenshots was accounted at zero and priced the same as a message
 * with none.
 *
 * One flat figure rather than width×height/750, because the app resizes what it
 * accepts (see project-attachments.ts) and a formula over dimensions this
 * module cannot see would be false precision. High enough to cover a full-page
 * screenshot. */
const TOKENS_PER_IMAGE = 1_600;

/** Roughly how many tokens a piece of text will cost, rounded up. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** What `count` attached images cost. Never zero for a non-zero count. */
export function imageTokens(count: number): number {
  return Math.max(0, Math.trunc(count)) * TOKENS_PER_IMAGE;
}

/* ── What each model can hold ──────────────────────────────────────────────
 *
 * The window is a property of the model, so it lives on the model — see
 * `contextWindow` in dashboard/models.ts, which check:context requires on
 * anything callable. This is the reader, with a floor for the case the type
 * system cannot rule out: an id nobody recognises.
 *
 * 200,000 is the smallest window any model this app can reach actually has
 * (Haiku's), so an unknown id is budgeted as the most cautious real model
 * rather than as the most generous. A wrong guess in that direction wastes
 * window; the other direction sends a request the model refuses. */
const FALLBACK_WINDOW = 200_000;

/** The model's context window in tokens — input and output share it. */
export function contextWindowFor(modelId: string | null | undefined): number {
  if (!modelId) return FALLBACK_WINDOW;
  const model = modelById(modelId);
  return model.contextWindow ?? FALLBACK_WINDOW;
}

/** The most output tokens worth asking that model for. */
export function maxOutputFor(modelId: string | null | undefined): number {
  if (!modelId) return 8_000;
  return modelById(modelId).maxOutput ?? 8_000;
}

/* A margin held back from every budget, over and above the output reservation.
 *
 * Three things live in it: the difference between an estimate and a true count,
 * the wire overhead of the message envelope, and whatever the provider counts
 * that this app cannot see. Two percent of the window, floored at 2,000 tokens
 * so a small window still gets a real margin. */
const SAFETY_FRACTION = 0.02;
const MIN_SAFETY = 2_000;

/** What a task is, for the purpose of deciding how much room the answer needs. */
export type TaskKind =
  /** A whole page or project, written from a brief. The largest output. */
  | "build"
  /** Search/replace blocks against an existing page. Small output, huge input. */
  | "edit"
  /** Prose back to the person. Output is bounded by how much there is to say. */
  | "answer"
  /** One word or one label back. Output is nearly nothing. */
  | "classify";

/* What each kind of task needs room to WRITE, before anything is read.
 *
 * The reservation is the whole point of the module (§2 of the guide): a window
 * spent entirely on input is a request that cannot be answered. These are
 * fractions of the model's own output ceiling rather than absolute figures, so
 * a model with a bigger ceiling reserves more without a second table.
 *
 * A build asks for all of it: a twelve-section page IS the model's maximum
 * output, and the run that arrives without its closing tag is the failure that
 * set maxOutput in the first place. An edit needs a handful of blocks and the
 * thinking that precedes them. A classification needs a word. */
const OUTPUT_SHARE: Record<TaskKind, number> = {
  build: 1,
  edit: 0.4,
  answer: 0.25,
  classify: 0.01,
};

/** The floor under any reservation, so no task is left unable to reply. */
const MIN_OUTPUT_RESERVE = 1_000;

export type BudgetInput = {
  /** Picker id of the model this request will run on. */
  modelId: string;
  kind: TaskKind;
  /** The system prompt, which is input and is usually the largest fixed cost. */
  systemTokens?: number;
  /** Tool definitions and anything else the provider counts as input. */
  toolTokens?: number;
  /** Attached images, counted per §22 rather than assumed free. */
  images?: number;
  /** Overrides the reservation when the caller knows what it will ask for —
   *  edit.ts, for one, has a measured figure for a patch reply. */
  reserveOutput?: number;
};

export type ContextBudget = {
  modelId: string;
  kind: TaskKind;
  /** Everything the model can hold, input and output together. */
  window: number;
  /** Held back for the reply. */
  reservedOutput: number;
  /** Already spent on the system prompt, tools and images. */
  fixed: number;
  /** Held back for estimation error and wire overhead. */
  safety: number;
  /** What is left for everything a caller wants to say. Never negative. */
  usableInput: number;
};

/**
 * What this request may spend, given the model it runs on and the shape of the
 * answer it expects.
 *
 * AVAILABLE = WINDOW − OUTPUT RESERVE − SYSTEM − TOOLS − IMAGES − SAFETY, which
 * is the guide's arithmetic written once so that no call site does its own.
 */
export function budgetFor(input: BudgetInput): ContextBudget {
  const window = contextWindowFor(input.modelId);

  const reservedOutput = Math.min(
    /* Never reserve more than the model can actually produce: a reservation
       past maxOutput protects room nothing will ever write into. */
    maxOutputFor(input.modelId),
    Math.max(
      MIN_OUTPUT_RESERVE,
      input.reserveOutput ?? Math.round(maxOutputFor(input.modelId) * OUTPUT_SHARE[input.kind]),
    ),
  );

  const fixed =
    (input.systemTokens ?? 0) + (input.toolTokens ?? 0) + imageTokens(input.images ?? 0);

  const safety = Math.max(MIN_SAFETY, Math.round(window * SAFETY_FRACTION));

  return {
    modelId: input.modelId,
    kind: input.kind,
    window,
    reservedOutput,
    fixed,
    safety,
    usableInput: Math.max(0, window - reservedOutput - fixed - safety),
  };
}

/* ── Pressure ──────────────────────────────────────────────────────────────
 *
 * How full the input is, as four states rather than a number, because the
 * decisions taken from it are four: send it, prioritise, compress hard, or send
 * only what the task cannot be done without.
 *
 * The thresholds are on the way UP, so pressure is acted on before anything is
 * refused — the guide's §18: detect and compress rather than wait for the model
 * to reject the request.
 *
 * None of this is shown to the person typing. It is a decision the system takes
 * and a line in the log; the composer that says "your prompt is too long" is
 * the product this replaces. */
export type Pressure = "green" | "yellow" | "orange" | "red";

export function pressureOf(usedTokens: number, budget: ContextBudget): Pressure {
  if (budget.usableInput <= 0) return "red";
  const share = usedTokens / budget.usableInput;
  if (share < 0.6) return "green";
  if (share < 0.85) return "yellow";
  if (share <= 1) return "orange";
  return "red";
}

/** Every model this app can actually call. Used by check:context, which
 *  requires a window on each of them. */
export function callableModels() {
  return MODELS.filter((model) => model.provider !== "auto" && model.available !== false);
}
