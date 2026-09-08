/* The engine, applied to the two things this app actually sends a model.
 *
 * budget.ts, layers.ts, compress.ts and fit.ts are general. This file is not:
 * it knows that an edit is a page plus an instruction, that a build is a brief,
 * and what each of those should do when there is more of it than there is room
 * for. Call sites ask these two functions and get back something they can send,
 * so no route does its own arithmetic and no route carries a character cap.
 *
 * ── What changed, and why it matters more than the arithmetic ─────────────
 *
 * Both paths used to end in the same place when something was large: a sentence
 * telling the person their message was too long and to send it again in pieces.
 * That is the product asking the user to do the system's job, and it was doing
 * it on a CHARACTER count that had nothing to do with what the model could
 * actually hold — an 80,000-character ceiling on a 200,000-token window, with a
 * 46,000-character page already inside it and four screenshots counted as free.
 *
 * The rule now is: measure it, make room for it, and only say no when the thing
 * being asked for genuinely cannot be done in one call — and then say what to
 * do about it rather than what went wrong. */

import { budgetFor, estimateTokens, type ContextBudget } from "./budget";
import { condense, extractRequirements, requirementBlock } from "./compress";
import { planContext, type ContextPlan } from "./fit";
import type { ContextItem } from "./layers";

/* What this app's edit system prompt costs, when the caller cannot say.
 *
 * The route decides whether an edit will fit before edit.ts has composed the
 * system prompt, so the figure is not available at the moment it is needed.
 * This is a deliberate overestimate of it — the composed prompt with an
 * architecture brief attached runs to a few thousand tokens — and being wrong
 * high costs a little window, while being wrong low costs a refused request. */
const ASSUMED_EDIT_SYSTEM_TOKENS = 4_000;

export type EditFit = {
  /** The instruction to send. Identical to what was passed unless `restructured`. */
  prompt: string;
  /**
   * True when the instruction was rewritten into a structured form to fit.
   *
   * Not a truncation: the constraints in it are carried verbatim as a numbered
   * ledger, and only the prose around them was reduced. See fitEdit.
   */
  restructured: boolean;
  /**
   * True when no arrangement of this page and this instruction fits one call.
   *
   * The only case that still has to be reported to the person, and the caller
   * should say what to do — split the change — rather than name a limit.
   */
  mustDecompose: boolean;
  plan: ContextPlan;
  budget: ContextBudget;
};

/**
 * Whether this edit fits, and what to send if it does.
 *
 * The page is not negotiable — an edit is a change to a specific document, and
 * a summarised page is a page the model will confidently rewrite from memory.
 * So when something has to give, it is the shape of the INSTRUCTION that gives,
 * and only after its constraints have been pulled out and preserved.
 */
export function fitEdit(input: {
  /** What the person typed. Stored and shown verbatim whatever happens here. */
  prompt: string;
  /** The page as the model will see it — images already lifted out. */
  pageHtml: string;
  /** Picker id of the model that will run the edit. */
  modelId: string;
  /** Screenshots and references travelling with the message. Never free. */
  images?: number;
  /** The conversation being carried, already shaped. Priced, not placed. */
  priorTokens?: number;
  systemTokens?: number;
}): EditFit {
  const budget = budgetFor({
    modelId: input.modelId,
    kind: "edit",
    systemTokens: input.systemTokens ?? ASSUMED_EDIT_SYSTEM_TOKENS,
    images: input.images ?? 0,
  });

  /* The carried conversation is spent before anything here is placed: it is
     assembled by the caller and travels as its own messages, so it reduces the
     room rather than competing for it. */
  const carried = Math.max(0, input.priorTokens ?? 0);
  const room = Math.max(0, budget.usableInput - carried);

  const pageTokens = estimateTokens(input.pageHtml);
  const promptTokens = estimateTokens(input.prompt);

  const items: ContextItem[] = [
    { id: "page", layer: "target", text: input.pageHtml, lossless: true, relevance: 1 },
    { id: "instruction", layer: "request", text: input.prompt, lossless: true, relevance: 1 },
  ];

  const plan = planContext(items, { ...budget, usableInput: room }, "edit");

  if (!plan.overflow) {
    return { prompt: input.prompt, restructured: false, mustDecompose: false, plan, budget };
  }

  /* Over. The page keeps every token it needs; what is left is what the
     instruction may spend.
   *
   * Restructuring rather than trimming, and the difference is the whole point:
   * every sentence that constrains the outcome is lifted out and carried word
   * for word as a numbered requirement, and only the prose between those
   * sentences is reduced. A brief cut at a word count loses its acceptance
   * criteria, because that is where people put them. This keeps them and drops
   * the adjectives. */
  const instructionRoom = room - pageTokens;

  if (instructionRoom > 200) {
    const requirements = extractRequirements(input.prompt);
    const ledger = requirementBlock(requirements);
    const ledgerTokens = estimateTokens(ledger);

    const proseRoom = instructionRoom - ledgerTokens;
    const prose = proseRoom > 100 ? condense(input.prompt, proseRoom) : null;

    const rebuilt = [prose?.text ?? "", ledger].filter(Boolean).join("\n\n");

    if (rebuilt && estimateTokens(rebuilt) <= instructionRoom) {
      const replanned = planContext(
        [
          { id: "page", layer: "target", text: input.pageHtml, lossless: true, relevance: 1 },
          { id: "instruction", layer: "request", text: rebuilt, lossless: true, relevance: 1 },
        ],
        { ...budget, usableInput: room },
        "edit",
      );

      return {
        prompt: rebuilt,
        restructured: true,
        mustDecompose: replanned.overflow,
        plan: replanned,
        budget,
      };
    }
  }

  /* The page alone does not leave usable room for any instruction at all. This
     is the one honest refusal, and it is about the PAGE rather than about what
     the person wrote — which is what the caller should say. */
  return {
    prompt: input.prompt,
    restructured: false,
    mustDecompose: true,
    plan,
    budget,
  };
}

export type BriefFit = {
  /** The brief to build from. Restructured rather than cut when it was large. */
  brief: string;
  restructured: boolean;
  /** Every constraint found in the brief, carried verbatim. Empty when none. */
  requirements: ReturnType<typeof extractRequirements>;
  plan: ContextPlan;
  budget: ContextBudget;
};

/**
 * A build brief, made to fit the model that will build from it.
 *
 * A build reserves the model's whole output ceiling — a twelve-section page IS
 * the maximum output — so the room for input is smaller than the window
 * suggests, and a brief long enough to matter here is a specification rather
 * than a sentence. Same treatment as an oversized edit: the requirements are
 * lifted out whole, the prose around them is reduced, and nothing is refused.
 */
export function fitBrief(input: {
  brief: string;
  modelId: string;
  /** The composed blueprint, which is the system prompt for a build. */
  systemTokens?: number;
  images?: number;
}): BriefFit {
  const budget = budgetFor({
    modelId: input.modelId,
    kind: "build",
    systemTokens: input.systemTokens ?? 0,
    images: input.images ?? 0,
  });

  const requirements = extractRequirements(input.brief);
  const briefTokens = estimateTokens(input.brief);

  if (briefTokens <= budget.usableInput) {
    const plan = planContext(
      [{ id: "brief", layer: "request", text: input.brief, lossless: true, relevance: 1 }],
      budget,
      "build",
    );
    return { brief: input.brief, restructured: false, requirements, plan, budget };
  }

  const ledger = requirementBlock(requirements);
  const proseRoom = budget.usableInput - estimateTokens(ledger);
  const prose = proseRoom > 100 ? condense(input.brief, proseRoom) : null;
  const rebuilt = [prose?.text ?? "", ledger].filter(Boolean).join("\n\n");

  const plan = planContext(
    [{ id: "brief", layer: "request", text: rebuilt || input.brief, lossless: true, relevance: 1 }],
    budget,
    "build",
  );

  return {
    brief: rebuilt || input.brief,
    restructured: Boolean(rebuilt) && rebuilt !== input.brief,
    requirements,
    plan,
    budget,
  };
}
