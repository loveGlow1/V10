import { NextResponse } from "next/server";
import Stripe from "stripe";

import {
  purchaseCredits,
  purchaseLabel,
  purchasePriceUsd,
  readPurchase,
} from "@/lib/crypto-payments";
import { ANNUAL_DISCOUNT, PLANS } from "@/app/dashboard/credits";
import { SITE_URL } from "@/lib/site";
import { createSupabaseServerClient } from "@/lib/supabase-server";

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
 * A plan is sold the way the crypto checkout sells it: one month or twelve,
 * paid once (mode "payment"), not an auto-renewing Stripe subscription.
 *
 * The buyer must be signed in. Their user id and what they bought are written
 * onto the session here, on the server, and read back by
 * /api/payments/stripe/webhook to grant it — a browser cannot set either.
 *
 * STRIPE_SECRET_KEY is a secret: set it in Vercel → Environment Variables,
 * never in .env (that file is committed). No key means every call is refused.
 */

/* The Stripe tax category every QuickStark product is sold under: Software as
   a Service, business use. Chosen by the owner; required by Managed Payments,
   which rejects a line item without an eligible code. */
const PRODUCT_TAX_CODE = "txcd_10103001";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
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

  const credits = purchaseCredits(purchase);
  // One-off for plans too: a month at a time, like the crypto checkout.
  const mode: Stripe.Checkout.SessionCreateParams.Mode = "payment";

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
       (PRODUCT_TAX_CODE below). */
    managed_payments: { enabled: true },
    mode,
    success_url: `${SITE_URL}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/dashboard?checkout=cancelled`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(purchasePriceUsd(purchase) * 100),
          product_data: {
            name:
              purchase.kind !== "plan"
                ? `QuickStark ${purchaseLabel(purchase)}`
                : purchase.months === 12
                  ? `QuickStark ${PLANS[purchase.planId].name} plan — 12 months`
                  : `QuickStark ${PLANS[purchase.planId].name} plan — one month`,
            description:
              purchase.kind !== "plan"
                ? `${credits} credits. Top-up credits never expire.`
                : purchase.months === 12
                  ? `${credits} credits every month for 12 months. ${Math.round(ANNUAL_DISCOUNT * 100)}% less than monthly.`
                  : `${credits} credits for the month.`,
            tax_code: PRODUCT_TAX_CODE,
          },
        },
      },
    ],
    /* The signed-in account's email, so the buyer does not type it, and so the
       receipt and invoice go where the account's mail goes. */
    ...(user.email ? { customer_email: user.email } : {}),
    /* A Customer for every purchase. The invoice and receipt are issued by
       Stripe under Managed Payments, so invoice_creation is not sent. */
    customer_creation: "always",
    // Who gets what. Read back by the webhook; only this server can write it.
    client_reference_id: user.id,
    metadata:
      purchase.kind === "plan"
        ? {
            user_id: user.id,
            kind: "plan",
            plan_id: purchase.planId,
            months: String(purchase.months === 12 ? 12 : 1),
          }
        : { user_id: user.id, kind: "topup", credits: String(credits) },
  };
  if (params.mode === "subscription") {
    params.payment_method_collection = "always";
  }

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
