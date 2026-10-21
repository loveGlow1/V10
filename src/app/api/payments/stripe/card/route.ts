import { NextResponse } from "next/server";
import Stripe from "stripe";

import { SIGNUP_CREDITS } from "@/app/dashboard/credits";
import { SITE_URL } from "@/lib/site";
import { cardStatusOf } from "@/lib/card-gate";
import { CARD_SESSION_KIND, cardStatus, customerFor } from "@/lib/stripe-card";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { stripeSecretKey } from "@/lib/stripe-key";

/* A card on file — the key to the free welcome credit. See stripe-card.ts.
 *
 * GET  { configured, card, welcomed, welcomeCredits, status, required } —
 *      what the card screens draw. `status` is ok, suggest (asked, keeps
 *      working) or required (may not use the service until it saves a card);
 *      see lib/card-gate.ts.
 * POST { url } — a Stripe Checkout page in setup mode: the card is saved and
 *      verified by the bank, never charged. Who it is for is written onto the
 *      session here, on the server; the browser's return
 *      (./confirm) and the webhook record it. */

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
  const [status, gate] = await Promise.all([cardStatus(service, user.id), cardStatusOf(service, user.id)]);
  return NextResponse.json({
    status: gate,
    required: gate === "required",
    configured: Boolean(stripeSecretKey()),
    card: status.card,
    welcomed: status.welcomed,
    welcomeCredits: SIGNUP_CREDITS,
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
