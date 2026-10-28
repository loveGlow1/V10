import type { SupabaseClient } from "@supabase/supabase-js";

import { purchaseLabel } from "@/lib/crypto-payments";
import { paymentFromRow, PAYMENT_COLUMNS, type CryptoPaymentRow } from "@/lib/crypto-payments-server";
import { SITE_URL } from "@/lib/site";

/* The receipt for a deposit or a plan paid in crypto.
 *
 * Stripe emails its own receipt for every card payment (lib/stripe-receipts.ts);
 * a crypto payment has nobody to send one, so this does — once per order, to
 * the address on the order (the account's own unless another was typed in).
 * Once is held by crypto_payments.receipt_sent_at: an order is claimed by
 * stamping it, and unstamped again if the email could not be sent, so the
 * reconcile sweep can try again later (sendPendingCryptoReceipts).
 *
 * Sent through Resend, as operator alerts are. RECEIPT_FROM is the sender — a
 * mailbox on a domain verified with Resend; without it ALERT_FROM is used.
 * With no key or no sender this does nothing and says so in the log: a payment
 * is settled whether or not its receipt could be sent. */

export function isCryptoReceiptConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && (process.env.RECEIPT_FROM?.trim() || process.env.ALERT_FROM?.trim()));
}

function usd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** The receipt's lines, in order — the same in the text and HTML parts. */
function receiptLines(row: CryptoPaymentRow): [string, string][] {
  const payment = paymentFromRow(row);
  const when = new Date(row.confirmed_at ?? Date.now());
  return [
    ["Item", purchaseLabel(payment.purchase)],
    ["Credits", String(Number(row.credits))],
    ["Amount", usd(Number(row.amount_usd))],
    ["Paid", `${row.crypto_amount} ${String(row.currency).toUpperCase()}${row.lightning ? " (Lightning)" : ""}`],
    ["Date", `${when.toUTCString().replace(" GMT", " UTC")}`],
    ["Order", row.id],
    ...(row.tx_reference ? ([["Transaction", row.tx_reference]] as [string, string][]) : []),
  ];
}

async function deliver(to: string, row: CryptoPaymentRow): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RECEIPT_FROM?.trim() || process.env.ALERT_FROM?.trim();
  if (!key || !from) {
    // eslint-disable-next-line no-console
    console.warn("crypto receipt: not sent — set RESEND_API_KEY and RECEIPT_FROM (a sender on a domain verified with Resend)");
    return false;
  }
  const lines = receiptLines(row);
  const subject = `Your QuickStark receipt — ${usd(Number(row.amount_usd))}`;
  const text = [
    "Thanks — your payment is confirmed and the credits are in your account.",
    "",
    ...lines.map(([label, value]) => `${label}: ${value}`),
    "",
    `Your history: ${SITE_URL}/dashboard?settings=plans`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
<h1 style="font-size:20px;margin:0 0 4px">Receipt</h1>
<p style="margin:0 0 20px;color:#555">Thanks — your payment is confirmed and the credits are in your account.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${lines
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #eee">${escapeHtml(label)}</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #eee;word-break:break-all">${escapeHtml(value)}</td></tr>`,
    )
    .join("")}</table>
<p style="margin:20px 0 0;font-size:13px"><a href="${SITE_URL}/dashboard?settings=plans" style="color:#111">See your history</a></p>
</div>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error("crypto receipt: Resend refused it:", response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("crypto receipt: could not be sent:", error);
    return false;
  }
}

/**
 * Emails the receipt for one confirmed order, unless it went already. Never
 * throws. Returns whether this call sent it.
 */
export async function sendCryptoReceipt(service: SupabaseClient, paymentId: string): Promise<boolean> {
  if (!isCryptoReceiptConfigured()) return false;
  /* Claimed by stamping: of two callers settling the same order, one wins. */
  const { data } = await service
    .from("crypto_payments")
    .update({ receipt_sent_at: new Date().toISOString() })
    .eq("id", paymentId)
    .eq("status", "confirmed")
    .is("receipt_sent_at", null)
    .select(PAYMENT_COLUMNS)
    .maybeSingle();
  const row = data as CryptoPaymentRow | null;
  if (!row) return false;

  let to = row.receipt_email;
  if (!to) {
    const { data: account } = await service.auth.admin.getUserById(row.user_id).catch(() => ({ data: null }));
    to = account?.user?.email ?? null;
  }
  const sent = to ? await deliver(to, row) : false;
  if (!sent && to) {
    /* Unclaimed, so the sweep tries again. */
    await service.from("crypto_payments").update({ receipt_sent_at: null }).eq("id", paymentId);
  }
  return sent;
}

/** The sweep's half: receipts for orders confirmed in the last three days
 *  that have none yet — settled by the database's own sweep, or whose email
 *  failed the first time. */
export async function sendPendingCryptoReceipts(service: SupabaseClient, now: number): Promise<number> {
  if (!isCryptoReceiptConfigured()) return 0;
  const since = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await service
    .from("crypto_payments")
    .select("id")
    .eq("status", "confirmed")
    .is("receipt_sent_at", null)
    .gte("confirmed_at", since)
    .limit(50);
  let sent = 0;
  for (const row of (data ?? []) as { id: string }[]) {
    if (await sendCryptoReceipt(service, row.id)) sent += 1;
  }
  return sent;
}
