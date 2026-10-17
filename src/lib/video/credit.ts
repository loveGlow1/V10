/* The MiniMax usage credit on n8n — and what happens the moment it runs out.
 *
 * The credit tier sends every clip and voice line to n8n first. When the
 * workflow reports that the credit behind it is spent, waiting for each job
 * to fail on its own would cost a render minutes and leave every other video
 * queueing onto an empty account. So the first report that says so:
 *
 *   1. pauses n8n for the whole deployment (video_engine_state), so every
 *      render from then on goes straight to the main API — MiniMax's own
 *      API with MINIMAX_API_KEY, then the rest of the chain;
 *   2. hands THIS render's other n8n jobs on at once — clips to the next
 *      engine in their chain, voice lines to MiniMax speech — rather than
 *      waiting for each of them to fail;
 *   3. lets n8n be tried again after N8N_CREDIT_PAUSE_HOURS (default 24), in
 *      case the credit was topped up or has reset.
 *
 * A rate limit is not an empty account and does not pause anything.
 *
 * Server-only apart from the pure classifier at the top. */

import type { SupabaseClient } from "@supabase/supabase-js";

export const N8N_ENGINE = "n8n";

const RATE_LIMIT = /rate.?limit|too many requests|\b429\b|\b1002\b|\b1039\b|try again later/i;
const EXHAUSTED =
  /insufficient[_ ]?(balance|credit|quota|funds)|out of (credit|quota)|not enough (credit|balance)|(credit|credits|quota|balance)s?\b[^.]{0,30}\b(exhausted|used up|depleted|run out|ran out|exceeded|insufficient|reached)|quota (exceeded|exhausted)|usage limit|limit (reached|exceeded)|\b1008\b|payment required|\b402\b|arrear|top.?up/i;

/** Whether an engine's error says the account behind it has no credit left. Pure. */
export function isCreditExhausted(error: string | null | undefined): boolean {
  const text = (error ?? "").slice(0, 1000);
  if (!text || RATE_LIMIT.test(text)) return false;
  return EXHAUSTED.test(text);
}

export function pauseHours(env: Record<string, string | undefined> = process.env): number {
  const hours = Number(env.N8N_CREDIT_PAUSE_HOURS);
  return Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24 * 31) : 24;
}

/** When n8n may be used again, or null when it is not paused. Never throws. */
export async function n8nPausedUntil(service: SupabaseClient | null): Promise<Date | null> {
  if (!service) return null;
  try {
    const { data } = await service.from("video_engine_state").select("paused_until").eq("engine", N8N_ENGINE).maybeSingle<{ paused_until: string | null }>();
    const until = data?.paused_until ? new Date(data.paused_until) : null;
    return until && until.getTime() > Date.now() ? until : null;
  } catch {
    return null;
  }
}

/** Pauses n8n for everybody until the credit can be tried again. Never throws. */
export async function pauseN8n(service: SupabaseClient, reason: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  const until = new Date(Date.now() + pauseHours(env) * 3_600_000).toISOString();
  try {
    await service
      .from("video_engine_state")
      .upsert({ engine: N8N_ENGINE, paused_until: until, reason: reason.slice(0, 500), updated_at: new Date().toISOString() }, { onConflict: "engine" });
  } catch {
    /* The render still falls back job by job. */
  }
}
