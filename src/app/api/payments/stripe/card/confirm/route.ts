import { NextResponse } from "next/server";
import Stripe from "stripe";

import { cardSessionUser, recordCardSetup } from "@/lib/stripe-card";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* The browser back from saving a card: POST { sessionId }. Records the card and
 * grants the welcome now, rather than waiting on the webhook — which records
 * the same session too; both are safe to run. Only the account the session was
 * opened for may confirm it. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return NextResponse.json({ error: "Stripe is not configured on this deployment." }, { status: 503 });
  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Temporarily unavailable, please retry." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { sessionId?: unknown };
  const sessionId = typeof body.sessionId === "string" && /^cs_[A-Za-z0-9_]+$/.test(body.sessionId) ? body.sessionId : null;
  if (!sessionId) return NextResponse.json({ error: "Nothing to confirm." }, { status: 400 });

  const stripe = new Stripe(secretKey);
  const session = await stripe.checkout.sessions.retrieve(sessionId).catch(() => null);
  if (!session || cardSessionUser(session) !== user.id) {
    return NextResponse.json({ error: "That card was not saved for this account." }, { status: 404 });
  }
  const result = await recordCardSetup(stripe, service, session);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });
  return NextResponse.json(result);
}
