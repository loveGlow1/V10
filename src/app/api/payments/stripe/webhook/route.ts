import { NextResponse } from "next/server";
import Stripe from "stripe";

import { isPaidPlanId } from "@/lib/crypto-payments";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Where Stripe tells this app a Checkout Session finished.
 *
 * Called by Stripe, not by a person, so it takes no session: who may call it is
 * settled entirely by the Stripe-Signature header, an HMAC over the exact bytes
 * of the body made with STRIPE_WEBHOOK_SECRET.
 *
 *   - The body is read as text and verified before it is parsed. Parsing first
 *     would mean verifying something other than what arrived.
 *   - No secret configured means every call is refused. A webhook that waves
 *     callers through when it is misconfigured is a free fulfillment dispenser.
 *   - Stripe retries, and may deliver the same event more than once, so
 *     fulfill() pays out through settle_stripe_checkout, which is idempotent
 *     on the session id.
 *
 * Events handled:
 *   checkout.session.completed              — paid now (cards), or pending
 *                                             (bank debits: payment_status "unpaid")
 *   checkout.session.async_payment_succeeded — a pending payment cleared
 *   checkout.session.async_payment_failed    — a pending payment failed
 *   checkout.session.expired                 — abandoned; nothing to fulfill
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    /* A 503, so Stripe retries once the deployment is configured. */
    return NextResponse.json(
      { error: "Stripe webhooks are not configured on this deployment." },
      { status: 503 },
    );
  }
  const stripe = new Stripe(secretKey);

  const raw = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe-Signature header." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, webhookSecret);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("stripe webhook: signature verification failed:", error);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        /* "unpaid" here means a delayed payment method; wait for
           async_payment_succeeded. "no_payment_required" is a free checkout. */
        if (session.payment_status !== "unpaid") {
          await fulfill(session);
        }
        break;
      }
      case "checkout.session.async_payment_succeeded":
        await fulfill(event.data.object);
        break;
      case "checkout.session.async_payment_failed":
        // eslint-disable-next-line no-console
        console.warn("stripe webhook: async payment failed:", event.data.object.id);
        break;
      case "checkout.session.expired":
        break;
      default:
        /* Anything else the endpoint was subscribed to: acknowledged, ignored. */
        break;
    }
  } catch (error) {
    /* A 500 makes Stripe re-deliver, which is what a failed fulfillment wants. */
    // eslint-disable-next-line no-console
    console.error(`stripe webhook: handling ${event.type} failed:`, error);
    return NextResponse.json({ error: "Could not process that event." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/* Grants what the session was created for: a month of a plan, or top-up
 * credits.
 *
 * Who and what come from the session itself — client_reference_id and
 * metadata — which /api/payments/stripe/checkout wrote on the server, so a
 * customer cannot change either. settle_stripe_checkout is idempotent on the
 * session id: a re-delivered event, or completed followed by
 * async_payment_succeeded, pays out once.
 *
 * A session this app did not create (a Payment Link, a Dashboard test) has no
 * user or purchase on it. That is logged and acknowledged rather than thrown,
 * because retrying it would never succeed. Anything that might succeed on a
 * retry — no service key, a database error — throws, so Stripe re-delivers. */
async function fulfill(session: Stripe.Checkout.Session) {
  const userId = session.client_reference_id ?? session.metadata?.user_id ?? "";
  const kind = session.metadata?.kind ?? "topup";
  const planId = kind === "plan" ? session.metadata?.plan_id : undefined;
  const credits = kind === "plan" ? null : Number(session.metadata?.credits);

  const valid =
    UUID.test(userId) &&
    (kind === "plan"
      ? isPaidPlanId(planId)
      : credits !== null && Number.isFinite(credits) && credits > 0);
  if (!valid) {
    // eslint-disable-next-line no-console
    console.warn("stripe webhook: session has no user or purchase to grant:", session.id);
    return;
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  const { error } = await service.rpc("settle_stripe_checkout", {
    p_session_id: session.id,
    p_user_id: userId,
    p_credits: credits,
    p_plan_id: planId ?? null,
  });
  if (error) {
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
