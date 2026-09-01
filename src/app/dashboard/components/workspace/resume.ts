/* Whether there is a build here worth picking back up.
 *
 * A build takes minutes and people close tabs. The projects row is the only
 * thing that spans one visit and the next: it says "Building" from the moment
 * the orchestrator is called until its page lands. So a workspace opened onto
 * one of those can wait for exactly the thing the session that started it was
 * waiting for — which is the difference between a conversation that carries on
 * and one that stops mid-sentence at "your build is underway" forever.
 *
 * The rule is separate from the panel because it is a rule, and because the
 * cases it has to get right are the ones that never happen while you are
 * looking: a row left "Building" by something that died last week, a session
 * that has already done its own waiting, a thread that has not loaded yet.
 */

/* How recent a build has to be before a reopened workspace will wait on it.
   Long enough to cover a generation that is genuinely still running; short
   enough that a stale row does not put a spinner in front of someone for eight
   minutes over a build that stopped existing days ago. */
export const RESUME_WINDOW_MS = 30 * 60 * 1000;

export type ResumeCheck = {
  /** The project row's status, or null when there is no project yet. */
  status?: string | null;
  /** When the row was last written — the "Building" update stamps it. */
  updatedAt?: string | null;
  /** Nothing may be decided before the stored thread has arrived. */
  threadLoaded: boolean;
  /** A wait already in flight. */
  building: boolean;
  /** Whether this session ran a build of its own, and so has already waited. */
  sentHere: boolean;
  now?: number;
};

/**
 * The moment the build being picked up started, or null for "leave it alone".
 *
 * A number rather than a boolean because the caller needs it either way: it is
 * what the tracker's clock counts from.
 */
export function resumableFrom(check: ResumeCheck): number | null {
  if (!check.threadLoaded || check.building || check.sentHere) return null;
  if (check.status !== "Building") return null;

  const startedAt = check.updatedAt ? Date.parse(check.updatedAt) : NaN;
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null;

  const now = check.now ?? Date.now();
  /* A row stamped in the future is a clock disagreeing, not a build from
     tomorrow. Waiting on it is harmless; pretending it started when it says it
     did would give the tracker a negative clock. */
  const age = now - startedAt;
  if (age > RESUME_WINDOW_MS) return null;

  return age < 0 ? now : startedAt;
}
