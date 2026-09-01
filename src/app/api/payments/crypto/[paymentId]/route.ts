import { NextResponse } from "next/server";

import { isOpenStatus } from "@/lib/crypto-payments";
import {
  PAYMENT_COLUMNS,
  paymentFromRow,
  type CryptoPaymentRow,
} from "@/lib/crypto-payments-server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* How the checkout screen learns what happened to an order.
 *
 * The browser polls this while the payment screen is open, because the thing it
 * is waiting for — a confirmation on a chain — arrives at the settlement
 * webhook, not in the tab. Nothing here settles anything: it reads.
 *
 * The one write it does make is the expiry. A rate lock that has run out is a
 * fact about the row, not an opinion the reader is entitled to keep to itself:
 * if the order is still open and its window has passed, it is closed here so
 * that a stale tab cannot go on showing an amount nobody would honour. The
 * update names the open statuses in its filter, so a settlement landing at the
 * same moment wins rather than being overwritten.
 *
 * The read runs under the caller's own session, so RLS answers "is this
 * theirs?" — an id that belongs to somebody else comes back empty and is
 * answered exactly like an id that does not exist. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await context.params;

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
    return NextResponse.json({ error: "Sign in to see this payment." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("crypto_payments")
    .select(PAYMENT_COLUMNS)
    .eq("id", paymentId)
    .maybeSingle();

  if (error) {
    // eslint-disable-next-line no-console
    console.error("crypto payments: could not read the order:", error);
    return NextResponse.json({ error: "Could not read that payment." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "No such payment." }, { status: 404 });
  }

  const payment = paymentFromRow(data as CryptoPaymentRow);

  if (isOpenStatus(payment.status) && new Date(payment.expiresAt).getTime() <= Date.now()) {
    const service = createSupabaseServiceClient();

    if (service) {
      await service
        .from("crypto_payments")
        .update({ status: "expired", failure_reason: "The quoted rate expired before payment." })
        .eq("id", paymentId)
        .in("status", ["awaiting_payment", "submitted"]);
    }

    return NextResponse.json({ ...payment, status: "expired" as const });
  }

  return NextResponse.json(payment);
}
