import { NextResponse } from "next/server";

import {
  PAYMENT_COLUMNS,
  paymentFromRow,
  type CryptoPaymentRow,
} from "@/lib/crypto-payments-server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* "I've sent it."
 *
 * What this does: records that the payer says they have paid, and the
 * transaction reference if they have one to hand.
 *
 * What it deliberately does not do: grant anything. Credits are released by
 * settle_crypto_payment, called from the settlement webhook once the payment
 * has actually been seen on the chain. A button in a browser is a claim, not a
 * confirmation, and wiring the two together would mean anyone with an account
 * could press it and be given a plan.
 *
 * That is the whole reason this endpoint exists as its own thing rather than as
 * part of the webhook: it moves an order from "waiting" to "the payer thinks
 * they have paid", which is what lets the screen stop asking somebody to send
 * money they have already sent, and what lets support tell a stuck payment from
 * an abandoned one. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ paymentId: string }> }) {
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
    return NextResponse.json({ error: "Sign in to confirm this payment." }, { status: 401 });
  }

  /* A reference is optional — most people paying from a phone wallet do not
     have one to hand — so a body that is absent or unparseable is not an error. */
  let txReference: string | null = null;
  try {
    const body = (await request.json()) as { txReference?: unknown };
    if (typeof body?.txReference === "string" && body.txReference.trim()) {
      txReference = body.txReference.trim().slice(0, 200);
    }
  } catch {
    txReference = null;
  }

  /* Under the caller's session: RLS decides whether this order is theirs, and
     an id that is not comes back empty. */
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

  /* Already settled. Answered as success with the order as it stands, because
     the person pressed a button for something that has already happened and
     an error would tell them the opposite of the truth. */
  if (payment.status === "confirmed") {
    return NextResponse.json(payment);
  }

  if (payment.status === "expired" || payment.status === "failed") {
    return NextResponse.json(
      {
        error:
          payment.status === "expired"
            ? "That order expired. Start a new one to get a fresh quote."
            : "That order was not completed. Start a new one to try again.",
        code: payment.status,
        payment,
      },
      { status: 409 },
    );
  }

  const service = createSupabaseServiceClient();

  if (!service) {
    return NextResponse.json(
      { error: "Payments are not fully configured on this deployment." },
      { status: 503 },
    );
  }

  const { data: updated, error: updateError } = await service
    .from("crypto_payments")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      /* Never overwrites a reference the webhook already recorded with an empty
         one from a second press. */
      ...(txReference ? { tx_reference: txReference } : {}),
    })
    .eq("id", paymentId)
    /* A settlement that landed between the read above and this write keeps its
       status: only an order still waiting is moved. */
    .in("status", ["awaiting_payment", "submitted"])
    .select(PAYMENT_COLUMNS)
    .maybeSingle();

  if (updateError) {
    // eslint-disable-next-line no-console
    console.error("crypto payments: could not record the payer's confirmation:", updateError);
    return NextResponse.json({ error: "Could not record that." }, { status: 500 });
  }

  /* No row came back: it settled a moment ago. The order as last read is the
     honest answer, and the screen polls for the rest. */
  return NextResponse.json(updated ? paymentFromRow(updated as CryptoPaymentRow) : payment);
}
