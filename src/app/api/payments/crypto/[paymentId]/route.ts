import { NextResponse } from "next/server";

import { isOpenStatus } from "@/lib/crypto-payments";
import {
  PAYMENT_COLUMNS,
  paymentFromRow,
  type CryptoPaymentRow,
} from "@/lib/crypto-payments-server";
import {
  RECONCILABLE_COLUMNS,
  loadUsedTxids,
  reconcileOrder,
  type ReconcilableOrder,
} from "@/lib/reconcile-order";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* How the checkout screen learns what happened to an order.
 *
 * The browser polls this every few seconds while the payment screen is open,
 * and that poll is worth more than a read. The batch sweep runs every half
 * hour, which is a long time to sit looking at an unchanged screen having just
 * sent money — so an open order asks the chain about ITSELF here, on the poll
 * that is happening anyway. The person watching gets an answer in seconds; the
 * sweep stays as the backstop for whoever closed the tab.
 *
 * Throttled by chain_checked_at, because ten block-explorer requests a minute
 * per open tab is not a reasonable way to treat a free public API for an answer
 * that cannot change faster than a block.
 *
 * It reconciles rather than merely expiring, and the difference is not
 * cosmetic. Expiring on the clock alone closes an order whose payment landed
 * late — and the sweep reads only OPEN orders, so nothing would ever look at it
 * again. A late payment would sit on the chain, uncredited, with nothing
 * reporting it. reconcileOrder reads the chain first, which settles what was
 * paid and strands what arrived but does not match, instead of quietly burying
 * either.
 *
 * The read runs under the caller's own session, so RLS answers "is this
 * theirs?" — an id that belongs to somebody else comes back empty and is
 * answered exactly like an id that does not exist. Only after that does the
 * service client touch anything. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* How long a poll waits before asking the chain again. The screen polls every
   few seconds; a block arrives every ten minutes or so. Twenty seconds keeps it
   feeling live while cutting the requests by roughly four. */
const CHAIN_RECHECK_MS = 20_000;

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

  if (!isOpenStatus(payment.status)) return NextResponse.json(payment);

  const service = createSupabaseServiceClient();

  if (!service) return NextResponse.json(payment);

  /* Only on-chain coins have an address to read. Lightning carries its own
     proof and settles through its own callback. */
  const watchable = payment.currency === "btc" && !payment.lightning;

  if (watchable) {
    const { data: row } = await service
      .from("crypto_payments")
      .select(RECONCILABLE_COLUMNS)
      .eq("id", paymentId)
      .maybeSingle();

    const order = row as ReconcilableOrder | null;
    const lastChecked = order?.chain_checked_at ? new Date(order.chain_checked_at).getTime() : 0;

    if (order && Date.now() - lastChecked > CHAIN_RECHECK_MS) {
      /* Loaded here as well as in the sweep, and not skipped as an optimisation
         for the single-order case: on a shared address the amount identifies
         the order, amounts are unique only among OPEN orders, and an older
         payment of the same figure would otherwise settle this one for free.
         One query, at most every CHAIN_RECHECK_MS. */
      await reconcileOrder(service, order, await loadUsedTxids(service), Date.now());

      const { data: after } = await supabase
        .from("crypto_payments")
        .select(PAYMENT_COLUMNS)
        .eq("id", paymentId)
        .maybeSingle();

      if (after) return NextResponse.json(paymentFromRow(after as CryptoPaymentRow));
    }
  }

  /* Nothing was read from the chain — either it is not a coin we watch, or the
     throttle is still holding. The rate lock is still a fact about the row, and
     a stale tab must not go on showing an amount nobody would honour. */
  if (new Date(payment.expiresAt).getTime() <= Date.now()) {
    await service
      .from("crypto_payments")
      .update({ status: "expired", failure_reason: "The quoted rate expired before payment." })
      .eq("id", paymentId)
      .in("status", ["awaiting_payment", "submitted"]);

    return NextResponse.json({ ...payment, status: "expired" as const });
  }

  return NextResponse.json(payment);
}
