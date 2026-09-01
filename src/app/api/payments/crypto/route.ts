import { NextResponse } from "next/server";

import {
  CRYPTO_CURRENCIES,
  RATE_LOCK_MINUTES,
  convertUsdToCrypto,
  isCryptoCurrencyId,
  isPlausibleEmail,
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

  const address = lightning ? wallet.lightningAddress! : wallet.address;
  const expiresAt = new Date(Date.now() + RATE_LOCK_MINUTES * 60_000).toISOString();

  const { data, error } = await service
    .from("crypto_payments")
    .insert({
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
      crypto_amount: cryptoAmount,
      rate_usd: rateUsd,
      receipt_email: receiptEmail,
      expires_at: expiresAt,
    })
    .select(PAYMENT_COLUMNS)
    .single();

  if (error || !data) {
    // eslint-disable-next-line no-console
    console.error("crypto payments: could not create the order:", error);
    return NextResponse.json({ error: "Could not start that payment." }, { status: 500 });
  }

  return NextResponse.json(paymentFromRow(data as CryptoPaymentRow), { status: 201 });
}
