/* The QA stage: one call, one structured answer.
 *
 * Everything the gates need is already decided by the time this runs — the
 * architecture manifest says what the project is supposed to do, the design
 * system says what it is supposed to look like. This consumes both rather than
 * deciding anything itself, which is §13's requirement and also the only way
 * the answers can agree with the build they are judging.
 *
 * ── The loop, and where it lives ──────────────────────────────────────────
 *
 * §10 asks for repair → build → render → QA → check again, capped. The loop is
 * here, in `runQaLoop`, but the two things it cannot do itself are supplied by
 * the caller: applying a repair (the edit path) and rendering (a browser).
 * Neither belongs in this module — one is a model call, the other is fifty
 * megabytes of Chromium — and taking either as an argument is what lets the
 * same loop run in the pipeline, in the CLI and in CI without three copies of
 * it drifting apart.
 *
 * A run with no repairer does one pass and reports. A run with no renderer
 * reports the rendered gates as not run. Neither is a failure and neither is a
 * pass: see types.ts, where "incomplete" exists precisely so that a gate nobody
 * exercised is never counted as one that succeeded.
 */

import type { ArchitectureManifest } from "@/lib/builder/architecture";
import type { DesignDNA } from "@/lib/builder/design";
import type { FileTree } from "@/lib/builder/tree";
import { type Renderer, gatesFrom, measureAll } from "./render";
import { type Repair, repairInstruction, repairsFor } from "./repair";
import { accessibilityGate, designGate, functionalGate, staticVisualGate } from "./static";
import {
  type Gate,
  type GateResult,
  type Issue,
  type QaResult,
  allIssues,
  emptyGate,
  summarise,
} from "./types";

export * from "./types";
export { VIEWPORTS, type Measurement, type Renderer, type Viewport, MEASURE_SCRIPT } from "./render";
export { type Repair, repairInstruction, repairsFor } from "./repair";
export { contrast, luminance, isDarkColor } from "./contrast";

export type QaInput = {
  /** The document to judge. For a project, the page that stands for it. */
  html: string;
  /** The project's files, when it has any. Empty for a single-page build. */
  tree?: FileTree;
  manifest?: ArchitectureManifest | null;
  design?: DesignDNA | null;
  /** Supplied where a browser exists. Absent means the rendered gates do not run. */
  render?: Renderer;
};

/** Merges two results for the same gate — the static findings and the rendered ones. */
function merge(a: GateResult, b: GateResult): GateResult {
  if (!a.ran) return b;
  if (!b.ran) return a;

  const issues = [...a.issues, ...b.issues];
  return { ran: true, passed: !issues.some((issue) => issue.severity === "error"), issues };
}

/**
 * One pass: every gate that can be answered, answered.
 *
 * Never throws. A QA stage that can fail a build by failing itself is worse
 * than no QA stage — the build was fine and somebody now has to work out that
 * the checker broke rather than the project.
 */
export async function runQa(input: QaInput): Promise<QaResult> {
  const tree = input.tree ?? [];

  const gates: Record<Gate, GateResult> = {
    visual: emptyGate(false),
    responsive: emptyGate(false),
    functional: emptyGate(false),
    accessibility: emptyGate(false),
    design: emptyGate(false),
  };

  try {
    gates.visual = staticVisualGate(input.html);
    gates.accessibility = accessibilityGate(input.html, input.design);
    gates.design = designGate(input.html, input.design);
    gates.functional = functionalGate(input.html, tree, input.manifest);
  } catch {
    /* A gate that threw contributes nothing and stays `ran: false`, which the
       summary turns into "incomplete" rather than into a pass. */
  }

  if (input.render) {
    try {
      const measurements = await measureAll(input.html, input.render);
      const rendered = gatesFrom(measurements);
      gates.visual = merge(gates.visual, rendered.visual);
      gates.responsive = merge(gates.responsive, rendered.responsive);
    } catch {
      /* Same: the rendered gates simply do not report. */
    }
  }

  /* Which gates HAVE to have run for a pass to mean anything.
   *
   * `responsive` is on this list unconditionally, and the first version of this
   * file had it conditional on a renderer having been supplied — so a run with
   * no browser reported "passed". That was the whole failure this module exists
   * to prevent, written into the module itself: a build whose layout nobody
   * looked at, claiming its layout was fine.
   *
   * The consequence is deliberate and it is the honest one. A pipeline run with
   * no browser comes back "incomplete", not "passed", because the layout really
   * was not checked. The build still saves, still previews and still reports
   * everything the static gates found; what it does not do is claim a
   * verification nobody performed. "passed" is then a word that means
   * something, which is the only reason to have it. */
  const required: Gate[] = ["visual", "accessibility", "responsive"];
  if (input.manifest) required.push("functional");
  if (input.design) required.push("design");

  return summarise(gates, { required });
}

export type QaLoopInput = QaInput & {
  /* Applies a repair and returns the document it produced, or null when it
     could not. The edit path, supplied by the caller — see repair.ts for why
     this module writes instructions and does not apply them. */
  repair?: (html: string, instruction: string) => Promise<string | null>;
  /** §10. Three by default: past that, a loop is thrashing rather than fixing. */
  maxAttempts?: number;
  /** Called after each pass, so a caller can report progress as it happens. */
  onPass?: (result: QaResult, attempt: number) => void;
};

export type QaLoopOutcome = {
  result: QaResult;
  /** The document as it ended up — repaired, or the original if nothing was. */
  html: string;
  /** What was tried, in order, for the report §10 asks for. */
  attempted: Repair[];
  /** What is still wrong. Empty on a pass. */
  unresolved: Issue[];
};

/**
 * Repair → re-render → re-check, capped.
 *
 * Stops on the first pass, when nothing left is repairable, when a repair does
 * not apply, or at the cap — and reports which. It never returns a passing
 * result it did not measure: the result in the outcome is always the one from
 * the last completed pass over the document in the outcome, so the two cannot
 * describe different versions.
 */
export async function runQaLoop(input: QaLoopInput): Promise<QaLoopOutcome> {
  const max = input.maxAttempts ?? 3;
  let html = input.html;
  let attempts = 0;
  const attempted: Repair[] = [];
  let issuesFixed = 0;

  let result = await runQa({ ...input, html });
  input.onPass?.(result, 0);

  while (result.status === "failed" && input.repair && attempts < max) {
    const before = allIssues(result).filter((issue) => issue.severity === "error").length;
    const repairs = repairsFor(allIssues(result));

    /* Nothing here can be fixed safely. Stopping is the correct outcome and
       the unresolved list below says exactly what was left. */
    if (repairs.length === 0) break;

    const repaired = await input.repair(html, repairInstruction(repairs));
    /* A repair that did not apply is not retried with the same instruction: the
       next round would produce the same edit and fail the same way. */
    if (!repaired) break;

    attempts += 1;
    attempted.push(...repairs);
    html = repaired;

    result = await runQa({ ...input, html });
    const after = allIssues(result).filter((issue) => issue.severity === "error").length;
    issuesFixed += Math.max(0, before - after);

    input.onPass?.(result, attempts);
  }

  return {
    result: { ...result, repairAttempts: attempts, issuesFixed },
    html,
    attempted,
    unresolved: allIssues(result).filter((issue) => issue.severity === "error"),
  };
}

/**
 * The structured failure §10 asks for.
 *
 * Written for somebody reading it in a conversation rather than in a log: what
 * failed, where, what was tried, and what is still wrong — in that order,
 * because that is the order the questions get asked in.
 */
export function reportFailure(outcome: QaLoopOutcome): string {
  const { result, attempted, unresolved } = outcome;

  if (result.status === "passed") return "";

  const lines: string[] = [];

  if (result.status === "incomplete") {
    const skipped = (["visual", "responsive", "functional", "accessibility", "design"] as Gate[]).filter(
      (gate) => !result[gate].ran,
    );
    lines.push(
      `Checked what could be checked here. ${skipped.join(", ")} ${skipped.length === 1 ? "was" : "were"} not exercised, so this is not a clean pass — it is an unfinished one.`,
    );
  } else {
    lines.push(
      `${unresolved.length} ${unresolved.length === 1 ? "problem" : "problems"} left after ${result.repairAttempts} repair ${result.repairAttempts === 1 ? "round" : "rounds"}.`,
    );
  }

  if (attempted.length > 0) {
    lines.push("", `Repaired: ${[...new Set(attempted.map((repair) => repair.rule))].join(", ")}.`);
  }

  if (unresolved.length > 0) {
    lines.push("", "Still wrong:");
    for (const issue of unresolved.slice(0, 8)) {
      lines.push(`  ${issue.rule}${issue.viewport ? ` (${issue.viewport})` : ""} — ${issue.message}`);
    }
  }

  return lines.join("\n");
}
