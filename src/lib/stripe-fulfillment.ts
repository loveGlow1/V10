import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { isPaidPlanId } from "@/lib/crypto-payments";
import { recordPayment } from "@/lib/money";
import { rememberCard } from "@/lib/stripe-card";

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
  /** Months of plan bought: 1 or 12. 0 for a top-up. */
  months: 0 | 1 | 12;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Who and what come from the session itself — client_reference_id and
 * metadata — which /api/payments/stripe/checkout wrote on the server, so a
 * customer cannot change either. A session this app did not create (a Payment
 * Link, a Dashboard test) has neither, and grants nothing. */
export function readSessionGrant(session: Stripe.Checkout.Session): SessionGrant | null {
  /* Saving a card (setup mode) buys nothing — see stripe-card.ts. A plan
     (subscription mode) is settled invoice by invoice — see
     settlePaidInvoice — so its session grants nothing itself, or the first
     month would be granted twice. */
  if (session.mode === "setup" || session.mode === "subscription") return null;
  const userId = session.client_reference_id ?? session.metadata?.user_id ?? "";
  const kind = session.metadata?.kind ?? "topup";
  const planId = kind === "plan" ? (session.metadata?.plan_id ?? null) : null;
  const credits = kind === "plan" ? null : Number(session.metadata?.credits);

  if (!UUID.test(userId)) return null;
  if (kind === "plan") {
    if (!isPaidPlanId(planId)) return null;
    /* Absent on sessions created before annual plans existed: those were all
       one month. Anything other than 1 or 12 is refused, not guessed. */
    const rawMonths = session.metadata?.months;
    const months = rawMonths === undefined || rawMonths === "" ? 1 : Number(rawMonths);
    if (months !== 1 && months !== 12) return null;
    return { userId, planId, credits: null, months };
  }
  return credits !== null && Number.isFinite(credits) && credits > 0
    ? { userId, planId: null, credits, months: 0 }
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
    p_months: grant.months === 12 ? 12 : 1,
  });
  if (error) throw error;

  /* What it cost, on the ledger line it made — in the currency it was paid
     in and in dollars: an account's total funded is what decides whether it
     is asked or required to add a card (see card_status in
     supabase/schema.sql). When Stripe showed the buyer a local price, its own
     conversion says what that was in the dollars the session was priced in. */
  if (typeof session.amount_total === "number" && session.amount_total > 0 && session.currency) {
    const conversion = (session as { currency_conversion?: { amount_total?: number; source_currency?: string } | null })
      .currency_conversion;
    const knownUsd =
      conversion && conversion.source_currency?.toLowerCase() === "usd" && typeof conversion.amount_total === "number"
        ? conversion.amount_total / 100
        : null;
    await recordPayment(service, {
      userId: grant.userId,
      dedupeKey: `stripe:${session.id}`,
      minorAmount: session.amount_total,
      currency: session.currency,
      provider: "stripe",
      knownUsd,
    });
  }
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

/* ── Plans: a subscription, settled one paid invoice at a time ─────────────
 *
 * A plan bought by card renews every month (or year) until it is cancelled.
 * Every paid invoice — the first and each renewal — extends the plan and
 * grants its month through settle_stripe_checkout, keyed on the invoice id so
 * a second delivery changes nothing. Who and what come from the metadata this
 * app wrote onto the subscription. A renewal that is not paid simply never
 * arrives, and the plan runs out at its paid-through date. */

type InvoicePlan = { userId: string; planId: string; months: 1 | 12; subscriptionId: string | null };

function invoicePlan(invoice: Stripe.Invoice): InvoicePlan | null {
  const details = invoice.parent?.subscription_details ?? null;
  const meta = details?.metadata ?? {};
  const userId = meta.user_id ?? "";
  const planId = meta.plan_id ?? null;
  if (!UUID.test(userId) || meta.kind !== "plan" || !isPaidPlanId(planId)) return null;
  const months = meta.months === "12" ? 12 : 1;
  const subscription = details?.subscription;
  return { userId, planId, months, subscriptionId: typeof subscription === "string" ? subscription : (subscription?.id ?? null) };
}

/** Settles one paid plan invoice. "skipped" when it is not one of ours. */
export async function settlePaidInvoice(
  service: SupabaseClient,
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<"settled" | "skipped"> {
  const plan = invoicePlan(invoice);
  if (!plan || invoice.status !== "paid" || !invoice.id) return "skipped";
  /* The $0 invoice a free trial opens with grants nothing: the plan's month
     is the one billed when the trial ends (see lib/stripe-plan.ts). */
  if (invoice.billing_reason === "subscription_create" && invoice.amount_paid === 0) return "skipped";

  const { error } = await service.rpc("settle_stripe_checkout", {
    p_session_id: invoice.id,
    p_user_id: plan.userId,
    p_credits: null,
    p_plan_id: plan.planId,
    p_months: plan.months,
  });
  if (error) throw error;

  if (invoice.amount_paid > 0 && invoice.currency) {
    await recordPayment(service, {
      userId: plan.userId,
      dedupeKey: `stripe:${invoice.id}`,
      minorAmount: invoice.amount_paid,
      currency: invoice.currency,
      provider: "stripe",
    });
  }

  /* The card the plan renews on is the account's card on file — so a new
     subscriber is not asked for a card they just paid with. Best effort. */
  if (plan.subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(plan.subscriptionId, { expand: ["default_payment_method"] });
      const method = subscription.default_payment_method;
      const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      if (method && typeof method !== "string") await rememberCard(stripe, service, plan.userId, customer, method);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("stripe: could not keep the card a plan renews on:", err instanceof Error ? err.message : err);
    }
  }
  return "settled";
}

/** The sweep's half for plans: paid plan invoices from the recovery window
 *  that have no ledger line yet, settled now. */
export async function recoverMissedInvoices(
  service: SupabaseClient,
  stripe: Stripe,
  now: number,
): Promise<{ recovered: string[]; failures: { id: string; why: string }[] }> {
  const recovered: string[] = [];
  const failures: { id: string; why: string }[] = [];
  const since = Math.floor(now / 1000) - STRIPE_RECOVERY_WINDOW_DAYS * 24 * 60 * 60;
  const paid: Stripe.Invoice[] = [];
  for await (const invoice of stripe.invoices.list({ status: "paid", created: { gte: since }, limit: 100 })) {
    if (invoicePlan(invoice)) paid.push(invoice);
  }
  if (paid.length === 0) return { recovered, failures };
  const { data, error } = await service
    .from("credit_ledger")
    .select("dedupe_key")
    .in("dedupe_key", paid.map((invoice) => `stripe:${invoice.id}`));
  if (error) {
    failures.push({ id: "(stripe invoices)", why: error.message });
    return { recovered, failures };
  }
  const done = new Set((data ?? []).map((row) => (row as { dedupe_key: string }).dedupe_key));
  for (const invoice of paid) {
    if (done.has(`stripe:${invoice.id}`)) continue;
    try {
      if ((await settlePaidInvoice(service, stripe, invoice)) === "settled") recovered.push(invoice.id ?? "?");
    } catch (err) {
      failures.push({ id: invoice.id ?? "?", why: err instanceof Error ? err.message : String(err) });
    }
  }
  return { recovered, failures };
}
