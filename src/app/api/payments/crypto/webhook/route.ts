import { NextResponse } from "next/server";

import {
  SETTLEMENT_SIGNATURE_HEADER,
  isSettlementCallbackConfigured,
  verifySettlement,
} from "@/lib/crypto-payments-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Where a payment becomes credits.
 *
 * This is the only endpoint in the application that can grant anything, and it
 * is called by a machine — a payment processor, a chain watcher, whatever is
 * actually watching the wallets — rather than by a person. So it takes no
 * session, and the entire question of who may call it is settled by one thing:
 * an HMAC over the exact bytes of the body, made with a secret only this
 * deployment and that watcher hold.
 *
 * Consequences worth being explicit about, because each is a way this could be
 * got wrong:
 *
 *   - The signature covers the raw text, read before parsing. Two different
 *     byte strings can parse to the same JSON, and only one of them was signed.
 *   - No secret configured means every call is refused. "Nothing to check
 *     against" has to mean no; a webhook that waves callers through when it is
 *     misconfigured is a free credit dispenser.
 *   - The amount is not taken from the callback. The order already knows what
 *     it is worth — the row was written with the price, the rate and the credits
 *     when it was quoted — so a callback can say *which* order settled and
 *     never *what it was worth*.
 *   - Paying out is settle_crypto_payment's job, and it is idempotent: the row
 *     is locked, an already-confirmed order returns untouched. Processors
 *     retry, and a retry must not pay twice.
 *
 * Expected body:
 *   { "paymentId": "<uuid>", "status": "confirmed" | "failed" | "expired",
 *     "txReference": "<chain reference>", "reason": "<why it failed>" }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SettlementBody = {
  paymentId?: unknown;
  status?: unknown;
  txReference?: unknown;
  reason?: unknown;
};

const REPORTABLE = ["confirmed", "failed", "expired"] as const;
type ReportedStatus = (typeof REPORTABLE)[number];

function isReportedStatus(value: unknown): value is ReportedStatus {
  return typeof value === "string" && (REPORTABLE as readonly string[]).includes(value);
}

export async function POST(request: Request) {
  if (!isSettlementCallbackConfigured()) {
    return NextResponse.json(
      { error: "Settlement callbacks are not configured on this deployment." },
      { status: 503 },
    );
  }

  /* Text first, always. Parsing before verifying would mean verifying something
     other than what arrived. */
  const raw = await request.text();

  if (!verifySettlement(raw, request.headers.get(SETTLEMENT_SIGNATURE_HEADER))) {
    return NextResponse.json({ error: "Unsigned or stale callback." }, { status: 401 });
  }

  let body: SettlementBody;
  try {
    body = JSON.parse(raw) as SettlementBody;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";

  if (!paymentId) {
    return NextResponse.json({ error: "Name the payment this is about." }, { status: 400 });
  }

  if (!isReportedStatus(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${REPORTABLE.join(", ")}.` },
      { status: 400 },
    );
  }

  const txReference =
    typeof body.txReference === "string" && body.txReference.trim()
      ? body.txReference.trim().slice(0, 200)
      : null;

  const service = createSupabaseServiceClient();

  if (!service) {
    /* Answered as a 503 on purpose: a processor retries a 503 and gives up on a
       400. A settlement this deployment cannot record right now is one it wants
       delivered again. */
    return NextResponse.json(
      { error: "Payments are not fully configured on this deployment." },
      { status: 503 },
    );
  }

  if (body.status === "confirmed") {
    const { error } = await service.rpc("settle_crypto_payment", {
      p_payment_id: paymentId,
      p_tx_reference: txReference,
    });

    if (error) {
      /* 22023 is the invalid_parameter_value the function raises for an id it
         cannot find. A processor should not keep re-delivering that one. */
      if (error.code === "22023") {
        return NextResponse.json({ error: "No such payment." }, { status: 404 });
      }

      // eslint-disable-next-line no-console
      console.error("crypto payments: settlement failed:", error);
      return NextResponse.json({ error: "Could not settle that payment." }, { status: 500 });
    }

    return NextResponse.json({ paymentId, status: "confirmed" });
  }

  const { data, error } = await service
    .from("crypto_payments")
    .update({
      status: body.status,
      failure_reason:
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim().slice(0, 200)
          : null,
      ...(txReference ? { tx_reference: txReference } : {}),
    })
    .eq("id", paymentId)
    /* A settled order is final. A late "expired" for something that has already
       been paid for and credited must not undo it. */
    .in("status", ["awaiting_payment", "submitted"])
    .select("id, status")
    .maybeSingle();

  if (error) {
    // eslint-disable-next-line no-console
    console.error("crypto payments: could not record the outcome:", error);
    return NextResponse.json({ error: "Could not record that outcome." }, { status: 500 });
  }

  /* Nothing matched: either there is no such order, or it is already settled.
     Both are "there is nothing here to do", which is a success for a caller
     that only wants to know it does not have to call again. */
  return NextResponse.json({ paymentId, status: data?.status ?? "unchanged" });
}
