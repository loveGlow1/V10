import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createBtcPayInvoice, isBtcPayConfigured } from "@/lib/btcpay";

import {
  CRYPTO_CURRENCIES,
  RATE_LOCK_MINUTES,
  convertUsdToCrypto,
  isCryptoCurrencyId,
  isPlausibleEmail,
  nudgeAmount,
  purchaseCredits,
  purchasePriceUsd,
  readPurchase,
} from "@/lib/crypto-payments";
import {
  PAYMENT_COLUMNS,
  paymentFromRow,
  walletFor,
  type CryptoPaymentRow,
} from "@/lib/crypto-payments-server";
import { rateFor } from "@/lib/crypto-rates";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Where an order is created.
 *
 * This is the moment the quote stops moving. Everything the payment will be
 * judged against — the dollar price, the rate, the amount of coin, the address,
 * and the credits it buys — is decided here and written into a row, because
 * from the next screen onwards a wallet is about to send something irreversible
 * against those figures.
 *
 * Three things are deliberately not taken from the request:
 *
 *   the price   — read from the plan table for the purchase the caller names;
 *   the rate    — read live, then locked into the row for RATE_LOCK_MINUTES;
 *   the address — read from this deployment's configuration.
 *
 * A body that carries an amount, a rate or an address is simply ignored. There
 * is no field for any of them and there should never be one: each is a way to
 * be paid less than the order is worth, or to have a stranger's address served
 * to a paying customer.
 *
 * The row is written with the service key. credit_balances and crypto_payments
 * are both read-only from the browser for the same reason — a client that could
 * write either one could grant itself credits — so ownership is settled here,
 * from the session, and the insert names the user it just read. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* How many one-unit nudges an order may take before it gives up looking for an
   amount no other open order is using. Twenty-five is far past what a real
   collision needs on a coin quoted to eight places, and on a stablecoin quoted
   to two it caps what a payer can be nudged at a quarter of a dollar. */
const UNIQUE_AMOUNT_ATTEMPTS = 25;

type CreateRequest = {
  purchase?: unknown;
  currency?: unknown;
  lightning?: unknown;
  receiptEmail?: unknown;
};

export async function POST(request: Request) {
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
    return NextResponse.json({ error: "Sign in to pay." }, { status: 401 });
  }

  const service = createSupabaseServiceClient();

  if (!service) {
    /* Without the service key there is nowhere to write the order. Refused
       rather than half-started: an order that exists only in a browser tab is
       an address somebody might pay into with nothing on record. */
    return NextResponse.json(
      { error: "Payments are not fully configured on this deployment." },
      { status: 503 },
    );
  }

  let body: CreateRequest;
  try {
    body = (await request.json()) as CreateRequest;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const purchase = readPurchase(body.purchase);

  if (!purchase) {
    return NextResponse.json(
      { error: "Name what is being bought: a paid plan, or a number of top-up packs." },
      { status: 400 },
    );
  }

  if (!isCryptoCurrencyId(body.currency)) {
    return NextResponse.json({ error: "Pick a currency to pay in." }, { status: 400 });
  }

  const currency = body.currency;
  const wallet = walletFor(currency);

  if (!wallet) {
    return NextResponse.json(
      {
        error: `${CRYPTO_CURRENCIES[currency].name} is not accepted here.`,
        code: "currency_unavailable",
      },
      { status: 400 },
    );
  }

  /* Lightning is offered only where an invoice source is configured for the
     coin. Asking for it without one is refused rather than quietly downgraded
     to an on-chain address: the fee and the confirmation time are different
     enough that a person who chose Lightning has chosen something. */
  const lightning = body.lightning === true;

  if (lightning && !wallet.lightningAddress) {
    return NextResponse.json(
      {
        error: `Lightning is not available for ${CRYPTO_CURRENCIES[currency].name} here.`,
        code: "lightning_unavailable",
      },
      { status: 400 },
    );
  }

  const receiptEmail =
    typeof body.receiptEmail === "string" && body.receiptEmail.trim()
      ? body.receiptEmail.trim().slice(0, 320)
      : null;

  if (receiptEmail && !isPlausibleEmail(receiptEmail)) {
    return NextResponse.json(
      { error: "That receipt address does not look like an email address." },
      { status: 400 },
    );
  }

  const rateUsd = await rateFor(currency);

  if (!rateUsd) {
    return NextResponse.json(
      {
        error: `The live ${CRYPTO_CURRENCIES[currency].symbol} price is unavailable right now. Try again in a moment.`,
        code: "rates_unavailable",
      },
      { status: 503 },
    );
  }

  const amountUsd = purchasePriceUsd(purchase);
  const cryptoAmount = convertUsdToCrypto(
    amountUsd,
    rateUsd,
    CRYPTO_CURRENCIES[currency].decimals,
  );

  const expiresAt = new Date(Date.now() + RATE_LOCK_MINUTES * 60_000).toISOString();

  /* Generated here rather than by the database, because BTCPay has to be told
     the order id while the invoice is being created and the row does not exist
     yet. The insert below supplies it explicitly. */
  const paymentId = randomUUID();

  /* ── Where this order is actually paid ────────────────────────────────────

     With BTCPay configured, the invoice owns the address AND the amount. Both
     come back from it and are stored as given: asking someone for an amount
     BTCPay is not watching for is a payment that arrives and never settles, so
     there is exactly one authority on the figure and it is whoever is doing the
     watching.

     For any coin but on-chain BTC, and on any deployment with no BTCPay at
     all, nothing changes: the static address, our own rate, and the
     amount-nudging that makes a shared address workable. That fallback is the
     reason this can ship before the BTCPay instance exists.

     What is NOT a fallback is BTCPay being configured and failing. Falling
     through to the static address there looks harmless and is not: the invoice
     is what watches for the payment, so an order written without one is an
     address a customer pays into that nothing is watching. The money arrives,
     settle_crypto_payment is never called, and the order sits awaiting_payment
     until a person notices — which is the exact failure the invoice was added
     to remove. So this refuses instead. A customer who cannot pay for two
     minutes comes back; a customer who pays and receives nothing does not. */
  const wantsInvoice = currency === "btc" && !lightning && isBtcPayConfigured();

  const invoice = wantsInvoice
    ? await createBtcPayInvoice({
        orderId: paymentId,
        amountUsd,
        expiryMinutes: RATE_LOCK_MINUTES,
        receiptEmail,
      })
    : null;

  if (wantsInvoice && !invoice) {
    // eslint-disable-next-line no-console
    console.error("crypto payments: BTCPay is configured but issued no invoice; refusing the order");
    return NextResponse.json(
      {
        error:
          "Bitcoin checkout is briefly unavailable. Try again in a few minutes, or pay in another currency.",
        code: "invoicing_unavailable",
      },
      { status: 503 },
    );
  }

  const address = invoice
    ? invoice.address
    : lightning
      ? wallet.lightningAddress!
      : wallet.address;

  const row = {
    id: paymentId,
    user_id: user.id,
    status: "awaiting_payment",
    purchase_kind: purchase.kind,
    plan_id: purchase.kind === "plan" ? purchase.planId : null,
    packs: purchase.kind === "topup" ? purchase.packs : null,
    credits: purchaseCredits(purchase),
    amount_usd: amountUsd,
    currency,
    lightning,
    address,
    /* Only carried on chains that need one, and only from configuration —
       a payment sent to a tagged address without its tag is not credited. */
    destination_tag: lightning ? null : wallet.destinationTag,
    rate_usd: invoice && invoice.rateUsd > 0 ? invoice.rateUsd : rateUsd,
    receipt_email: receiptEmail,
    expires_at: expiresAt,
  };

  /* The amount has to be unique among the open orders on this address, because
     on a static address it is the only thing that says which order a payment
     belongs to. The database owns that uniqueness — a partial unique index over
     the open statuses — and this loop answers its refusal by asking for one
     more unit rather than by guessing an unused amount up front, which would be
     a race with every other order being created at the same moment.

     A Lightning invoice needs none of this: it is issued per payment and
     carries its own identity. The loop still runs, finds no collision on the
     first attempt, and costs nothing. */
  /* An invoice has its own address, so its amount is already unique — and must
     not be touched, because BTCPay is watching for the exact figure it quoted.
     Nudging is only for the shared-address case it replaces. */
  const attempts = invoice ? 1 : UNIQUE_AMOUNT_ATTEMPTS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptAmount = invoice
      ? invoice.cryptoAmount
      : nudgeAmount(cryptoAmount, currency, attempt);

    const { data, error } = await service
      .from("crypto_payments")
      .insert({ ...row, crypto_amount: attemptAmount })
      .select(PAYMENT_COLUMNS)
      .single();

    if (!error && data) {
      return NextResponse.json(paymentFromRow(data as CryptoPaymentRow), { status: 201 });
    }

    /* 23505 is the unique violation: another open order already asks for this
       exact amount at this address. Anything else is a real failure. */
    if (error?.code !== "23505") {
      // eslint-disable-next-line no-console
      console.error("crypto payments: could not create the order:", error);
      return NextResponse.json({ error: "Could not start that payment." }, { status: 500 });
    }
  }

  /* Every amount in the window is spoken for. On a coin quoted to two places
     that is genuinely possible under load, and the honest answer is to refuse:
     an order sharing its amount with another open one is an order that cannot
     be told apart when the money lands. */
  // eslint-disable-next-line no-console
  console.error(
    `crypto payments: no free amount for ${currency} at ${address} after ${UNIQUE_AMOUNT_ATTEMPTS} attempts`,
  );
  return NextResponse.json(
    {
      error: "Too many payments are in flight in that currency. Try another coin, or again shortly.",
      code: "no_distinct_amount",
    },
    { status: 503 },
  );
}
