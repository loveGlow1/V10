import { NextResponse } from "next/server";
import Stripe from "stripe";

import { SIGNUP_CREDITS } from "@/app/dashboard/credits";
import { SITE_URL } from "@/lib/site";
import { cardRequired } from "@/lib/card-gate";
import { CARD_SESSION_KIND, cardStatus } from "@/lib/stripe-card";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* A card on file — the key to the free welcome credit. See stripe-card.ts.
 *
 * GET  { configured, card, welcomed, welcomeCredits, required } — what the
 *      card screens draw. `required`: this account may not use the service
 *      until it saves a card (see lib/card-gate.ts).
 * POST { url } — a Stripe Checkout page in setup mode: the card is saved and
 *      verified by the bank, never charged. Who it is for is written onto the
 *      session here, on the server; the browser's return
 *      (./confirm) and the webhook record it. */

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
  const [status, required] = await Promise.all([cardStatus(service, user.id), cardRequired(service, user.id)]);
  return NextResponse.json({
    required,
    configured: Boolean(process.env.STRIPE_SECRET_KEY),
    card: status.card,
    welcomed: status.welcomed,
    welcomeCredits: SIGNUP_CREDITS,
  });
}

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
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
  /* One Stripe customer per account: the one already on file, or a new one. */
  const { customerId: known } = await cardStatus(service, user.id);
  const customerId =
    known ??
    (
      await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      })
    ).id;

  const metadata = { user_id: user.id, kind: CARD_SESSION_KIND };
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    client_reference_id: user.id,
    payment_method_types: ["card"],
    metadata,
    setup_intent_data: { metadata },
    success_url: back("saved", "&card_session={CHECKOUT_SESSION_ID}"),
    cancel_url: back("cancelled"),
  });
  if (!session.url) return NextResponse.json({ error: "Stripe did not open a page. Try again." }, { status: 502 });
  return NextResponse.json({ url: session.url });
}
