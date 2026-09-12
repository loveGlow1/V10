/* What a build is doing, as a thing with rules.
 *
 * `projects.status` held this before, and it is worth being precise about why
 * that was untenable rather than merely untidy. It is one free-text column with
 * no CHECK constraint and five writers — this app in nine places, the n8n
 * orchestrator in two, the save route, the publish route — holding six values
 * that describe three different kinds of thing: a project (Draft, Built), a run
 * (Building, Failed), and a publication (Published). Any writer could set any
 * value at any time, and nothing could say whether a transition made sense,
 * because there was nothing to compare it against.
 *
 * The failures that came out of that are all the same failure. A function
 * killed mid-flight wrote nothing, so the row stayed "Building" and the
 * workspace polled it for twenty-five minutes. n8n's Save Page node gave up at
 * 120 seconds and wrote "Failed" while the save route was still storing the
 * page, which then wrote "Built" — so the truth depended on which of two
 * writers finished last, and the shipped mitigation was a twenty-second grace
 * period in the browser. Neither is a bug in a writer. Both are what happens
 * when state has no rules.
 *
 * So the rules live here: which states exist, which may follow which, which are
 * terminal, and which may be retried. Pure — no SDK import, no I/O — for the
 * same reason kinds.ts, stack.ts and architecture.ts are: the browser reads it
 * to label a build, the store enforces it, and tools/check-jobs.mjs compiles it
 * on its own with no database.
 *
 * ── The rule that matters most ────────────────────────────────────────────
 *
 * A terminal state is final. `ready`, `failed` and `cancelled` have no
 * outgoing transitions at all, which is what makes the Failed-then-Built race
 * impossible to reproduce rather than merely unlikely: whichever writer gets
 * there first, the second one is refused by `canTransition` instead of
 * overwriting an answer somebody has already been given.
 */

/** Every state a build can be in, in the order they normally happen. */
export const JOB_STATES = [
  "queued",
  "planning",
  "provisioning",
  "generating",
  "assembling",
  "validating",
  "repairing",
  "deploying",
  "ready",
  "failed",
  "cancelled",
  "needs_input",
] as const;

export type JobState = (typeof JOB_STATES)[number];

/** Nothing follows these. See the header. */
export const TERMINAL: readonly JobState[] = ["ready", "failed", "cancelled"];

export function isTerminal(state: JobState): boolean {
  return TERMINAL.includes(state);
}

export function isJobState(value: unknown): value is JobState {
  return typeof value === "string" && (JOB_STATES as readonly string[]).includes(value);
}

/* ── What may follow what ──────────────────────────────────────────────────
 *
 * Written out in full rather than derived from the order above, because the
 * order is not the whole truth and a rule that reads "the next one, or the one
 * after" would be wrong in both directions:
 *
 *   Stages are SKIPPED, legitimately and often. A landing page has nothing to
 *   provision and nothing to deploy, so planning goes straight to generating
 *   and validating goes straight to ready. Forcing it through provisioning
 *   would mean inventing a stage that did nothing so the sequence looked tidy.
 *
 *   `repairing` goes BACKWARDS, to validating, which is the whole point of it.
 *   A repair that could not be re-checked is a repair nobody can trust.
 *
 *   Every live state may fail or be cancelled. That is not a courtesy — a
 *   state with no way out is a build that hangs, and hanging is the thing this
 *   file exists to make impossible.
 */
const NEXT: Record<JobState, readonly JobState[]> = {
  queued: ["planning", "needs_input", "failed", "cancelled"],
  /* needs_input from planning is the three questions: which kind, which
     architecture, and replace-or-edit. Nothing has been spent at that point. */
  planning: ["provisioning", "generating", "needs_input", "failed", "cancelled"],
  /* Provisioning may fail WITHOUT failing the build — a project whose schema is
     pending is still worth previewing — so generating follows it either way.
     The reason lives in project_backends.last_error, not in the job's state. */
  provisioning: ["generating", "failed", "cancelled"],
  generating: ["assembling", "failed", "cancelled"],
  assembling: ["validating", "deploying", "ready", "failed", "cancelled"],
  validating: ["repairing", "deploying", "ready", "failed", "cancelled"],
  repairing: ["validating", "deploying", "ready", "failed", "cancelled"],
  deploying: ["ready", "failed", "cancelled"],
  /* Answering a question resumes the build. It cannot resume into a stage that
     has already run, so it goes back to planning and the answer travels with
     the request — see body.buildKind, body.stack and body.architecture. */
  needs_input: ["planning", "cancelled", "failed"],
  ready: [],
  failed: [],
  cancelled: [],
};

export function nextStates(from: JobState): readonly JobState[] {
  return NEXT[from];
}

/**
 * Whether a build may move from one state to another.
 *
 * The single question every writer has to ask, and the reason there is exactly
 * one place that answers it. A move to the state it is already in is allowed
 * and is a no-op: a worker that re-claims a job it already holds, or a webhook
 * delivered twice, must be harmless rather than an error.
 */
export function canTransition(from: JobState, to: JobState): boolean {
  if (from === to) return true;
  return NEXT[from].includes(to);
}

/** Why a move was refused, in words a log is worth reading. */
export function refusal(from: JobState, to: JobState): string {
  if (isTerminal(from)) {
    return `this build already finished as "${from}" — nothing may move it to "${to}"`;
  }
  return `a build cannot go from "${from}" to "${to}" (only ${NEXT[from].join(", ")})`;
}

/* ── Retries ───────────────────────────────────────────────────────────────
 *
 * Only where a retry can succeed for a reason other than luck, which is a
 * narrower set than it looks.
 *
 * `generating` and `deploying` are the two that call somebody else's API over
 * a network, so a second attempt is a genuinely different attempt. `provisioning`
 * opens a database connection and is the same.
 *
 * `assembling` and `validating` are NOT retryable, and that is deliberate. They
 * are deterministic work over a document that is already stored: if the page
 * failed the gates once it will fail them identically, and repeating it spends
 * a minute to reach the same answer. What that case needs is `repairing`, which
 * changes the input rather than repeating the run.
 */
const RETRYABLE: readonly JobState[] = ["provisioning", "generating", "deploying"];

/* Three, and the third is the last. Past that a job is not unlucky, it is
   broken, and the useful thing to do with it is stop and say so — see the note
   in n8n/README.md about a ten-minute timeout retried three times being half an
   hour of an execution nobody is waiting on. */
export const MAX_ATTEMPTS = 3;

export function canRetry(state: JobState, attempts: number): boolean {
  return RETRYABLE.includes(state) && attempts < MAX_ATTEMPTS;
}

/* ── What a person is told ─────────────────────────────────────────────────
 *
 * Present tense for the live states, because it is read while it is happening,
 * and written as the work rather than as the wait: "Creating the database"
 * names a thing being done, and "Step 3 of 8" names a progress bar.
 */
export const JOB_LABEL: Record<JobState, string> = {
  queued: "Queued",
  planning: "Working out what to build",
  provisioning: "Creating the database",
  generating: "Writing the code",
  assembling: "Putting it together",
  validating: "Checking it",
  repairing: "Fixing what the check found",
  deploying: "Putting it online",
  ready: "Ready",
  failed: "Didn't finish",
  cancelled: "Stopped",
  needs_input: "Waiting on you",
};

/* Roughly how far along each state is, for a progress indicator.
 *
 * Approximate on purpose and documented as such. The stages take wildly
 * different amounts of time — planning is seconds and generating is minutes —
 * so these are not evenly spaced, and they are not a prediction. A number that
 * claims to know how long is a number that is wrong in front of somebody who
 * is waiting. What this is for is the difference between a bar that has not
 * moved in two minutes and one that has.
 */
export const JOB_PROGRESS: Record<JobState, number> = {
  queued: 0,
  planning: 10,
  provisioning: 20,
  generating: 35,
  assembling: 70,
  validating: 82,
  repairing: 88,
  deploying: 92,
  ready: 100,
  failed: 100,
  cancelled: 100,
  needs_input: 10,
};

/**
 * What the workspace shows for a job.
 *
 * One sentence and a number, derived here rather than in the panel, so a stored
 * job and a live one read identically — the panel was writing its own version
 * of this from `projects.status`, which is how "Building" came to be the whole
 * of what a reopened tab could say.
 */
export function describeJob(job: { state: JobState; error?: string | null }): string {
  if (job.state === "failed") return job.error ?? "The build didn't finish.";
  if (job.state === "cancelled") return "You stopped this build.";
  return JOB_LABEL[job.state];
}
