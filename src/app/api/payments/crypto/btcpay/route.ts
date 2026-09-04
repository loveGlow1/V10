import { NextResponse } from "next/server";

import {
  BTCPAY_SIGNATURE_HEADER,
  isBtcPayWebhookConfigured,
  readBtcPayInvoice,
  verifyBtcPayWebhook,
} from "@/lib/btcpay";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* The thing that was missing: something that notices a payment arrived.
 *
 * BTCPay watches the address it issued for an order and POSTs here when that
 * order is paid. Nothing else in this app can see a blockchain, which is why
 * settling used to mean a person reading their own wallet and running
 * `npm run settle`.
 *
 * ── Why this is not /api/payments/crypto/webhook ───────────────────────────
 *
 * That route exists and still works — it is the manual path, and the one a
 * different processor would use. It verifies THIS app's signature scheme: a
 * timestamp, a dot, an HMAC over `${issuedAt}\n${body}`, checked against a
 * five-minute window. BTCPay signs differently — `sha256=<hmac>` over the raw
 * body, with no timestamp — and cannot produce that shape. Teaching one
 * verifier both schemes would mean a body accepted under whichever is weaker;
 * two routes means each one only ever accepts what it was built for.
 *
 * ── Why it re-reads the invoice ────────────────────────────────────────────
 *
 * A valid signature proves the body was written by someone holding the secret.
 * It does not prove the body is CURRENT, and BTCPay's signature covers no
 * timestamp, so a captured delivery can be replayed forever. So the signature
 * is the door, and the answer to "BTCPay, is this invoice actually settled?" is
 * the decision. A replayed body asks the question again and gets the same
 * honest answer, which settle_crypto_payment then ignores as a duplicate.
 *
 * ── What it never does ─────────────────────────────────────────────────────
 *
 * Decide what anyone is owed. It maps an invoice to an order and calls
 * settle_crypto_payment, which is idempotent and holds every rule about what a
 * payment is worth. This route is a sensor, not an accountant.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* BTCPay's terminal states for "the money is really there". `Settled` is the
   modern name; `Complete`/`Confirmed` are what older instances send for the
   same thing. Anything else — New, Processing, Expired, Invalid — is not a
   payment yet and is acknowledged without granting anything. */
const SETTLED = new Set(["Settled", "Complete", "Confirmed"]);

export async function POST(request: Request) {
  if (!isBtcPayWebhookConfigured()) {
    /* 503, not 401: nothing is wrong with the caller. This deployment simply
       cannot check a signature, and a callback it cannot verify must never
       settle anything. */
    return NextResponse.json(
      { error: "BTCPay settlement is not configured on this deployment." },
      { status: 503 },
    );
  }

  /* The raw text, not the parsed object. The signature covers exact bytes, and
     two different byte strings can parse to the same JSON — only one of them
     was signed. */
  const raw = await request.text();

  if (!verifyBtcPayWebhook(raw, request.headers.get(BTCPAY_SIGNATURE_HEADER))) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  let body: { type?: unknown; invoiceId?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId : null;
  if (!invoiceId) {
    return NextResponse.json({ error: "No invoice on that callback." }, { status: 400 });
  }

  /* Everything BTCPay sends about an invoice arrives here, most of it about
     invoices being created and looked at. Only settlement is interesting, and
     the rest is answered 200 so BTCPay stops redelivering it. */
  if (typeof body.type === "string" && !body.type.startsWith("Invoice")) {
    return NextResponse.json({ ok: true, ignored: body.type });
  }

  /* The authority. Not the delivered body — see the note above about replays. */
  const invoice = await readBtcPayInvoice(invoiceId);

  if (!invoice) {
    /* Could not ask. A 502 tells BTCPay to try again later, which is right:
       the payment is real and unsettled, and giving up would strand it. */
    return NextResponse.json({ error: "Could not read that invoice back." }, { status: 502 });
  }

  if (!SETTLED.has(invoice.status)) {
    return NextResponse.json({ ok: true, status: invoice.status, settled: false });
  }

  if (!invoice.orderId) {
    /* Settled, and nothing to credit it to. Worth logging loudly: it means an
       invoice was created outside this app, or created without its metadata,
       and somebody has paid for something nobody is going to receive. */
    // eslint-disable-next-line no-console
    console.error(`btcpay: invoice ${invoiceId} settled with no orderId in its metadata`);
    return NextResponse.json({ error: "That invoice has no order." }, { status: 422 });
  }

  const service = createSupabaseServiceClient();

  if (!service) {
    return NextResponse.json(
      { error: "Payments are not fully configured on this deployment." },
      { status: 503 },
    );
  }

  const { error } = await service.rpc("settle_crypto_payment", {
    p_payment_id: invoice.orderId,
    /* BTCPay's invoice id rather than a transaction hash: it is what identifies
       the payment in the place a person would go to look it up, and one invoice
       can be paid by more than one transaction. */
    p_tx_reference: invoiceId,
  });

  if (error) {
    /* 22023 is the invalid_parameter_value the function raises for an id it
       cannot find. Answered 404 so BTCPay stops redelivering a callback that
       will never match anything. */
    if (error.code === "22023") {
      return NextResponse.json({ error: "No such payment." }, { status: 404 });
    }

    // eslint-disable-next-line no-console
    console.error("btcpay: settlement failed:", error);
    /* Anything else might be transient, so 500 and let BTCPay retry.
       settle_crypto_payment is idempotent, so a retry that lands after a
       success grants nothing twice. */
    return NextResponse.json({ error: "Could not settle that payment." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, settled: true, paymentId: invoice.orderId });
}
