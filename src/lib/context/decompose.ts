/* Turning one thing that does not fit into several that do.
 *
 * The guide's §34 and §35, and they are the same idea from two directions: a
 * request too large for one call is not a request to refuse, it is a request to
 * split. "Build a complete Shopify-style store with admin, auth, checkout,
 * payments and analytics" is a perfectly reasonable sentence that no single
 * model call should try to answer in one document.
 *
 * What this file does is decide the STEPS. What it deliberately does not do is
 * run them — the build path executes one orchestrator call today, and a
 * decomposer that quietly started making several would change what a build
 * costs and how long it takes without anybody asking for that. So the plan is
 * produced, carried into the prompt, and shown to the person; wiring it to an
 * executor is a change to the orchestrator, not to this module.
 *
 * Deterministic: the order below is an ordering of the architecture layers,
 * which is a fact about how software is built rather than a judgement about
 * this project. Data before the things that read it; auth before the things it
 * protects; QA last, because it checks the rest. */

import type { Requirement } from "./compress";

export type Step = {
  /** 1-based, and the order they must run in. */
  order: number;
  /** What this step is called, in the language the person used where possible. */
  title: string;
  /** What it produces. One sentence. */
  outcome: string;
  /** The requirement refs this step satisfies, when any are known. */
  requirements: string[];
};

/* The layers of a project, in the only order they can be built in.
 *
 * Each entry says what turns it on: a manifest flag, or a word in the brief.
 * A step nothing turned on is not in the plan — a plan that lists "payments"
 * for a portfolio site reads as a plan written for somebody else. */
const LAYERS: {
  key: string;
  title: string;
  outcome: string;
  needs?: (manifest: PlanManifest) => boolean;
  words?: RegExp;
}[] = [
  {
    key: "architecture",
    title: "Architecture",
    outcome: "The shape of the project: what it is, what it needs, and what it does not.",
  },
  {
    key: "database",
    title: "Database",
    outcome: "The tables, their relationships, and the policies that protect them.",
    needs: (manifest) => manifest.database === true,
    words: /\b(database|schema|table|records?|store data|persist)\b/i,
  },
  {
    key: "auth",
    title: "Accounts and sign-in",
    outcome: "Who may sign in, and what they may reach once they have.",
    needs: (manifest) => manifest.authentication === true,
    words: /\b(sign[- ]?in|log[- ]?in|account|auth|register|password|session)\b/i,
  },
  {
    key: "backend",
    title: "Backend",
    outcome: "The routes and clients the pages call.",
    needs: (manifest) => manifest.backend === true,
    words: /\b(api|endpoint|server|backend|webhook)\b/i,
  },
  {
    key: "pages",
    title: "Pages",
    outcome: "The pages people actually visit, in the design the project uses.",
  },
  {
    key: "admin",
    title: "Admin",
    outcome: "The screens the owner uses to run it.",
    needs: (manifest) => manifest.admin === true,
    words: /\b(admin|dashboard|back[- ]?office|manage)\b/i,
  },
  {
    key: "checkout",
    title: "Checkout",
    outcome: "The path from a full basket to a placed order.",
    words: /\b(checkout|basket|cart|order)\b/i,
  },
  {
    key: "payments",
    title: "Payments",
    outcome: "Taking money, and what happens when it succeeds or fails.",
    needs: (manifest) => manifest.payments === true,
    words: /\b(payment|pay|stripe|card|billing|invoice|subscription)\b/i,
  },
  {
    key: "analytics",
    title: "Analytics",
    outcome: "What the owner can see about how it is being used.",
    words: /\b(analytics|metrics|report|tracking|insights?)\b/i,
  },
  {
    key: "qa",
    title: "Check it works",
    outcome: "Every page rendered and read back, and anything broken repaired.",
  },
];

export type PlanManifest = {
  database?: boolean;
  authentication?: boolean;
  backend?: boolean;
  admin?: boolean;
  payments?: boolean;
  storage?: boolean;
};

/* Below this a task is not worth splitting: three requirements and a landing
   page is one build, and a plan for it is ceremony. */
const WORTH_SPLITTING = 6;

export type Decomposition = {
  steps: Step[];
  /** False when the task is small enough to run as one call, which is most. */
  needed: boolean;
  why: string;
};

/**
 * The steps this task should run as.
 *
 * `force` is for the case the engine already knows about — planContext came
 * back with `overflow`, so the task provably does not fit however small the
 * plan looks.
 */
export function decompose(input: {
  brief: string;
  requirements?: Requirement[];
  manifest?: PlanManifest | null;
  force?: boolean;
}): Decomposition {
  const requirements = input.requirements ?? [];
  const manifest = input.manifest ?? {};
  const brief = input.brief;

  const steps: Step[] = [];

  for (const layer of LAYERS) {
    /* Always-on layers (architecture, pages, QA) have neither test. Everything
       else has to be turned on by the manifest or named in the brief — the
       manifest is the reliable signal and the words are what catches a project
       whose manifest was never recorded. */
    const turnedOn =
      (!layer.needs && !layer.words) ||
      (layer.needs?.(manifest) ?? false) ||
      (layer.words?.test(brief) ?? false);

    if (!turnedOn) continue;

    steps.push({
      order: steps.length + 1,
      title: layer.title,
      outcome: layer.outcome,
      requirements: requirements
        .filter((requirement) => layer.words?.test(requirement.text) ?? false)
        .map((requirement) => requirement.id),
    });
  }

  const needed = Boolean(input.force) || requirements.length >= WORTH_SPLITTING || steps.length > 5;

  return {
    steps,
    needed,
    why: input.force
      ? "the whole of it does not fit in one call"
      : needed
        ? `${requirements.length} requirements across ${steps.length} parts of the project`
        : "small enough to build in one pass",
  };
}

/**
 * The plan, said to the person whose request it is.
 *
 * Written as what will happen rather than as an apology for what will not. This
 * is the sentence that replaces "your message is too long": somebody who asked
 * for a store and is told "this is nine steps, starting with the database"
 * knows more than they did, and is not being asked to do the splitting
 * themselves.
 */
export function describeDecomposition(plan: Decomposition): string {
  if (plan.steps.length === 0) return "";
  const lines = plan.steps.map((step) => `${step.order}. ${step.title} — ${step.outcome}`);
  return [`This is big enough to do in stages — ${plan.why}:`, ...lines].join("\n");
}

/**
 * The same plan, for a prompt rather than for a person.
 *
 * Named steps and the requirements each one owns, so a model building step four
 * knows what steps one to three already produced and does not rebuild them.
 */
export function decompositionBrief(plan: Decomposition): string {
  if (plan.steps.length === 0) return "";
  const lines = plan.steps.map((step) => {
    const refs = step.requirements.length > 0 ? ` [${step.requirements.join(", ")}]` : "";
    return `${step.order}. ${step.title}: ${step.outcome}${refs}`;
  });
  return [
    "This project is planned in these stages, in this order. Build them in one pass but keep them separable, and do not skip a stage that has requirements against it:",
    ...lines,
  ].join("\n");
}
