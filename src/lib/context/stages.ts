/* A plan, run one stage at a time, across as many builds as it takes.
 *
 * decompose.ts decides what the stages ARE. This is what turns them into
 * something that actually happens: which stage a project is on, what the next
 * build should be told, what to say when one lands, and when the whole thing is
 * finished.
 *
 * ── Why the app drives this and the workflow does not ─────────────────────
 *
 * The orchestrator is one HTTP node per provider and no logic, deliberately —
 * a body built in this repository is a body that can be reviewed in a diff,
 * and the prompts that used to live on a canvas drifted for weeks without
 * anybody seeing. Making the WORKFLOW loop would put the plan back in the one
 * place nobody reads. So the plan lives in the project's context row, each
 * stage is an ordinary build carrying a stage-scoped prompt, and the sequence
 * is state rather than control flow. A stage that fails leaves a plan that can
 * be resumed; a workflow that fails halfway through a loop leaves nothing.
 *
 * ── Why each stage is asked for rather than fired automatically ───────────
 *
 * A stage is a full generation: minutes of model time and a charge against a
 * balance. Five stages is five charges, and a system that decides on its own to
 * spend five times what somebody expected is not helpful, whatever the plan
 * said. So a landed stage announces the next one and the person says go — one
 * word, which carryBrief already understands as a continuation. The system does
 * the planning, the sequencing and the carrying-forward; the spending stays a
 * decision.
 */

import type { Step } from "./decompose";

export type StagePlan = {
  /** The stages, in the order they must run. Never reordered once started. */
  steps: Step[];
  /** The 1-based order of the stage being built, or about to be. */
  current: number;
  /** Stages that have landed, by order. */
  completed: number[];
  /** What the whole plan was for — the brief that produced it, kept so a stage
   *  four builds later still knows what it is part of. */
  brief: string;
  startedAt: string;
};

/**
 * A runnable plan from a decomposition.
 *
 * Only the stages a generation performs, renumbered 1..N. The architecture is
 * decided by the app before any model is called and the check runs over
 * whatever came back, so listing them as stages would mean asking somebody to
 * say "continue" — and pay — for work that has already happened. They stay in
 * the plan the person is SHOWN, which is a different thing and lives in
 * describeDecomposition.
 */
export function planFrom(steps: Step[], brief: string, now = new Date().toISOString()): StagePlan {
  const buildable = steps
    .filter((step) => step.performedBy !== "system")
    .map((step, index) => ({ ...step, order: index + 1 }));

  return {
    steps: buildable,
    current: buildable.length > 0 ? 1 : 0,
    completed: [],
    brief,
    startedAt: now,
  };
}

/** The stage a build should be building, or null when the plan is finished. */
export function currentStage(plan: StagePlan | null | undefined): Step | null {
  if (!plan || plan.current < 1) return null;
  return plan.steps.find((step) => step.order === plan.current) ?? null;
}

/** The one after it, for the sentence that offers to carry on. */
export function nextStage(plan: StagePlan | null | undefined): Step | null {
  if (!plan) return null;
  return plan.steps.find((step) => step.order === plan.current + 1) ?? null;
}

export function isFinished(plan: StagePlan | null | undefined): boolean {
  return Boolean(plan) && plan!.completed.length >= plan!.steps.length;
}

/**
 * Marks a stage landed and moves to the next.
 *
 * Idempotent on the stage number, because the save route can run twice for one
 * build — a retried request, a replayed webhook — and a plan that advanced
 * twice would skip a stage nobody built.
 */
export function advance(plan: StagePlan, landed: number): StagePlan {
  if (plan.completed.includes(landed)) return plan;
  const completed = [...plan.completed, landed].sort((a, b) => a - b);
  return { ...plan, completed, current: Math.min(landed + 1, plan.steps.length + 1) };
}

/**
 * What the next build is actually asked to do.
 *
 * The stage, the brief it came from, and — the part that makes this work at all
 * — an explicit instruction about what already exists. A model asked to "build
 * the checkout" against a project that already has a storefront will otherwise
 * rebuild the storefront, and the person watching sees their homepage change
 * for no reason on a message about payments.
 */
export function stageInstruction(plan: StagePlan, step: Step): string {
  const done = plan.steps.filter((entry) => plan.completed.includes(entry.order));

  return [
    `${step.title}: ${step.outcome}`,
    done.length > 0
      ? `This continues a project that already has: ${done.map((entry) => entry.title.toLowerCase()).join(", ")}. Keep all of it exactly as it is and add only this stage.`
      : "This is the first stage of the project.",
    `The whole of what was asked for, for context — build only this stage of it: ${plan.brief}`,
  ].join("\n\n");
}

/**
 * The plan as the generation prompt should see it.
 *
 * Named stages with the finished ones marked, so a model building stage three
 * knows what one and two produced and does not produce them again — and knows
 * what four and five will add, so it does not design them out.
 */
export function stagePlanBrief(plan: StagePlan): string {
  const step = currentStage(plan);
  if (!step) return "";

  const lines = plan.steps.map((entry) => {
    const state =
      plan.completed.includes(entry.order)
        ? "ALREADY BUILT — do not rebuild it, do not change it"
        : entry.order === step.order
          ? "THIS STAGE — build this now"
          : "a later stage — leave room for it, do not build it";
    return `${entry.order}. ${entry.title} — ${state}`;
  });

  return [
    `THIS BUILD IS STAGE ${step.order} OF ${plan.steps.length}.`,
    "",
    ...lines,
    "",
    "Building a later stage early is a defect: it costs the person a stage they have not asked for yet and it will be rebuilt when they do.",
  ].join("\n");
}

/**
 * Which path a stage takes: a build, or an edit against what exists.
 *
 * The rule that makes staging safe, in one place so it can be asserted rather
 * than remembered. A generation returns a whole document and the save route
 * stores what comes back, so a BUILD replaces the project — which is right for
 * the first stage, when there is nothing to replace, and catastrophic for the
 * third, which would return a document containing only stage three and delete
 * the two before it. Everything after the first stage is therefore an addition
 * to a project that already exists, which is exactly what the edit path is.
 */
export function pathForStage(hasProject: boolean): "build" | "edit" {
  return hasProject ? "edit" : "build";
}

/** Where the plan has got to, for the person watching. */
export function describeProgress(plan: StagePlan): string {
  const done = plan.completed.length;
  const total = plan.steps.length;
  const next = nextStage(plan);

  if (done >= total) {
    return `That was the last stage — all ${total} are built.`;
  }

  return [
    `Stage ${done} of ${total} is done.`,
    next ? `Next is ${next.order}. ${next.title} — ${next.outcome}` : "",
    next ? `Say "continue" and I'll build it.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
