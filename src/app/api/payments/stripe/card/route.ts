import { NextResponse } from "next/server";
import Stripe from "stripe";

import { SIGNUP_CREDITS } from "@/app/dashboard/credits";
import { SITE_URL } from "@/lib/site";
import { cardStatusOf } from "@/lib/card-gate";
import {
  CARD_SESSION_KIND,
  cardStatus,
  customerFor,
  hasLiveSubscription,
  liveSubscriptions,
  offersWelcomeTrial,
  removeCard,
  renewingPlanOf,
} from "@/lib/stripe-card";
import { WELCOME_TRIAL_PLAN, WELCOME_TRIAL_PURCHASE, lineItemFor, trialEndFrom, welcomeTrialOffer } from "@/lib/stripe-plan";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { stripeSecretKey } from "@/lib/stripe-key";

/* A card on file — the key to the free welcome credit. See stripe-card.ts.
 *
 * GET  { configured, card, welcomed, welcomeCredits, status, required,
 *        deadline, trial } — what the card screens draw. `status` is ok,
 *      suggest (asked, keeps working) or required (may not use the service
 *      until it saves a card); see lib/card-gate.ts. `deadline` is when a
 *      crypto-paid account without a card locks (card_deadline). `trial` is
 *      the plan a new account's card starts, said before it is added.
 * POST { url } — a Stripe Checkout page. For a new account (no welcome yet,
 *      on Free): subscription mode with a month's free trial of
 *      WELCOME_TRIAL_PLAN, billed on the same day next month unless cancelled
 *      — see lib/stripe-plan.ts. For anyone else: setup mode, the card saved
 *      and verified by the bank, nothing charged. Who it is for is written
 *      onto the session here, on the server; the browser's return
 *      (./confirm) and the webhook record it.
 * DELETE { ok, status, cancelled } — the card taken off (lib/stripe-card.ts
 *      removeCard). With ?cancelPlan=1, plans renewing on it are cancelled
 *      first (to the end of what was paid; a trial with no charge); without,
 *      it is refused with 409 card_in_use while one depends on it. GET's
 *      `removal` says beforehand what removing does: the plans it would
 *      cancel, and the card status the account would have. */

/* Every method Checkout could otherwise offer that is not a card. */
const NOT_CARDS = [
  "klarna", "cashapp", "amazon_pay", "affirm", "afterpay_clearpay", "zip", "alma", "paypal", "us_bank_account",
  "sepa_debit", "bacs_debit", "acss_debit", "au_becs_debit", "nz_bank_account", "pay_by_bank", "crypto",
  "revolut_pay", "mobilepay", "samsung_pay", "kr_card", "naver_pay", "kakao_pay", "payco", "billie", "satispay",
  "scalapay", "sequra", "sunbit", "bizum", "paypay", "twint", "wero", "payto",
] as Stripe.Checkout.SessionCreateParams.ExcludedPaymentMethodType[];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function signedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Temporarily unavailable, please retry." }, { status: 503 });
  const secretKey = stripeSecretKey();
  const [status, gate, deadline, without] = await Promise.all([
    cardStatus(service, user.id),
    cardStatusOf(service, user.id),
    service.rpc("card_deadline", { p_user_id: user.id }).then(({ data }) => (typeof data === "string" ? data : null)),
    service.rpc("card_status_without_card", { p_user_id: user.id }).then(({ data }) => (typeof data === "string" ? data : "required")),
  ]);
  /* What removing the card would do, for the confirmation. */
  const plans =
    status.card && status.customerId && secretKey
      ? await liveSubscriptions(new Stripe(secretKey), status.customerId).then((subs) => subs.map(renewingPlanOf)).catch(() => [])
      : [];
  const removal = status.card
    ? { blocked: plans.length > 0, plans, after: without === "required" ? "required" : without === "suggest" ? "suggest" : "ok" }
    : null;
  const trial = !status.card && (await offersWelcomeTrial(service, user.id, status.welcomed)) ? welcomeTrialOffer(new Date()) : null;
  return NextResponse.json({
    status: gate,
    required: gate === "required",
    configured: Boolean(stripeSecretKey()),
    card: status.card,
    welcomed: status.welcomed,
    welcomeCredits: SIGNUP_CREDITS,
    deadline,
    trial,
    removal,
  });
}

export async function POST(request: Request) {
  const secretKey = stripeSecretKey();
  if (!secretKey) return NextResponse.json({ error: "Stripe is not configured on this deployment." }, { status: 503 });
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Temporarily unavailable, please retry." }, { status: 503 });

  /* Where to come back to: a same-site path only. */
  const body = (await request.json().catch(() => ({}))) as { returnTo?: unknown };
  const returnTo =
    typeof body.returnTo === "string" && body.returnTo.startsWith("/") && !body.returnTo.startsWith("//") ? body.returnTo : "/dashboard";
  const back = (state: string, extra = "") =>
    `${SITE_URL}${returnTo}${returnTo.includes("?") ? "&" : "?"}card=${state}${extra}`;

  const stripe = new Stripe(secretKey);
  const customerId = await customerFor(stripe, service, user);

  const metadata = { user_id: user.id, kind: CARD_SESSION_KIND };

  /* A new account's card starts its free month. Asked of Stripe as well as
     the database, so a second tab cannot open a second trial. */
  const { welcomed } = await cardStatus(service, user.id);
  const trial =
    (await offersWelcomeTrial(service, user.id, welcomed)) && !(await hasLiveSubscription(stripe, customerId));
  if (trial) {
    const trialMetadata = { ...metadata, trial: "welcome" };
    /* The subscription carries what every plan's does (kind, plan_id,
       months), so its paid invoices settle like any plan's. */
    const subscriptionMetadata = {
      user_id: user.id,
      kind: "plan",
      plan_id: WELCOME_TRIAL_PLAN,
      months: "1",
      trial: "welcome",
    };
    const base: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      metadata: trialMetadata,
      line_items: [lineItemFor(WELCOME_TRIAL_PURCHASE)],
      payment_method_collection: "always",
      subscription_data: {
        trial_end: Math.floor(trialEndFrom(new Date()).getTime() / 1000),
        /* No card at the end of the month (taken off meanwhile) ends the
           plan rather than leaving an unpaid invoice open. */
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: subscriptionMetadata,
      },
      success_url: back("saved", "&card_session={CHECKOUT_SESSION_ID}"),
      cancel_url: back("cancelled"),
    };
    /* Managed Payments, as every plan is sold — Stripe the merchant of record,
       tax handled. Should Stripe refuse it for a trial, the same session
       without it, cards only. */
    const session = await stripe.checkout.sessions
      .create({ ...base, managed_payments: { enabled: true } })
      .catch(async (error) => {
        // eslint-disable-next-line no-console
        console.warn("card trial: Managed Payments refused the session, opening it without:", error instanceof Error ? error.message : error);
        return stripe.checkout.sessions.create({ ...base, managed_payments: { enabled: false }, excluded_payment_method_types: NOT_CARDS });
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("card trial: Stripe refused the session:", error);
        return null;
      });
    if (!session?.url) return NextResponse.json({ error: "Stripe did not open a page. Try again." }, { status: 502 });
    return NextResponse.json({ url: session.url });
  }


  /* Checked against Stripe itself:
       - payment_method_types is no longer accepted; the currency stands in,
         and the methods come from the account's settings.
       - Managed Payments, on by default for this account, allows only payment
         and subscription mode, so a setup session opts out of it.
       - Everything that is not a card is excluded, leaving card (Apple Pay
         and Google Pay included) and Link, which cannot be excluded and is a
         card underneath — see recordCardSetup. */
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    currency: "usd",
    managed_payments: { enabled: false },
    excluded_payment_method_types: NOT_CARDS,
    customer: customerId,
    client_reference_id: user.id,
    metadata,
    setup_intent_data: { metadata },
    success_url: back("saved", "&card_session={CHECKOUT_SESSION_ID}"),
    cancel_url: back("cancelled"),
  });
  if (!session.url) return NextResponse.json({ error: "Stripe did not open a page. Try again." }, { status: 502 });
  return NextResponse.json({ url: session.url });
}

export async function DELETE(request: Request) {
  const secretKey = stripeSecretKey();
  if (!secretKey) return NextResponse.json({ error: "Stripe is not configured on this deployment." }, { status: 503 });
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Temporarily unavailable, please retry." }, { status: 503 });

  const cancelPlan = new URL(request.url).searchParams.get("cancelPlan") === "1";
  const removed = await removeCard(new Stripe(secretKey), service, user.id, { cancelPlan }).catch((error) => {
    // eslint-disable-next-line no-console
    console.error("card: could not remove the card:", error);
    return { ok: false as const, status: 502, code: "stripe_unavailable" as const, reason: "The card couldn't be removed. Try again." };
  });
  if (!removed.ok) return NextResponse.json({ error: removed.reason, code: removed.code }, { status: removed.status });
  return NextResponse.json({ ok: true, status: await cardStatusOf(service, user.id), cancelled: removed.cancelled });
}
