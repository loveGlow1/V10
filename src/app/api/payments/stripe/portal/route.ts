import { NextResponse } from "next/server";
import Stripe from "stripe";

import { SITE_URL } from "@/lib/site";
import { customerFor } from "@/lib/stripe-card";
import { stripeSecretKey } from "@/lib/stripe-key";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Stripe's billing portal, for the signed-in account: cancel or change a
 * monthly plan, change the card it renews on, and see invoices. POST → { url }.
 * Opened on the account's own Stripe customer — the one its card and plan are
 * on — so nobody reaches anybody else's billing. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const secretKey = stripeSecretKey();
  if (!secretKey) return NextResponse.json({ error: "Billing is not set up on this deployment yet." }, { status: 503 });
  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Temporarily unavailable, please retry." }, { status: 503 });

  try {
    const stripe = new Stripe(secretKey);
    const customer = await customerFor(stripe, service, user);
    const portal = await stripe.billingPortal.sessions.create({ customer, return_url: `${SITE_URL}/dashboard` });
    return NextResponse.json({ url: portal.url });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("stripe: billing portal failed:", error);
    const reason = error instanceof Stripe.errors.StripeError ? error.message : null;
    return NextResponse.json({ error: reason ? `Could not open billing: ${reason}` : "Could not open billing." }, { status: 502 });
  }
}
