import { NextResponse } from "next/server";

import {
  CRYPTO_CURRENCIES,
  RATE_LOCK_MINUTES,
  convertUsdToCrypto,
  purchaseCredits,
  purchaseLabel,
  purchasePriceUsd,
  readPurchase,
  type CryptoQuote,
  type CurrencyQuote,
} from "@/lib/crypto-payments";
import { configuredCurrencies, walletFor } from "@/lib/crypto-payments-server";
import { ratesFor } from "@/lib/crypto-rates";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/* What a purchase costs in each coin — the first screen of the checkout.
 *
 * Nothing is created here and nothing is charged; this is the menu. It exists
 * as its own endpoint because the amounts have to be on screen *before* an
 * order is made: picking a currency is the one decision in this flow that
 * cannot be taken back, since an order is bound to the address a wallet is
 * about to send to.
 *
 * A coin appears only when both halves of it work — this deployment holds a
 * wallet for it, and a rate for it could be read. Anything else is left out,
 * because the alternative is offering somebody a coin the checkout will refuse
 * a moment later, or worse, quoting an amount derived from a rate nobody had.
 *
 * The price itself is read from the plan table, never from the query string.
 * The caller names *what* they are buying; this decides what it costs. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

  const params = new URL(request.url).searchParams;
  const purchase = readPurchase({
    kind: params.get("kind"),
    planId: params.get("planId"),
    packs: params.get("packs"),
  });

  if (!purchase) {
    return NextResponse.json(
      {
        error:
          "Name what is being bought: kind=plan with a paid planId, or kind=topup with a pack count.",
      },
      { status: 400 },
    );
  }

  const available = configuredCurrencies();

  if (available.length === 0) {
    return NextResponse.json(
      {
        error: "Crypto payments are not switched on for this deployment.",
        code: "checkout_unconfigured",
      },
      { status: 503 },
    );
  }

  const amountUsd = purchasePriceUsd(purchase);
  const rates = await ratesFor(available);

  const currencies: CurrencyQuote[] = [];

  for (const currency of available) {
    const rateUsd = rates[currency];
    if (!rateUsd) continue;

    currencies.push({
      currency,
      amount: convertUsdToCrypto(amountUsd, rateUsd, CRYPTO_CURRENCIES[currency].decimals),
      rateUsd,
      lightningAvailable: Boolean(walletFor(currency)?.lightningAddress),
    });
  }

  if (currencies.length === 0) {
    /* Every coin is configured and none could be priced: the rate source is
       down. Said plainly, and as a 503 rather than an empty menu, because it is
       temporary and retrying is the right response. */
    return NextResponse.json(
      {
        error: "Live crypto prices are unavailable right now. Try again in a moment.",
        code: "rates_unavailable",
      },
      { status: 503 },
    );
  }

  const quote: CryptoQuote = {
    purchase,
    label: purchaseLabel(purchase),
    amountUsd,
    credits: purchaseCredits(purchase),
    rateLockMinutes: RATE_LOCK_MINUTES,
    currencies,
  };

  return NextResponse.json(quote);
}
