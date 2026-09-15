/* The pipeline, written down once.
 *
 *   user prompt → understand product → decide capabilities →
 *   provision only what is needed → generate → inspect → repair → deploy
 *
 * Every one of those stages exists in this codebase and has done for some time.
 * What did not exist was anywhere that said so — so the order lived in the
 * reading order of a 2,600-line route, the stage names lived in a state machine
 * that three of them never entered, and whether a stage had run at all was
 * answered by grepping.
 *
 * That is not a documentation problem. Three concrete defects came out of it,
 * and each one was invisible in exactly the same way:
 *
 *   The job was opened AFTER provisioning, so `provisioning` was a state the
 *   machine defined and nothing could ever be in.
 *
 *   The save route went `assembling → ready`, so `validating` and `repairing`
 *   were states the machine defined and nothing could ever be in — while QA
 *   was running twenty lines above, its verdict going into a chat message.
 *
 *   And `inspect → repair` ran backwards: autofix repaired the document and
 *   THEN the gates looked at it, so whatever the gates found was never
 *   repaired by anything.
 *
 * So the stages are data here, each one naming the module that owns it and the
 * job state it corresponds to, and tools/check-pipeline.mjs asserts that every
 * state the machine can be in is a state the code can actually reach. A stage
 * that stops being wired fails a check rather than becoming a word in a type.
 *
 * ── What this is not ──────────────────────────────────────────────────────
 *
 * Not a framework, and nothing executes through it. The routes still call their
 * own functions in their own order; this is the description those calls are
 * checked against. A pipeline that ran through a table of function pointers
 * would be harder to read than the route it replaced and would move every
 * stage one level away from the thing it does.
 *
 * Pure — no SDK, no I/O — so the check compiles it on its own.
 */

import type { JobState } from "@/lib/jobs/state";

export const STAGES = [
  "understand",
  "capabilities",
  "provision",
  "generate",
  "assemble",
  "inspect",
  "repair",
  "deploy",
] as const;

export type Stage = (typeof STAGES)[number];

export type StageSpec = {
  stage: Stage;
  /** What it is called where somebody reads it. */
  label: string;
  /** What the stage decides, in one sentence, in product terms. */
  decides: string;
  /* The job state a build is in while this runs. Two stages share `planning`
     because they are one uninterruptible step from outside — a build does not
     pause between working out what the product is and working out what it
     needs — and a state nobody can observe separately is a state that should
     not exist separately. */
  state: JobState;
  /** The modules that own it. Paths relative to src/, checked to exist. */
  owners: readonly string[];
  /* Whether this stage may be skipped, and when. Every skip here is a project
     that genuinely does not need the stage — NOT a stage that failed. A
     landing page has nothing to provision and nothing to deploy, and forcing
     it through either would mean inventing work to keep a sequence tidy. */
  skippedWhen: string | null;
};

/**
 * The stages, in the order they run.
 *
 * The order is the product decision, not an implementation detail. Capabilities
 * are decided BEFORE anything is provisioned so that only what is needed is;
 * provisioning happens BEFORE generation so the code is written against tables
 * that exist rather than tables the prompt hopes for; and inspection happens
 * BEFORE repair, which is the one that was backwards.
 */
export const PIPELINE: readonly StageSpec[] = [
  {
    stage: "understand",
    label: "Understanding the product",
    decides: "what is being built, who for, and in whose conventions",
    state: "planning",
    owners: [
      "lib/builder/brief.ts",
      "lib/builder/kinds.ts",
      "lib/builder/stack.ts",
      "lib/builder/market.ts",
    ],
    skippedWhen: null,
  },
  {
    stage: "capabilities",
    label: "Deciding what it needs",
    decides: "which of the seven layers this project actually has",
    state: "planning",
    owners: [
      "lib/builder/architecture.ts",
      "lib/builder/design.ts",
      "lib/builder/assets/asset-planner.ts",
    ],
    skippedWhen: null,
  },
  {
    stage: "provision",
    label: "Creating the database",
    decides: "the tables the manifest asked for, and nothing else",
    state: "provisioning",
    owners: [
      "lib/builder/schema.ts",
      "lib/builder/backend/connection.ts",
      "lib/builder/backend/provision.ts",
    ],
    /* THE LINE THE WHOLE ARCHITECTURE TURNS ON. A project whose manifest has
       no database layer does not reach this stage at all — no connection is
       opened, no schema is named, no migration is written. That is what
       "provision only what is needed" means in code rather than in a prompt. */
    skippedWhen: "the manifest has no database layer",
  },
  {
    stage: "generate",
    label: "Writing the code",
    decides: "the document or the file tree, from a prompt composed per kind",
    state: "generating",
    owners: [
      "lib/builder/blueprints/index.ts",
      "lib/builder/model-request.ts",
      "lib/n8n.ts",
    ],
    skippedWhen: null,
  },
  {
    /* THE PRODUCT PIPELINE SAYS "generate"; THE CODE SPLITS IT IN TWO, and the
       split is worth naming rather than hiding. Generation returns a document
       or a tree and nothing else — the photographs are fetched, the design
       tokens compiled in, the scaffold merged under what the model wrote, and
       the whole thing stored, all AFTERWARDS and all in a different process
       from the one that generated it.
       
       Leaving it unnamed is what let `assembling` become a job state belonging
       to no stage, which is how a stage stops being checkable. */
    stage: "assemble",
    label: "Putting it together",
    decides: "the artefact as it will actually be stored and served",
    state: "assembling",
    owners: [
      "lib/builder/images.ts",
      "lib/builder/scaffold.ts",
      "lib/builder/store-tree.ts",
    ],
    skippedWhen: null,
  },
  {
    stage: "inspect",
    label: "Checking it",
    decides: "whether what came back works, reads and holds together",
    state: "validating",
    owners: ["lib/builder/qa/index.ts", "lib/builder/validate.ts"],
    skippedWhen: null,
  },
  {
    stage: "repair",
    label: "Fixing what the check found",
    decides: "the defects with exactly one correct fix, applied and re-checked",
    state: "repairing",
    owners: ["lib/builder/qa/autofix.ts", "lib/builder/qa/repair.ts"],
    skippedWhen: "the inspection found nothing repairable",
  },
  {
    stage: "deploy",
    label: "Putting it online",
    decides: "where the built project runs, and whether it got there",
    state: "deploying",
    owners: ["lib/publish/vercel-deploy.ts", "lib/publish/deployment-store.ts"],
    skippedWhen: "the build is a single page, which is served from its own row",
  },
];

/* Waiting on a person, which is not a stage but is where the pipeline PAUSES.
 *
 * Three questions can stop a build before anything is spent: which kind of
 * thing this is, whether it is a site or software, and whether it has a back
 * half at all. All three happen inside `understand`/`capabilities`, and all
 * three are answered by the next message resuming the same job.
 *
 * It is listed apart from PIPELINE because it is not work — nothing is running
 * — but it is emphatically part of the run, and a build sitting in it is the
 * state most worth surviving a browser refresh: somebody asked a question and
 * is waiting for the answer to do something. */
export const PAUSED: JobState = "needs_input";

/** The stage a job in this state is in, or null for the states outside the run. */
export function stageFor(state: JobState): Stage | null {
  return PIPELINE.find((spec) => spec.state === state)?.stage ?? null;
}

/** Every job state the pipeline accounts for. */
export function pipelineStates(): JobState[] {
  return [...new Set(PIPELINE.map((spec) => spec.state))];
}

/**
 * The pipeline as a sentence, for a log line or a reply.
 *
 * Arrows rather than numbers, because the order is the point and a numbered
 * list invites somebody to reorder one entry without noticing that the
 * ordering was the argument.
 */
export function describePipeline(): string {
  return PIPELINE.map((spec) => spec.stage).join(" → ");
}
