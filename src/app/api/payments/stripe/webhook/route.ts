import { NextResponse } from "next/server";
import Stripe from "stripe";

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
 *     whatever fulfill() grows into must be idempotent on the session id.
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

/* TODO: grant what was bought. Must be idempotent on session.id — Stripe can
   deliver the same event twice, and completed + async_payment_succeeded never
   both fulfill one session only because of the payment_status check above.
   See STRIPE_INTEGRATION_TODO.md → Fulfillment. */
async function fulfill(session: Stripe.Checkout.Session) {
  // eslint-disable-next-line no-console
  console.log("stripe webhook: checkout session paid:", session.id, {
    customer: session.customer,
    client_reference_id: session.client_reference_id,
    amount_total: session.amount_total,
    currency: session.currency,
  });
}
