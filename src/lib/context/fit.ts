/* Deciding what actually goes into one model call.
 *
 * This is the join between the two halves either side of it: budget.ts knows
 * how many tokens there are, layers.ts knows what each piece of context is
 * worth, and this walks the second against the first.
 *
 * The rule it enforces is the guide's core principle, and it is a rule about
 * ORDER rather than about size. Nothing is dropped because it arrived late or
 * sat at the bottom of a list; things are dropped because everything more
 * important to this particular request had already been placed. When something
 * has to go, it is summarised if that is safe, deferred if it can be fetched
 * again, and reported either way — a caller always knows what its model was not
 * told, which is the difference between managing context and losing it.
 *
 * The one thing it will not do is squeeze the critical layers. If the system
 * prompt, the request and the thing being edited do not fit together, that is
 * not a context to be compressed — it is a task to be decomposed, and it comes
 * back as `overflow` so the caller can split the work rather than truncate it
 * or refuse the person. */

import { condense } from "./compress";
import { estimateTokens, pressureOf, type ContextBudget, type Pressure } from "./budget";
import { isCritical, priorityOf, type ContextItem, type Layer, type TaskProfile } from "./layers";

/** A piece of context as it will actually be sent. */
export type PlacedItem = {
  id: string;
  layer: Layer;
  text: string;
  tokens: number;
  /** True when this is a shortened form of what was offered. */
  condensed: boolean;
};

/** Something that did not go, and why — the record that makes a bad answer
 *  explainable afterwards. */
export type OmittedItem = {
  id: string;
  layer: Layer;
  tokens: number;
  /**
   * `deferred` — retrievable, so nothing is lost: fetch it when it is needed.
   * `summarised-away` — a lossy item whose compressed form still did not fit.
   * `no-room`         — it would not fit and could not be reduced or refetched.
   */
  reason: "deferred" | "summarised-away" | "no-room";
};

export type ContextPlan = {
  /** In the order they were placed: most important first. */
  kept: PlacedItem[];
  omitted: OmittedItem[];
  /** Input tokens this plan will actually spend. */
  usedTokens: number;
  budget: ContextBudget;
  pressure: Pressure;
  /**
   * True when the layers that cannot be reduced do not fit on their own.
   *
   * The signal to DECOMPOSE — split the work into steps, each of which fits —
   * rather than to truncate or to refuse. Nothing else in this module can tell
   * a caller that, and no caller should be inventing the test for itself.
   */
  overflow: boolean;
  /** Everything a log needs to explain what this call was given. */
  record: ContextRecord;
};

/** What §37 asks to be tracked, in one object, for one call. */
export type ContextRecord = {
  model: string;
  task: TaskProfile;
  window: number;
  reservedOutput: number;
  usableInput: number;
  usedTokens: number;
  pressure: Pressure;
  kept: number;
  condensed: number;
  omitted: number;
  overflow: boolean;
  /** id → reason, so a support question about a bad edit has an answer. */
  omittedDetail: Record<string, OmittedItem["reason"]>;
};

/* Below this, a condensed item is not worth its own tokens: a paragraph
   reduced to a sentence and an elision note says almost nothing and still
   costs. Anything that cannot keep at least this much is deferred or dropped
   whole instead. */
const MIN_USEFUL_TOKENS = 120;

/**
 * What to send, given everything that could be sent.
 *
 * Items may be handed in in any order; this sorts them. Ties break on
 * relevance, then on size — a small item ahead of a large one of equal value,
 * because two things fitting beats one.
 */
export function planContext(
  items: ContextItem[],
  budget: ContextBudget,
  task: TaskProfile,
): ContextPlan {
  const measured = items
    .filter((item) => item.text && item.text.trim())
    .map((item) => ({ item, tokens: estimateTokens(item.text) }));

  const ordered = [...measured].sort((a, b) => {
    const byPriority = priorityOf(a.item.layer, task) - priorityOf(b.item.layer, task);
    if (byPriority !== 0) return byPriority;
    const byRelevance = (b.item.relevance ?? 0.5) - (a.item.relevance ?? 0.5);
    if (byRelevance !== 0) return byRelevance;
    return a.tokens - b.tokens;
  });

  const kept: PlacedItem[] = [];
  const omitted: OmittedItem[] = [];
  let used = 0;

  /* The critical layers are placed first and without a test, because there is
     no useful answer to "the request does not fit" other than to say so. They
     are already at the head of the ordering; this just means the loop below
     never declines one. */
  for (const { item, tokens } of ordered) {
    const remaining = budget.usableInput - used;

    if (isCritical(item.layer)) {
      kept.push({ id: item.id, layer: item.layer, text: item.text, tokens, condensed: false });
      used += tokens;
      continue;
    }

    if (tokens <= remaining) {
      kept.push({ id: item.id, layer: item.layer, text: item.text, tokens, condensed: false });
      used += tokens;
      continue;
    }

    /* It does not fit whole. What happens next is decided by what it IS, never
       by how much room is left: something that must stay exact is never
       shortened to make it fit. */
    if (item.lossless) {
      omitted.push({
        id: item.id,
        layer: item.layer,
        tokens,
        reason: item.retrievable ? "deferred" : "no-room",
      });
      continue;
    }

    if (remaining < MIN_USEFUL_TOKENS) {
      omitted.push({
        id: item.id,
        layer: item.layer,
        tokens,
        reason: item.retrievable ? "deferred" : "no-room",
      });
      continue;
    }

    const shorter = condense(item.text, remaining);

    if (!shorter.reduced || shorter.tokens > remaining) {
      /* One indivisible block bigger than the room left. Cutting inside it is
         the arbitrary truncation this whole module exists to avoid. */
      omitted.push({
        id: item.id,
        layer: item.layer,
        tokens,
        reason: item.retrievable ? "deferred" : "summarised-away",
      });
      continue;
    }

    kept.push({
      id: item.id,
      layer: item.layer,
      text: shorter.text,
      tokens: shorter.tokens,
      condensed: true,
    });
    used += shorter.tokens;
  }

  const criticalTokens = measured
    .filter(({ item }) => isCritical(item.layer))
    .reduce((total, { tokens }) => total + tokens, 0);

  const pressure = pressureOf(used, budget);
  const overflow = criticalTokens > budget.usableInput;

  return {
    kept,
    omitted,
    usedTokens: used,
    budget,
    pressure,
    overflow,
    record: {
      model: budget.modelId,
      task,
      window: budget.window,
      reservedOutput: budget.reservedOutput,
      usableInput: budget.usableInput,
      usedTokens: used,
      pressure,
      kept: kept.length,
      condensed: kept.filter((item) => item.condensed).length,
      omitted: omitted.length,
      overflow,
      omittedDetail: Object.fromEntries(omitted.map((item) => [item.id, item.reason])),
    },
  };
}

/**
 * The plan's text, in priority order, ready to concatenate into a prompt.
 *
 * Callers that want to place items themselves can read `kept` instead; this is
 * for the common case where the order the planner chose is the order the prompt
 * should read in.
 */
export function planText(plan: ContextPlan, separator = "\n\n"): string {
  return plan.kept.map((item) => item.text).join(separator);
}

/**
 * One line for the log, said the way an operator reading it at 3am needs it.
 *
 * Written on every call rather than only when something was dropped: a call
 * that fitted comfortably is the baseline you need in order to recognise the
 * one that did not.
 */
export function describePlan(plan: ContextPlan): string {
  const record = plan.record;
  const parts = [
    `context: ${record.usedTokens}/${record.usableInput} tokens on ${record.model}`,
    `(window ${record.window}, ${record.reservedOutput} reserved for output)`,
    `${record.pressure}`,
    `${record.kept} kept`,
  ];
  if (record.condensed > 0) parts.push(`${record.condensed} condensed`);
  if (record.omitted > 0) {
    parts.push(
      `${record.omitted} omitted [${Object.entries(record.omittedDetail)
        .map(([id, reason]) => `${id}:${reason}`)
        .join(" ")}]`,
    );
  }
  if (record.overflow) parts.push("OVERFLOW — task needs decomposing");
  return parts.join(" ");
}
