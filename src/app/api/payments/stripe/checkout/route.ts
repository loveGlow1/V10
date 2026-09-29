import { NextResponse } from "next/server";
import Stripe from "stripe";

import { TOP_UP_PACK } from "@/app/dashboard/credits";
import { SITE_URL } from "@/lib/site";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/* Hosted Stripe Checkout.
 *
 * Creates a Checkout Session and sends the customer to the Stripe-hosted page
 * with a 303. The parameters marked "Checkout Studio" were configured there and
 * should be left as they are; mode, success_url, cancel_url and line_items are
 * placeholders — see STRIPE_INTEGRATION_TODO.md.
 *
 * STRIPE_SECRET_KEY is a secret: set it in Vercel → Environment Variables,
 * never in .env (that file is committed). No key means every call is refused.
 *
 * The buyer must be signed in. Their user id and the credits being bought are
 * written onto the session here, on the server, and read back by
 * /api/payments/stripe/webhook to grant them — a browser cannot set either.
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
    // Who gets the credits, and how many. The price above must charge what
    // TOP_UP_PACK in src/app/dashboard/credits.ts says the pack costs.
    client_reference_id: user.id,
    metadata: { user_id: user.id, credits: String(TOP_UP_PACK.credits) },
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
