import { NextResponse } from "next/server";
import Stripe from "stripe";

import { purchaseCredits, readPurchase } from "@/lib/crypto-payments";
import { SITE_URL } from "@/lib/site";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { stripeSecretKey } from "@/lib/stripe-key";
import { customerFor } from "@/lib/stripe-card";
import { lineItemFor } from "@/lib/stripe-plan";
import { refuseTopUp } from "@/lib/top-up-access";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Hosted Stripe Checkout — the card twin of /api/payments/crypto.
 *
 * Takes { purchase } — a month of a paid plan, or top-up packs — and answers
 * { url }: the Stripe-hosted page the payment sheet sends the browser to. JSON
 * rather than a redirect so that a refusal (not signed in, not configured) can
 * be shown in the sheet instead of replacing the page.
 *
 * The price is decided here, never by the browser: it is read from PLANS and
 * TOP_UP_PACK in src/app/dashboard/credits.ts through the same helpers the
 * crypto checkout uses, and sent to Stripe as inline price_data. So there are
 * no Products or Prices to keep in step in the Stripe Dashboard, and a card
 * payment and a crypto payment for the same thing always cost the same.
 *
 * A plan is a subscription (mode "subscription"), the way emergent.sh sells
 * them: billed every month — or every year on the annual price — on the card
 * it was bought with, until it is cancelled in the billing portal
 * (/api/payments/stripe/portal). Each paid invoice is settled by the webhook
 * (invoice.paid). Top-ups are one-off payments. The crypto checkout, which
 * cannot charge again, still sells a plan a month or a year at a time.
 *
 * The buyer must be signed in. Their user id and what they bought are written
 * onto the session here, on the server, and read back by
 * /api/payments/stripe/webhook to grant it — a browser cannot set either.
 *
 * STRIPE_SECRET_KEY is a secret: set it in Vercel → Environment Variables,
 * never in .env (that file is committed). No key means every call is refused.
 */

/* How long a top-up checkout stays open: Stripe's shortest allowed. */
const TOP_UP_SESSION_MINUTES = 30;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secretKey = stripeSecretKey();
  if (!secretKey) {
    return NextResponse.json(
      { error: "Stripe is not configured on this deployment." },
      { status: 503 },
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Payments are unavailable because Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to pay." }, { status: 401 });
  }

  let body: { purchase?: unknown };
  try {
    body = (await request.json()) as { purchase?: unknown };
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const purchase = readPurchase(body.purchase);
  if (!purchase) {
    return NextResponse.json({ error: "Choose a plan or a top-up to pay for." }, { status: 400 });
  }
  const stripe = new Stripe(secretKey);
  const service = createSupabaseServiceClient();
  /* Every purchase is on the account's one Stripe customer — the one its
     card is on — so the billing portal shows plans, top-ups and the card
     together, and this account's unfinished checkouts can be found. */
  const customer = service ? await customerFor(stripe, service, user).catch(() => null) : null;

  /* A top-up counts card checkouts this account has open (each expires after
     TOP_UP_SESSION_MINUTES) against the month's limit, so several tabs
     opened at once cannot pass it between them. */
  if (purchase.kind === "topup") {
    if (!customer) return NextResponse.json({ error: "Temporarily unavailable, please retry." }, { status: 503 });
    const open = await stripe.checkout.sessions.list({ customer, status: "open", limit: 100 }).catch(() => null);
    if (!open) return NextResponse.json({ error: "Stripe couldn't be reached. Try again." }, { status: 502 });
    const pendingUsd = open.data
      .filter((session) => session.metadata?.kind === "topup")
      .reduce((sum, session) => sum + (Number(session.metadata?.usd) || 0), 0);
    const refused = await refuseTopUp(service, user.id, purchase.usd, pendingUsd);
    if (refused) return refused;
  }

  const credits = purchaseCredits(purchase);
  const plan = purchase.kind === "plan";
  const mode: Stripe.Checkout.SessionCreateParams.Mode = plan ? "subscription" : "payment";
  /* Who it is for, on the session and — for a plan — on the subscription,
     where every renewal's invoice carries it to the webhook. */
  const metadata: Record<string, string> =
    purchase.kind === "plan"
      ? { user_id: user.id, kind: "plan", plan_id: purchase.planId, months: String(purchase.months === 12 ? 12 : 1) }
      : { user_id: user.id, kind: "topup", credits: String(credits), usd: String(purchase.usd) };

  const params: Stripe.Checkout.SessionCreateParams = {
    // Checkout Studio
    ui_mode: "hosted_page",
    billing_address_collection: "auto",
    phone_number_collection: { enabled: false },
    allow_promotion_codes: false,
    submit_type: "auto",
    integration_identifier: "hosted_web_0001",
    origin_context: "web",
    /* Managed Payments: Stripe is the merchant of record, so it calculates,
       collects and remits sales tax, VAT and GST worldwide, issues the invoice
       and receipt, and handles disputes. In exchange Stripe controls some of
       the session, and these must NOT be sent with it: automatic_tax (Stripe
       handles tax), invoice_creation (Stripe issues the invoice),
       payment_method_types / payment_method_configuration, tax_id_collection,
       custom_text and shipping. Every product needs an eligible tax code
       (PRODUCT_TAX_CODE in lib/stripe-plan.ts). */
    managed_payments: { enabled: true },
    mode,
    success_url: `${SITE_URL}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/dashboard?checkout=cancelled`,
    /* A top-up's checkout holds its place under the monthly limit, so it
       lapses soon rather than after Stripe's default day. */
    ...(plan ? {} : { expires_at: Math.floor(Date.now() / 1000) + TOP_UP_SESSION_MINUTES * 60 }),
    line_items: [lineItemFor(purchase)],
    /* The account's own customer; only if that could not be had (a plan
       still sells), the signed-in account's email, so the buyer does not
       type it and the receipt goes where the account's mail goes. The
       invoice and receipt are issued by Stripe under Managed Payments, so
       invoice_creation is not sent. */
    ...(customer
      ? { customer }
      : {
          ...(user.email ? { customer_email: user.email } : {}),
          ...(plan ? {} : { customer_creation: "always" as const }),
        }),
    // Who gets what. Read back by the webhook; only this server can write it.
    client_reference_id: user.id,
    metadata,
    ...(plan ? { subscription_data: { metadata }, payment_method_collection: "always" as const } : {}),
  };

  try {
    const session = await stripe.checkout.sessions.create(params);
    if (!session.url) {
      return NextResponse.json({ error: "Stripe returned no checkout URL." }, { status: 502 });
    }
    return NextResponse.json({ url: session.url });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Stripe checkout session failed:", error);
    /* Stripe's own message says which of a handful of setup problems this is —
       a key without permission, an invalid key, a live key on a test account —
       and is written to be shown: it never contains a full key. Only a
       signed-in account gets this far. */
    const reason = error instanceof Stripe.errors.StripeError ? error.message : null;
    return NextResponse.json(
      { error: reason ? `Could not start checkout: ${reason}` : "Could not start checkout." },
      { status: 502 },
    );
  }
}
