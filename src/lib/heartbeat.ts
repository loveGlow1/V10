import type { SupabaseClient } from "@supabase/supabase-js";

/* When a background job last actually ran.
 *
 * This exists because of two failures in a row that were invisible for the same
 * reason. The reconciliation sweep is what watches for payments when nothing
 * else is, and nothing was watching IT: first its database writes were being
 * lost, then the route was missing from a deployment entirely. Both times the
 * sweep was doing nothing, both times the system looked fine, and both times
 * the only way anyone found out was a person querying the database by hand.
 *
 * The core problem is that a job with nothing to do and a job that has stopped
 * running produce the same silence. So the job says so, and /api/health reports
 * how long ago that was — which turns "is settlement still working" from an
 * investigation into a number somebody can look at.
 *
 * Never throws and never fails a caller. A heartbeat that could break the sweep
 * would be worse than no heartbeat: the job matters, the record of it does not.
 */

export const RECONCILE_SERVICE = "reconcile";

/** How long since a sweep before something is wrong. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/* How long a gap between sweeps means a scheduler has stopped.
 *
 * Two clocks call the sweep — pg_cron every fifteen minutes and n8n every
 * thirty — so a gap much past thirty says one of them is not firing. Forty-five
 * allows for a late run without crying wolf, and still catches a dead clock
 * within one cycle rather than at the two-hour cliff where checkout closes.
 *
 * A stopped scheduler cannot report itself. This is the surviving one noticing
 * on its behalf, which works for exactly as long as any clock still runs — and
 * that is the case worth covering, because redundancy is what makes a dead
 * clock produce no symptom at all. */
const CLOCK_GAP_MS = 45 * 60 * 1000;

/**
 * Records a run, and reports how long it had been since the last one.
 *
 * The gap is read BEFORE the row is overwritten, because overwriting it is what
 * destroys the evidence. Null when there was no previous run to compare with.
 */
export async function recordHeartbeat(
  service: SupabaseClient,
  name: string,
  detail: Record<string, unknown>,
): Promise<{ gapMs: number | null; clockMissing: boolean }> {
  const now = Date.now();

  const { data: previous } = await service
    .from("service_heartbeats")
    .select("ran_at")
    .eq("service", name)
    .maybeSingle();

  const lastRanAt = (previous as { ran_at: string } | null)?.ran_at;
  const gapMs = lastRanAt ? now - new Date(lastRanAt).getTime() : null;

  const { error } = await service
    .from("service_heartbeats")
    .upsert({ service: name, ran_at: new Date(now).toISOString(), detail }, { onConflict: "service" });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("heartbeat: could not record", name, error);
  }

  return { gapMs, clockMissing: gapMs !== null && gapMs > CLOCK_GAP_MS };
}

export type HeartbeatStatus = {
  /** ISO time of the last run, or null if it has never run. */
  lastRunAt: string | null;
  /** Whole minutes since, or null when it has never run. */
  minutesAgo: number | null;
  /** Too long ago, or never. The field worth alerting on. */
  stale: boolean;
  /** What the job reported about that run. */
  detail: Record<string, unknown> | null;
};

/**
 * Reads one service's heartbeat.
 *
 * A missing row and an unreadable table both come back as "never ran, stale",
 * which is the safe reading: the only thing that proves a job is alive is the
 * job having said so.
 */
export async function readHeartbeat(
  service: SupabaseClient,
  name: string,
): Promise<HeartbeatStatus> {
  const never: HeartbeatStatus = { lastRunAt: null, minutesAgo: null, stale: true, detail: null };

  const { data, error } = await service
    .from("service_heartbeats")
    .select("ran_at, detail")
    .eq("service", name)
    .maybeSingle();

  if (error || !data?.ran_at) return never;

  const ranAt = new Date(data.ran_at as string);
  const elapsed = Date.now() - ranAt.getTime();

  return {
    lastRunAt: ranAt.toISOString(),
    minutesAgo: Math.floor(elapsed / 60_000),
    stale: elapsed > STALE_AFTER_MS,
    detail: (data.detail as Record<string, unknown> | null) ?? null,
  };
}
