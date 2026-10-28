import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

/* Stripe's receipt, for every card payment — a top-up, a plan, and every
 * renewal.
 *
 * A charge with `receipt_email` set gets Stripe's receipt emailed to that
 * address in live mode whatever the account's email settings say; setting it
 * after the payment sends it then. So once a payment is settled the webhook
 * makes sure its charge carries the account's email. A charge that already
 * has one (Stripe, or Managed Payments, sent its receipt) is left alone, so
 * nobody gets two, and a redelivered webhook sends nothing more. Test mode
 * sends no receipts — Stripe's rule, not this file's.
 *
 * The same charge answers the history's "Receipt" link: its receipt_url is
 * Stripe's hosted receipt, readable without signing in to anything. */

/** The charge behind a paid Checkout Session (a top-up), if it has one. */
export async function chargeForSession(stripe: Stripe, sessionId: string): Promise<Stripe.Charge | null> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge"] });
  const intent = session.payment_intent;
  const charge = intent && typeof intent !== "string" ? intent.latest_charge : null;
  return charge && typeof charge !== "string" ? charge : null;
}

/** The charge that paid an invoice (a plan's month or year), if any. */
export async function chargeForInvoice(stripe: Stripe, invoiceId: string): Promise<Stripe.Charge | null> {
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 10 });
  for (const payment of payments.data) {
    if (payment.status !== "paid") continue;
    const ref = payment.payment;
    if (ref.charge) return typeof ref.charge === "string" ? stripe.charges.retrieve(ref.charge) : ref.charge;
    if (ref.payment_intent) {
      const id = typeof ref.payment_intent === "string" ? ref.payment_intent : ref.payment_intent.id;
      const intent = await stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] });
      const charge = intent.latest_charge;
      if (charge && typeof charge !== "string") return charge;
    }
  }
  return null;
}

/** The account's own email — where its receipts go. */
async function accountEmail(service: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await service.auth.admin.getUserById(userId).catch(() => ({ data: null }));
  return data?.user?.email ?? null;
}

/**
 * Has Stripe email the receipt for this charge to the account, unless one
 * went already. Best effort and never throws: a payment is settled whether
 * or not its receipt could be sent.
 */
export async function sendStripeReceipt(
  stripe: Stripe,
  service: SupabaseClient,
  userId: string,
  charge: Stripe.Charge | null,
): Promise<"sent" | "already" | "skipped"> {
  try {
    if (!charge || !charge.paid || charge.amount <= 0) return "skipped";
    if (charge.receipt_email) return "already";
    const email = (await accountEmail(service, userId)) ?? charge.billing_details?.email ?? null;
    if (!email) return "skipped";
    await stripe.charges.update(charge.id, { receipt_email: email });
    return "sent";
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("stripe: could not send the receipt:", error instanceof Error ? error.message : error);
    return "skipped";
  }
}

/** Stripe's hosted receipt for a ledger line paid by card ('stripe:cs_…' a
 *  top-up, 'stripe:in_…' a plan), or null. */
export async function receiptUrlFor(stripe: Stripe, dedupeKey: string): Promise<string | null> {
  const id = dedupeKey.startsWith("stripe:") ? dedupeKey.slice("stripe:".length) : null;
  if (!id) return null;
  if (id.startsWith("cs_")) return (await chargeForSession(stripe, id))?.receipt_url ?? null;
  if (id.startsWith("in_")) {
    const charge = await chargeForInvoice(stripe, id);
    if (charge?.receipt_url) return charge.receipt_url;
    const invoice = await stripe.invoices.retrieve(id);
    return invoice.hosted_invoice_url ?? null;
  }
  return null;
}
