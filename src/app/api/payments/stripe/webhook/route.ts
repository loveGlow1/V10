import { NextResponse } from "next/server";
import Stripe from "stripe";

import { alertOncePerDay, sendOperatorAlert } from "@/lib/operator-alert";
import { isSessionPaid, settleCheckoutSession } from "@/lib/stripe-fulfillment";
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
 *     fulfillment pays out through settle_stripe_checkout, which is idempotent
 *     on the session id.
 *   - A failure is answered with a 500, so Stripe retries for up to three days,
 *     AND reported to the operator, so nobody finds out from a customer. If
 *     every retry fails, the reconciliation sweep (recoverMissedCheckouts)
 *     settles the session anyway.
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
        if (isSessionPaid(session)) {
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

    const subject = `Stripe webhook failed: ${event.type}`;
    const body =
      `A paid checkout could not be credited yet.\n\n`
      + `Event: ${event.id} (${event.type})\n`
      + `Session: ${(event.data.object as { id?: string }).id ?? "?"}\n`
      + `Error: ${error instanceof Error ? error.message : String(error)}\n\n`
      + `Stripe retries for up to three days, and the reconciliation sweep settles any `
      + `paid session it missed, so this usually resolves itself. If it keeps recurring, `
      + `check SUPABASE_SERVICE_ROLE_KEY and the app logs.\n`;
    const service = createSupabaseServiceClient();
    /* Once a day per event type: Stripe retries, and each retry failing the same
       way is one problem, not one email each. */
    await (service
      ? alertOncePerDay(service, `stripe-webhook:${event.type}`, subject, body)
      : sendOperatorAlert(subject, body)
    ).catch(() => false);

    return NextResponse.json({ error: "Could not process that event." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/* Grants what the session was bought for. See stripe-fulfillment.ts. A session
   with nothing to grant is acknowledged; anything that might succeed on a
   retry throws, so Stripe re-delivers. */
async function fulfill(session: Stripe.Checkout.Session) {
  const service = createSupabaseServiceClient();
  if (!service) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  await settleCheckoutSession(service, session);
}
