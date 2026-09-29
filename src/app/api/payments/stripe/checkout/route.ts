import { NextResponse } from "next/server";
import Stripe from "stripe";

import { SITE_URL } from "@/lib/site";

/* Hosted Stripe Checkout.
 *
 * Creates a Checkout Session and sends the customer to the Stripe-hosted page
 * with a 303. The parameters marked "Checkout Studio" were configured there and
 * should be left as they are; mode, success_url, cancel_url and line_items are
 * placeholders — see STRIPE_INTEGRATION_TODO.md.
 *
 * STRIPE_SECRET_KEY is a secret: set it in Vercel → Environment Variables,
 * never in .env (that file is committed). No key means every call is refused.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json(
      { error: "Stripe is not configured on this deployment." },
      { status: 503 },
    );
  }
  const stripe = new Stripe(secretKey);

  // TODO: Set mode to "subscription" if selling recurring products.
  const mode: Stripe.Checkout.SessionCreateParams.Mode = "payment";

  const params: Stripe.Checkout.SessionCreateParams = {
    // Checkout Studio
    ui_mode: "hosted_page",
    billing_address_collection: "auto",
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
    allow_promotion_codes: false,
    submit_type: "auto",
    integration_identifier: "hosted_web_0001",
    origin_context: "web",
    // Placeholders
    mode,
    success_url: `${SITE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/cancel`,
    line_items: [{ price: "price_...", quantity: 1 }],
  };
  if (params.mode === "subscription") {
    params.payment_method_collection = "always";
  }

  try {
    const session = await stripe.checkout.sessions.create(params);
    if (!session.url) {
      return NextResponse.json({ error: "Stripe returned no checkout URL." }, { status: 502 });
    }
    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    console.error("Stripe checkout session failed:", error);
    return NextResponse.json({ error: "Could not start checkout." }, { status: 502 });
  }
}
