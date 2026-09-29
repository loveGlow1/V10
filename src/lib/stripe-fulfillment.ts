import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { isPaidPlanId } from "@/lib/crypto-payments";

/* A paid Stripe Checkout Session becoming what it was bought for.
 *
 * Two callers, and they must not drift apart: the webhook, which Stripe calls
 * the moment a session is paid, and the reconciliation sweep, which lists
 * recent paid sessions as a safety net for a webhook that failed, was
 * misconfigured, or never arrived. Both go through settleCheckoutSession, and
 * settle_stripe_checkout is idempotent on the session id — so the two can both
 * see the same session and it still pays out once.
 */

/** What a session grants, read from what the checkout route wrote on it. */
export type SessionGrant = {
  userId: string;
  planId: string | null;
  credits: number | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Who and what come from the session itself — client_reference_id and
 * metadata — which /api/payments/stripe/checkout wrote on the server, so a
 * customer cannot change either. A session this app did not create (a Payment
 * Link, a Dashboard test) has neither, and grants nothing. */
export function readSessionGrant(session: Stripe.Checkout.Session): SessionGrant | null {
  const userId = session.client_reference_id ?? session.metadata?.user_id ?? "";
  const kind = session.metadata?.kind ?? "topup";
  const planId = kind === "plan" ? (session.metadata?.plan_id ?? null) : null;
  const credits = kind === "plan" ? null : Number(session.metadata?.credits);

  if (!UUID.test(userId)) return null;
  if (kind === "plan") return isPaidPlanId(planId) ? { userId, planId, credits: null } : null;
  return credits !== null && Number.isFinite(credits) && credits > 0
    ? { userId, planId: null, credits }
    : null;
}

/** Paid in full. "unpaid" on a completed session is a delayed method (a bank
 *  debit) that has not cleared; it settles on async_payment_succeeded. */
export function isSessionPaid(session: Stripe.Checkout.Session): boolean {
  return session.status === "complete" && session.payment_status !== "unpaid";
}

/**
 * Grants what the session was bought for. Returns "skipped" for a session with
 * nothing to grant — retrying that would never succeed — and throws on
 * anything that might succeed on a retry (a database error), so the caller can
 * retry or report it.
 */
export async function settleCheckoutSession(
  service: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<"settled" | "skipped"> {
  const grant = readSessionGrant(session);
  if (!grant) {
    // eslint-disable-next-line no-console
    console.warn("stripe: session has no user or purchase to grant:", session.id);
    return "skipped";
  }

  const { error } = await service.rpc("settle_stripe_checkout", {
    p_session_id: session.id,
    p_user_id: grant.userId,
    p_credits: grant.credits,
    p_plan_id: grant.planId,
  });
  if (error) throw error;
  return "settled";
}

/** How far back the sweep looks. Stripe itself retries a failed webhook for up
 *  to three days, so this covers everything Stripe would still try to deliver
 *  and everything it has given up on in that window. */
export const STRIPE_RECOVERY_WINDOW_DAYS = 3;

/**
 * The safety net: paid sessions from the last STRIPE_RECOVERY_WINDOW_DAYS that
 * have no ledger entry yet, settled now. Returns how many it recovered and any
 * that failed. A no-op without STRIPE_SECRET_KEY.
 */
export async function recoverMissedCheckouts(
  service: SupabaseClient,
  stripe: Stripe,
  now: number,
): Promise<{ recovered: string[]; failures: { id: string; why: string }[] }> {
  const recovered: string[] = [];
  const failures: { id: string; why: string }[] = [];

  const since = Math.floor(now / 1000) - STRIPE_RECOVERY_WINDOW_DAYS * 24 * 60 * 60;
  const paid: Stripe.Checkout.Session[] = [];
  for await (const session of stripe.checkout.sessions.list({
    status: "complete",
    created: { gte: since },
    limit: 100,
  })) {
    if (isSessionPaid(session) && readSessionGrant(session)) paid.push(session);
  }
  if (paid.length === 0) return { recovered, failures };

  /* Already settled ones have a ledger row named after the session. Read once,
     so a quiet sweep costs one query rather than one call per session. */
  const keys = paid.map((session) => `stripe:${session.id}`);
  const { data, error } = await service
    .from("credit_ledger")
    .select("dedupe_key")
    .in("dedupe_key", keys);
  if (error) {
    failures.push({ id: "(stripe ledger)", why: error.message });
    return { recovered, failures };
  }
  const done = new Set((data ?? []).map((row) => (row as { dedupe_key: string }).dedupe_key));

  for (const session of paid) {
    if (done.has(`stripe:${session.id}`)) continue;
    try {
      if ((await settleCheckoutSession(service, session)) === "settled") {
        recovered.push(session.id);
      }
    } catch (err) {
      failures.push({ id: session.id, why: err instanceof Error ? err.message : String(err) });
    }
  }

  return { recovered, failures };
}
