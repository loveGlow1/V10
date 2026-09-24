/* An edit as a thing that survives, rather than as something a socket is doing.
 *
 * ── The failure this ends ─────────────────────────────────────────────────
 *
 * An edit ran inside the HTTP request that asked for it. The platform kills
 * that request at sixty seconds, so a change that took sixty-one produced a
 * dead connection, a page untouched, a credit spent and — worst of all — an
 * instruction to the customer to break their own request into smaller pieces
 * because the backend could not hold one. A person asked four times in nine
 * minutes for a mobile layout fix and was told each time to try again.
 *
 * Nothing about that is the customer's request being too large. It is an
 * edit's lifetime being tied to a connection, and a connection being the one
 * part of the system with a hard ceiling nobody chose.
 *
 * ── What this is built on, rather than beside ─────────────────────────────
 *
 * A build has been a durable job since build_jobs existed: a row with a state
 * machine (lib/jobs/state.ts), one live job per project enforced by a unique
 * index, idempotency on the request id, a lease, an attempt count, and steps
 * persisted beside it in build_steps. Every one of those is exactly what an
 * edit needs and none of it was reaching the edit path.
 *
 * So this is a thin door onto that machinery rather than a second one. The
 * important consequences fall out of the existing table:
 *
 *   IDEMPOTENT      startJob returns the existing row for the same request id,
 *                   so Safari re-sending a request that looked frozen does not
 *                   start a second edit on the same page.
 *
 *   LOCKED          the unique index allows one live job per project. A second
 *                   edit arriving mid-edit is handed the one already running
 *                   rather than racing it into the same file.
 *
 *   RESUMABLE       the row outlives the request. A refresh, a backgrounded
 *                   tab, a killed function: the edit is still there to be
 *                   asked about, and the customer is told what is happening
 *                   rather than that nothing happened.
 *
 *   ROLLED BACK     a checkpoint is written before anything is changed, so a
 *                   half-finished edit has somewhere to return to.
 *
 * ── What this deliberately does NOT claim ─────────────────────────────────
 *
 * It does not claim work continues with nobody watching. This platform has no
 * worker: its plan caps functions at sixty seconds and allows one cron a day.
 * An edit interrupted mid-flight is therefore PRESERVED and RESUMABLE, not
 * secretly progressing — and saying the second when only the first is true
 * would be the same dishonesty in a nicer voice.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { digest } from "@/lib/context/state";
import { readContext, recordCheckpoint } from "@/lib/context/store";
import { advance, liveJob, readJob, readSteps, recordStep, startJob, type BuildJob } from "@/lib/jobs/store";
import type { JobState } from "@/lib/jobs/state";

/** The stages an edit moves through, in the order they happen. */
export const EDIT_STEPS = [
  "open",
  "intent",
  "page",
  "attachments",
  "file",
  "plan",
  "edit",
  "check",
  /* The two that only happen when the check found the change missing from the
     page — see verify-edit.ts. Named here because a stage an edit really moves
     through belongs in the list somebody reads to know what an edit does, and
     because `repair` is the one stage during which a second model call is
     running and the panel would otherwise sit on "validating". */
  "repair",
  "verify",
  "version",
  "deploy",
  "charge",
] as const;

export type EditStep = (typeof EDIT_STEPS)[number];

/* ── An edit's path through the build states ───────────────────────────────
 *
 * The state machine in lib/jobs/state.ts was written for a build, and an edit
 * is a build of one page: it plans, it writes, it checks, it deploys. Reusing
 * those states rather than inventing edit-only ones means the workspace panel,
 * the poll endpoint and JOB_LABEL all describe an edit without being taught
 * anything new.
 *
 * Every consecutive pair here is a transition NEXT already allows, which is
 * what lets `moveEditTo` walk the chain one hop at a time instead of asking
 * for a jump the machine would refuse. That refusal is not hypothetical: a
 * direct planning → ready is exactly the move `canTransition` declines, and an
 * edit that finished would have sat in `planning` forever. */
const EDIT_FLOW: readonly JobState[] = [
  "queued",
  "planning",
  "generating",
  "assembling",
  "validating",
  "deploying",
  "ready",
];

/* Which stage each step belongs to. Several steps share one: reading the
   request, finding the page and planning the change are all planning, and
   saying so three times is more honest than inventing three states. */
const STEP_STAGE: Partial<Record<string, JobState>> = {
  open: "planning",
  intent: "planning",
  page: "planning",
  attachments: "planning",
  file: "planning",
  plan: "planning",
  edit: "generating",
  check: "validating",
  /* `repairing` goes backwards to validating, which is exactly this shape: the
     check found something, a repair runs, the check runs again. See
     lib/jobs/state.ts, where that transition is deliberate. */
  repair: "repairing",
  verify: "validating",
  version: "validating",
  deploy: "deploying",
  charge: "deploying",
};

/* How long a live edit task may sit untouched before the next request treats
   it as abandoned.
 *
 * There is no worker on this plan, so an edit interrupted by the function
 * ceiling has nobody to finish it. Without this, that row stays live forever
 * and the unique index — the thing that stops two edits racing — becomes a
 * lock nobody can open, wedging the project permanently.
 *
 * Five minutes because a function cannot run for more than one: anything older
 * than that is not slow, it is gone. */
const ABANDONED_MS = 5 * 60 * 1000;

export type OpenedEdit =
  | { ok: true; job: BuildJob; resumed: boolean }
  /* Another edit holds this project. Not an error: the caller shows what is
     running rather than starting a second one into the same files. */
  | { ok: false; why: "busy"; job: BuildJob }
  /* No service key, or the row could not be written. The edit still runs — it
     simply runs without the durability, exactly as it did before this existed,
     which is the right fallback for bookkeeping that failed. */
  | { ok: false; why: "unavailable" };

function abandoned(job: BuildJob): boolean {
  const started = Date.parse(job.createdAt);
  if (Number.isNaN(started)) return false;
  return Date.now() - started > ABANDONED_MS;
}

/**
 * Opens — or rejoins — the durable task for this edit.
 *
 * `requestId` is the idempotency key. The same one twice returns the same task,
 * which is what makes a double-tap on a slow connection harmless.
 */
export async function openEditTask(
  service: SupabaseClient | null,
  input: { projectId: string; userId: string; requestId: string; request: string },
): Promise<OpenedEdit> {
  if (!service) return { ok: false, why: "unavailable" };

  /* Clear an abandoned task out of the way first, so the unique index guards
     against a concurrent edit and not against an edit that died last Tuesday. */
  const standing = await liveJob(service, input.projectId);
  if (standing && standing.requestId !== input.requestId && abandoned(standing)) {
    await advance(service, standing.id, {
      to: "cancelled",
      detail: { abandoned: true },
    });
  }

  const job = await startJob(service, {
    projectId: input.projectId,
    userId: input.userId,
    requestId: input.requestId,
    detail: {
      kind: "edit",
      /* The request itself, so a task can be described without the
         conversation it came from — a resumed session reads this row, not the
         thread. Bounded: a task row is not a place to keep an essay. */
      request: input.request.slice(0, 2000),
    },
  });

  if (!job) return { ok: false, why: "unavailable" };

  /* Somebody else's edit, still running. The unique index means there can only
     be one, so this is the one — and handing it back is more useful than
     refusing, because what the caller wants to know is what is happening to
     this project. */
  if (job.requestId && job.requestId !== input.requestId) {
    return { ok: false, why: "busy", job };
  }

  /* Rejoining rather than starting: the same request id already has a row past
     `queued`, which means this request is a retry of one that got somewhere. */
  const resumed = job.state !== "queued";

  if (!resumed) {
    await advance(service, job.id, { to: "planning", detail: { kind: "edit" } });
  }

  return { ok: true, job, resumed };
}

/**
 * The state to return to if this edit cannot be finished.
 *
 * Written BEFORE anything is changed, which is the only moment it is worth
 * anything. Best effort and never fatal: a checkpoint that fails to write means
 * one fewer place to continue from, and refusing the edit over it would be
 * choosing the worse of the two outcomes.
 */
export async function checkpointBeforeEdit(
  service: SupabaseClient | null,
  input: { projectId: string; userId: string; request: string },
): Promise<void> {
  if (!service) return;

  try {
    const context = await readContext(service, input.projectId);
    await recordCheckpoint(service, {
      projectId: input.projectId,
      userId: input.userId,
      version: context?.version ?? 1,
      /* Named for what it is the state BEFORE, so a list of checkpoints reads
         as a history of decisions rather than a list of timestamps. */
      label: `Before: ${input.request.slice(0, 80)}`,
      state: context?.state ?? {},
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("edit task: the checkpoint could not be written:", error);
  }
}

/**
 * Walks the job forward to a stage, one legal hop at a time.
 *
 * Never backwards: a step that belongs to an earlier stage than the one the
 * job has already reached leaves the state alone. `check` reporting after
 * `deploy` began must not drag the job back to validating — the timeline in
 * build_steps is where out-of-order detail belongs, not the state.
 */
async function moveEditTo(
  service: SupabaseClient,
  job: BuildJob,
  target: JobState,
): Promise<BuildJob> {
  /* Re-read rather than trusting the snapshot the caller is holding.
   *
     A BuildJob handed out at the top of a request is a photograph of a row
     that has since moved: openEditTask returns the job as it was BEFORE it
     advanced to planning, and every step since has moved it again. Walking
     from a stale state is how an edit that had reached `deploying` asks for a
     move the machine refuses and then sits in `planning` forever, with the
     workspace polling a change that finished minutes ago. */
  let current = (await readJob(service, job.id)) ?? job;

  const from = EDIT_FLOW.indexOf(current.state);
  const to = EDIT_FLOW.indexOf(target);
  /* -1 on `from` is a terminal state or one outside an edit's path; `to <= from`
     is a step reporting out of order. Both leave the state where it is. */
  if (from < 0 || to <= from) return current;

  for (let at = from + 1; at <= to; at += 1) {
    const moved = await advance(service, current.id, { to: EDIT_FLOW[at] });
    /* A refused hop means somebody else moved this job — very likely to a
       terminal state. Stopping is right: continuing would be this request
       insisting on a story the row has already left behind. */
    if (!moved) return current;
    current = moved;
  }
  return current;
}

/** One stage of the edit, written down as it happens. */
export async function noteEditStep(
  service: SupabaseClient | null,
  job: BuildJob | null,
  /* `id` is a plain string rather than an EditStep because the route records
     steps this file does not name — `history`, `clarify`, `answer` — and a
     timeline missing the step somebody is actually looking at is worse than a
     type that admits an unexpected one. Only the ids in STEP_STAGE move the
     state; the rest are recorded and nothing else. */
  step: {
    id: string;
    label: string;
    state: "pending" | "running" | "done" | "failed";
    detail?: string;
  },
): Promise<void> {
  if (!service || !job) return;
  try {
    await recordStep(service, {
      jobId: job.id,
      projectId: job.projectId,
      userId: job.userId,
      step: step.id,
      label: step.label,
      state: step.state,
      detail: step.detail,
    });

    /* The state follows the steps rather than being driven separately, so the
       two cannot disagree — a job reading "generating" while its last step was
       the deploy is the kind of drift projects.status used to produce. */
    const stage = STEP_STAGE[step.id];
    if (stage && step.state !== "failed") await moveEditTo(service, job, stage);
  } catch {
    /* A step nobody could write is a line missing from a progress list, which
       is not worth failing an edit over. */
  }
}

/** The edit landed. */
export async function finishEditTask(
  service: SupabaseClient | null,
  job: BuildJob | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!service || !job) return;

  /* Walked rather than jumped: an edit that skipped the deploy — a draft saved
     without publishing — is still in `planning` or `generating`, and asking for
     `ready` from there is a move the machine refuses outright. */
  const current = await moveEditTo(service, job, "deploying");
  await advance(service, current.id, { to: "ready", detail });
}

/**
 * The edit did not land, and why decides what happens to the task.
 *
 * A REFUSAL is terminal: a gate read the request and declined it, and the same
 * request will be declined again. The task fails, which is honest.
 *
 * An INTERRUPTION is not. The request ran out of the time the platform allows
 * and the work was never finished — so the task is left live, its steps intact,
 * for the next request on this project to rejoin. Nothing is progressing in the
 * background and this does not pretend otherwise; what it does is stop a
 * ceiling nobody chose from reading as a refusal of something the customer
 * asked for.
 */
export async function haltEditTask(
  service: SupabaseClient | null,
  job: BuildJob | null,
  outcome: { interrupted: boolean; reason: string },
): Promise<void> {
  if (!service || !job) return;

  if (outcome.interrupted) {
    await noteEditStep(service, job, {
      id: "edit",
      label: "Interrupted",
      state: "failed",
      detail: outcome.reason,
    });
    return;
  }

  await advance(service, job.id, { to: "failed", error: outcome.reason });
}

/** An edit left live on this project, with everything it had got through. */
export async function resumableEdit(
  service: SupabaseClient | null,
  projectId: string,
): Promise<{ job: BuildJob; steps: Awaited<ReturnType<typeof readSteps>> } | null> {
  if (!service) return null;

  const job = await liveJob(service, projectId);
  if (!job || job.detail?.kind !== "edit") return null;

  return { job, steps: await readSteps(service, job.id) };
}

/**
 * The idempotency key for an edit, derived from what was asked rather than
 * handed down from the browser.
 *
 * This is what makes "send it again" a resume instead of a restart, and it has
 * to be derived here because the browser has no stable id to give: a retry is
 * a person pressing send a second time, which is a new fetch with a new
 * everything. The same words on the same project inside one interrupted edit's
 * lifetime are the same request, and startJob hands back the row that already
 * exists.
 *
 * It does NOT wedge a project afterwards: a finished job is terminal, so it is
 * not live, so asking for the identical change next week starts a fresh task.
 */
export function editTaskId(projectId: string, request: string): string {
  return `edit:${projectId}:${digest(request)}`;
}

/* ── The handle ────────────────────────────────────────────────────────────
 *
 * An edit's outcome is known in the streaming wrapper, after `handle` has
 * returned its response, and the task is opened deep inside `handle` — so one
 * of them has to be given to the other. This is the smaller of the two: an
 * object the route fills in and the wrapper settles, which leaves the twenty
 * `return NextResponse.json(...)` branches in the edit path exactly as they
 * are. A settle bolted onto each of those would be twenty chances to forget
 * one, and the one forgotten is a task left live on a project that is fine. */
export type EditTaskHandle = {
  service?: SupabaseClient | null;
  job?: BuildJob | null;
};

/**
 * Closes the task out against what the request actually answered.
 *
 * A function KILLED at the ceiling never reaches this, and that is the design
 * rather than a gap in it: the row stays live with its steps, which is what
 * makes the next request on this project a continuation. Everything that
 * answers at all — including a refusal — settles here.
 */
export async function settleEditTask(
  handle: EditTaskHandle,
  outcome: { status: number; error?: string | null },
): Promise<void> {
  const { service, job } = handle;
  if (!service || !job) return;

  if (outcome.status < 400) {
    await finishEditTask(service, job, { status: outcome.status });
    return;
  }

  await haltEditTask(service, job, {
    interrupted: false,
    reason: outcome.error ?? `The edit was refused (${outcome.status}).`,
  });
}
