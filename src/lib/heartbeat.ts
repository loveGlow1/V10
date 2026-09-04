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

export async function recordHeartbeat(
  service: SupabaseClient,
  name: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await service
    .from("service_heartbeats")
    .upsert({ service: name, ran_at: new Date().toISOString(), detail }, { onConflict: "service" });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("heartbeat: could not record", name, error);
  }
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
