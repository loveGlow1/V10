import type { SupabaseClient } from "@supabase/supabase-js";

import { PLAN_ORDER, type PlanId } from "@/app/dashboard/credits";

/* Taking payment for work that has already happened.
 *
 * There are two ways to charge, and the difference is whether the thing being
 * paid for has run yet.
 *
 * `spend_credits` refuses when the pool cannot cover the price. That is right
 * for a publish: nothing has been provisioned, so a refusal costs nobody
 * anything. It is wrong for a build, and being wrong there was the bug — an
 * account at 0.50 asked for edits priced at 0.75 and 1.25, spend_credits raised
 * "insufficient credits" every time, the route logged it and returned the edit
 * anyway, and the balance sat at 0.50 for as long as anyone cared to keep
 * going. The gate reads that same balance, so a frozen number is a gate that
 * never closes.
 *
 * `charge_credits` never refuses. It takes what is there, records what it took,
 * and reports the shortfall — so an account that overdraws lands at exactly
 * zero and the next request is turned away. One action of credit, once, rather
 * than an open tab.
 *
 * It needs the service key, because it is told whose account to charge rather
 * than reading it from a session. Ownership is settled by the caller before it
 * gets here. */

export type ChargeOutcome = {
  /** What was actually taken. */
  charged: number;
  /** What the work was priced at but could not be covered. Zero when it was. */
  shortfall: number;
  /** What the account holds afterwards. */
  remaining: number;
};

export type ChargeInput = {
  userId: string;
  action: "chat" | "generate" | "publish";
  cost: number;
  description: string;
  projectId?: string | null;
  outputTokens?: number | null;
  filesTouched?: number | null;
  /* Names this charge, so the same request arriving twice costs once.
   *
   * A request can reach the server more than once — a double tap, a browser
   * retrying after a dropped connection, a platform replaying one it believes
   * failed. The message such a request writes has always been protected (it
   * carries the same id as project_messages.dedupe_key); the charge was not, so
   * two arrivals of one build took the credits twice for work delivered once.
   *
   * Pass the request id that already exists rather than inventing one here: a
   * key generated at the moment of charging is unique per attempt, which is
   * precisely the property that makes it useless. */
  dedupeKey?: string | null;
};

/**
 * Charges an account for work already delivered.
 *
 * Returns null only when the charge itself failed — a database error, not an
 * empty account, which is reported as a shortfall instead. A null is worth
 * logging: it means work was given away and nothing recorded it.
 */
export async function chargeCredits(
  service: SupabaseClient,
  input: ChargeInput,
): Promise<ChargeOutcome | null> {
  const { data, error } = await service.rpc("charge_credits", {
    p_user_id: input.userId,
    p_action: input.action,
    p_cost: input.cost,
    p_description: input.description.slice(0, 200),
    p_project_id: input.projectId ?? null,
    p_output_tokens: input.outputTokens ?? null,
    p_files_touched: input.filesTouched ?? null,
    p_dedupe_key: input.dedupeKey ?? null,
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("credits: the work was delivered but could not be charged:", error);
    return null;
  }

  /* A `returns table` function comes back as an array of one row. */
  const row = (Array.isArray(data) ? data[0] : data) as
    | { charged?: unknown; shortfall?: unknown; remaining?: unknown }
    | null
    | undefined;

  if (!row) return null;

  return {
    charged: Number(row.charged ?? 0),
    shortfall: Number(row.shortfall ?? 0),
    remaining: Number(row.remaining ?? 0),
  };
}

/**
 * What the account holds, as the four buckets the pricing code expects.
 *
 * Read through the service key and through `ensure_credit_balance`, so a person
 * who has never been charged is not read as having nothing: their row is
 * created on the spot with the free plan's allowance, and today's refill lands
 * before the number is used to refuse them.
 */
export async function currentBalance(
  service: SupabaseClient,
  userId: string,
): Promise<{
  daily: number;
  rollover: number;
  monthly: number;
  topUp: number;
  /* Which plan the account is on. Carried alongside the buckets because the
     row already holds it and the caller that needs a balance is usually the
     caller that needs to know what the account is entitled to. */
  planId: PlanId;
} | null> {
  const { data, error } = await service.rpc("ensure_credit_balance", { p_user_id: userId });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("credits: could not read the balance:", error);
    return null;
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { daily?: unknown; rollover?: unknown; monthly?: unknown; top_up?: unknown; plan_id?: unknown }
    | null
    | undefined;

  if (!row) return null;

  /* Anything unrecognised reads as free — the safe direction, since the plan is
     what unlocks the expensive models. */
  const planId = PLAN_ORDER.find((id) => id === row.plan_id) ?? "free";

  return {
    daily: Number(row.daily ?? 0),
    rollover: Number(row.rollover ?? 0),
    monthly: Number(row.monthly ?? 0),
    topUp: Number(row.top_up ?? 0),
    planId,
  };
}
