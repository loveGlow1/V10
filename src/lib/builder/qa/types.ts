/* What a QA run produces.
 *
 * One shape, returned whether the run rendered anything or not, so a caller
 * never branches on which kind of run it got. What differs is `ran`: a gate
 * that could not be exercised says so rather than reporting a pass it did not
 * earn. That distinction is the whole reason this file has a type instead of a
 * boolean — "no problems found" and "nothing was looked at" produce identical
 * empty issue lists and must never be reported identically.
 */

export const GATES = ["visual", "responsive", "functional", "accessibility", "design"] as const;
export type Gate = (typeof GATES)[number];

/** How much a finding matters. Only `error` can fail a gate. */
export type Severity = "error" | "warning";

export type Issue = {
  gate: Gate;
  severity: Severity;
  /** A stable id, so a repair can be looked up and a fix can be verified. */
  rule: string;
  /** What is wrong, in a sentence somebody can act on. */
  message: string;
  /* Where — a selector, a file path, a viewport, whatever locates it. Absent
     when the finding is about the document as a whole. */
  where?: string;
  /** The viewport this was found at, when it is viewport-dependent. */
  viewport?: string;
};

export type GateResult = {
  /* Whether this gate was actually exercised. False means the run had no way
     to answer — no browser for the rendered gates, no manifest for the
     functional ones — and `passed` below is then meaningless on its own. */
  ran: boolean;
  passed: boolean;
  issues: Issue[];
};

export type QaResult = {
  /* "passed" only when every gate that RAN passed and every gate that had to
     run did. "incomplete" is the honest answer when a required gate could not
     be exercised: it is not a pass, and it is not a failure of the project. */
  status: "passed" | "failed" | "incomplete";
  visual: GateResult;
  responsive: GateResult;
  functional: GateResult;
  accessibility: GateResult;
  design: GateResult;
  /** How many repair rounds ran before this result. */
  repairAttempts: number;
  issuesFound: number;
  issuesFixed: number;
};

export function emptyGate(ran = false): GateResult {
  return { ran, passed: ran, issues: [] };
}

/**
 * The gates assembled into a result.
 *
 * A gate fails on any `error`. Warnings are reported and never fail anything —
 * a QA stage that blocks a build over a soft finding is a QA stage somebody
 * turns off, and then the errors stop being seen too.
 */
export function summarise(
  gates: Record<Gate, GateResult>,
  opts: { repairAttempts?: number; issuesFixed?: number; required?: Gate[] } = {},
): QaResult {
  const all = Object.values(gates);
  const issues = all.flatMap((gate) => gate.issues);

  const failed = all.some((gate) => gate.ran && gate.issues.some((issue) => issue.severity === "error"));

  /* A required gate that never ran leaves the run incomplete. Silence from a
     check that did not happen is not evidence of anything. */
  const required = opts.required ?? [];
  const missing = required.filter((gate) => !gates[gate].ran);

  return {
    status: failed ? "failed" : missing.length > 0 ? "incomplete" : "passed",
    visual: gates.visual,
    responsive: gates.responsive,
    functional: gates.functional,
    accessibility: gates.accessibility,
    design: gates.design,
    repairAttempts: opts.repairAttempts ?? 0,
    issuesFound: issues.length,
    issuesFixed: opts.issuesFixed ?? 0,
  };
}

/** The run in one line, for a step in the build timeline. */
export function describeQa(result: QaResult): string {
  const errors = countBySeverity(result, "error");
  const warnings = countBySeverity(result, "warning");

  if (result.status === "passed") {
    return warnings === 0
      ? "nothing to fix"
      : `${warnings} ${warnings === 1 ? "warning" : "warnings"}, nothing blocking`;
  }

  if (result.status === "incomplete") {
    const skipped = GATES.filter((gate) => !result[gate].ran);
    return `${skipped.join(" and ")} could not be checked here`;
  }

  return `${errors} ${errors === 1 ? "problem" : "problems"}${
    result.repairAttempts > 0 ? ` after ${result.repairAttempts} repair ${result.repairAttempts === 1 ? "round" : "rounds"}` : ""
  }`;
}

export function countBySeverity(result: QaResult, severity: Severity): number {
  return GATES.reduce(
    (total, gate) => total + result[gate].issues.filter((issue) => issue.severity === severity).length,
    0,
  );
}

/** Every issue, worst first, for a report somebody reads top-down. */
export function allIssues(result: QaResult): Issue[] {
  return GATES.flatMap((gate) => result[gate].issues).sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1,
  );
}
