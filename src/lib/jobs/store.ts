/* Reading and writing a build job, with the state machine in front of it.
 *
 * Every write goes through `advance`, and `advance` asks `canTransition` first.
 * That is the whole design: there is one door, and the rules are on it. A
 * writer that could set a state directly would be a sixth writer to
 * projects.status wearing a different name.
 *
 * Service key only. A browser that could move a job's state could mark its own
 * build ready, so build_jobs has a select policy for its owner and no insert,
 * update or delete policy at all.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type JobState,
  canRetry,
  canTransition,
  isJobState,
  isTerminal,
  refusal,
} from "@/lib/jobs/state";

export type BuildJob = {
  id: string;
  projectId: string;
  userId: string;
  requestId: string | null;
  state: JobState;
  error: string | null;
  detail: Record<string, unknown>;
  attempts: number;
  lockedUntil: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type Row = {
  id: string;
  project_id: string;
  user_id: string;
  request_id: string | null;
  state: string;
  error: string | null;
  detail: Record<string, unknown> | null;
  attempts: number;
  locked_until: string | null;
  created_at: string;
  finished_at: string | null;
};

function read(row: Row): BuildJob {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    requestId: row.request_id,
    /* A state the database admits and this code does not is a deployment
       mid-rollout, not corruption — the CHECK constraint is the authority on
       what may be stored. Reading it as queued is the harmless answer: a
       worker picks it up and moves it forward. */
    state: isJobState(row.state) ? row.state : "queued",
    error: row.error,
    detail: row.detail ?? {},
    attempts: row.attempts,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

const COLUMNS =
  "id, project_id, user_id, request_id, state, error, detail, attempts, locked_until, created_at, finished_at";

/* How long a worker holds a job before anybody else may take it.
 *
 * Long enough to cover the slowest slice a worker actually runs — a Vercel
 * deployment poll — and short enough that a worker killed mid-slice releases
 * the job within a few minutes rather than parking it forever. A lease that
 * never lapses is a lock, and a lock held by a process that no longer exists
 * is the thing this arrangement exists to avoid. */
const LEASE_MS = 5 * 60 * 1000;

/**
 * The live job for a project, if it has one.
 *
 * "Live" means not terminal, which is the same condition as the unique index —
 * so this and the constraint that stops two builds at once are reading the same
 * rule rather than two copies of it.
 */
export async function liveJob(
  service: SupabaseClient,
  projectId: string,
): Promise<BuildJob | null> {
  const { data, error } = await service
    .from("build_jobs")
    .select(COLUMNS)
    .eq("project_id", projectId)
    .not("state", "in", "(ready,failed,cancelled)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Row>();

  if (error) {
    // eslint-disable-next-line no-console
    console.error("jobs: could not read the live job:", error.message);
    return null;
  }
  return data ? read(data) : null;
}

/** A job by id. */
export async function readJob(service: SupabaseClient, id: string): Promise<BuildJob | null> {
  const { data } = await service.from("build_jobs").select(COLUMNS).eq("id", id).maybeSingle<Row>();
  return data ? read(data) : null;
}

/**
 * Starts a build, or hands back the one already running.
 *
 * Idempotent on `requestId`, which is what makes it safe to call twice: the
 * same message sent from two tabs, or a retried request, finds its own job
 * rather than starting a second generation on the same project. The unique
 * index is the real guard — two callers racing both insert, one loses on the
 * constraint, and the loser reads back the winner's row instead of failing.
 */
export async function startJob(
  service: SupabaseClient,
  input: { projectId: string; userId: string; requestId?: string | null; detail?: Record<string, unknown> },
): Promise<BuildJob | null> {
  const existing = await liveJob(service, input.projectId);
  if (existing) {
    if (input.requestId && existing.requestId === input.requestId) return existing;
    /* A different build is already in flight on this project. Handing back the
       one that is running is more useful than refusing: the caller wants to
       know what is happening to this project, and that is what is happening. */
    return existing;
  }

  const { data, error } = await service
    .from("build_jobs")
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      request_id: input.requestId ?? null,
      state: "queued",
      detail: input.detail ?? {},
    })
    .select(COLUMNS)
    .single<Row>();

  if (error) {
    /* 23505 is the one-live-job-per-project index. Somebody else won the race,
       so read their row rather than reporting a failure that is really a
       success belonging to another request. */
    if (error.code === "23505") return liveJob(service, input.projectId);
    // eslint-disable-next-line no-console
    console.error("jobs: could not start a job:", error.message);
    return null;
  }
  return read(data);
}

export type Advance = {
  to: JobState;
  /** Merged into `detail` rather than replacing it — each stage adds its own. */
  detail?: Record<string, unknown>;
  /** Required in practice for `failed`: a terminal state with no reason is a dead end. */
  error?: string;
};

/**
 * Moves a job, if the rules allow it.
 *
 * Returns the job as it now stands, or null when the move was refused — and a
 * refusal is an ordinary outcome rather than an exception. The case it exists
 * for is real and shipped: n8n's Save Page node gives up at 120 seconds and
 * writes "Failed" while the save route is still storing the page, which then
 * writes "Built". Whichever arrives second used to win. Here the first one to
 * reach a terminal state is the answer, and the second is refused and logged.
 */
export async function advance(
  service: SupabaseClient,
  jobId: string,
  move: Advance,
): Promise<BuildJob | null> {
  const job = await readJob(service, jobId);
  if (!job) return null;

  if (!canTransition(job.state, move.to)) {
    // eslint-disable-next-line no-console
    console.warn(`jobs: refused ${jobId} — ${refusal(job.state, move.to)}`);
    return null;
  }

  const finishing = isTerminal(move.to) && !isTerminal(job.state);

  const { data, error } = await service
    .from("build_jobs")
    .update({
      state: move.to,
      detail: { ...job.detail, ...(move.detail ?? {}) },
      ...(move.error !== undefined ? { error: move.error } : {}),
      ...(finishing ? { finished_at: new Date().toISOString(), locked_until: null } : {}),
    })
    .eq("id", jobId)
    /* The state we read is the state we are moving FROM. Anything else and
       somebody moved it in between, and this update is about a job that no
       longer exists in that form — so it matches nothing and returns null,
       which is the same answer as a refused transition and wants the same
       handling. */
    .eq("state", job.state)
    .select(COLUMNS)
    .maybeSingle<Row>();

  if (error) {
    // eslint-disable-next-line no-console
    console.error("jobs: could not advance:", error.message);
    return null;
  }
  return data ? read(data) : null;
}

/** Fails a job with a reason somebody can read. Safe to call on a finished one. */
export async function failJob(
  service: SupabaseClient,
  jobId: string,
  reason: string,
): Promise<BuildJob | null> {
  return advance(service, jobId, { to: "failed", error: reason });
}

/**
 * Takes a job for a few minutes, so two workers do not run the same stage.
 *
 * A lease rather than a lock: it lapses on its own, so a worker that is killed
 * — which on a serverless platform is the ordinary way a worker ends — releases
 * what it held by doing nothing at all. The `lte` on locked_until is what makes
 * the claim atomic; two workers both issue this update and only one matches.
 */
export async function claimJob(
  service: SupabaseClient,
  jobId: string,
): Promise<BuildJob | null> {
  const now = new Date();
  const until = new Date(now.getTime() + LEASE_MS).toISOString();

  const { data } = await service
    .from("build_jobs")
    .update({ locked_until: until, attempts: undefined })
    .eq("id", jobId)
    .or(`locked_until.is.null,locked_until.lte.${now.toISOString()}`)
    .not("state", "in", "(ready,failed,cancelled,needs_input)")
    .select(COLUMNS)
    .maybeSingle<Row>();

  return data ? read(data) : null;
}

/**
 * The jobs a worker should look at: due, unheld, and not waiting on a person.
 *
 * Ordered oldest first, so a job cannot be starved by newer ones arriving.
 */
export async function claimable(
  service: SupabaseClient,
  limit = 5,
): Promise<BuildJob[]> {
  const now = new Date().toISOString();
  const { data } = await service
    .from("build_jobs")
    .select(COLUMNS)
    .not("state", "in", "(ready,failed,cancelled,needs_input)")
    .or(`locked_until.is.null,locked_until.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(limit);

  return ((data ?? []) as Row[]).map(read);
}

/** Records an attempt, and says whether another one is worth making. */
export async function noteAttempt(
  service: SupabaseClient,
  job: BuildJob,
): Promise<{ attempts: number; again: boolean }> {
  const attempts = job.attempts + 1;
  await service.from("build_jobs").update({ attempts }).eq("id", job.id);
  return { attempts, again: canRetry(job.state, attempts) };
}

/* ── The timeline ──────────────────────────────────────────────────────────
 *
 * stepRecorder already produces exactly this shape and streams it; this is the
 * copy that survives the tab. Upserted on (job_id, step) so a step that begins
 * and then finishes is one row ticking over rather than two rows — which is the
 * same merge-by-id the panel already does with the streamed version.
 *
 * Best effort throughout, and never awaited by anything that matters: a build
 * must not fail because its own progress note did not write.
 */
export async function recordStep(
  service: SupabaseClient,
  input: {
    jobId: string;
    projectId: string;
    userId: string;
    step: string;
    label: string;
    detail?: string;
    state?: "pending" | "running" | "done" | "failed";
    ms?: number;
  },
): Promise<void> {
  const { error } = await service.from("build_steps").upsert(
    {
      job_id: input.jobId,
      project_id: input.projectId,
      user_id: input.userId,
      step: input.step,
      label: input.label,
      detail: input.detail ?? null,
      state: input.state ?? "running",
      ms: input.ms ?? null,
    },
    { onConflict: "job_id,step" },
  );

  if (error) {
    // eslint-disable-next-line no-console
    console.error("jobs: a step was not recorded:", error.message);
  }
}

/** The timeline of a job, oldest first, for a workspace that was reopened. */
export async function readSteps(
  service: SupabaseClient,
  jobId: string,
): Promise<{ id: string; label: string; detail?: string; ms?: number; state: string }[]> {
  const { data } = await service
    .from("build_steps")
    .select("step, label, detail, state, ms")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });

  return ((data ?? []) as { step: string; label: string; detail: string | null; state: string; ms: number | null }[]).map(
    (row) => ({
      id: row.step,
      label: row.label,
      detail: row.detail ?? undefined,
      ms: row.ms ?? undefined,
      state: row.state,
    }),
  );
}
