import { PLANS, TOP_UP_PACK, type PlanId } from "@/app/dashboard/credits";

/* Taking payment in cryptocurrency.
 *
 * Everything in this file is arithmetic and description — what a purchase
 * costs, which coins it can be paid in, how many of a coin a dollar figure
 * comes to, and what a wallet has to be handed to pay it. Nothing here reaches
 * a network, a database or an environment variable, which is what lets the
 * checkout modal quote a price with the same functions the server prices the
 * order with. The two must never be able to disagree: a person who is told
 * 0.00017692 BTC and is then charged something else has been misquoted, and a
 * chain payment cannot be un-sent.
 *
 * The parts that *do* need the outside world live next door, deliberately
 * separated so this module stays importable from the browser:
 *
 *   crypto-payments-server.ts — the wallets a payment can be sent to, and the
 *                               secret a settlement callback is verified with.
 *   crypto-rates.ts           — what a coin is worth right now.
 *
 * Two rules here are structural rather than stylistic:
 *
 *   1. A price is never taken from the client. `purchasePriceUsd` reads the
 *      plan table, and every route re-derives the figure from the purchase the
 *      caller names rather than from any amount they send.
 *   2. A conversion always rounds *up* to the coin's precision. Rounding a
 *      payment down leaves the order a few satoshis short of its own total,
 *      which reads to a payment processor as an underpayment and to a customer
 *      as a payment that vanished.
 */

export type CryptoCurrencyId =
  | "btc"
  | "xrp"
  | "eth"
  | "ltc"
  | "usdt"
  | "usdc"
  | "sol"
  | "doge"
  | "bch";

export type CryptoCurrency = {
  id: CryptoCurrencyId;
  /** The ticker, as a wallet shows it. */
  symbol: string;
  /** The name a person knows the coin by. */
  name: string;
  /** The chain or token standard, where the coin has more than one. Shown
   *  beside the address, because sending USDT over the wrong network is the
   *  single most common way a crypto payment is lost. */
  network: string | null;
  /** How many decimal places an amount is quoted to. Not the chain's own
   *  precision — the precision a person is asked to send. */
  decimals: number;
  /** The coin's colour, for its mark. */
  tint: string;
  /** The character drawn in the mark. Real currency signs, not letters. */
  glyph: string;
  /** What the rate source calls this coin. */
  rateId: string;
  /** The URI scheme a wallet answers to, when the coin has a BIP-21 style one.
   *  Null means the QR carries the bare address, which every wallet can read
   *  and no wallet can misread. */
  uriScheme: string | null;
  /** True where a payment needs a tag or memo alongside the address to be
   *  credited. XRP is the one here; getting it wrong loses the payment. */
  requiresDestinationTag: boolean;
  /** Whether the coin can be paid over the Lightning Network *if* the
   *  deployment has configured an invoice source for it. Capability, not
   *  availability: the server decides the second half. */
  supportsLightning: boolean;
};

/* The coins the checkout can offer. A deployment offers whichever of these it
   has configured a wallet for — see crypto-payments-server.ts — so this list is
   the ceiling, not the menu. */
export const CRYPTO_CURRENCIES: Record<CryptoCurrencyId, CryptoCurrency> = {
  btc: {
    id: "btc",
    symbol: "BTC",
    name: "Bitcoin",
    network: null,
    decimals: 8,
    tint: "#F7931A",
    glyph: "₿",
    rateId: "bitcoin",
    uriScheme: "bitcoin",
    requiresDestinationTag: false,
    supportsLightning: true,
  },
  xrp: {
    id: "xrp",
    symbol: "XRP",
    name: "XRP",
    network: null,
    decimals: 6,
    tint: "#23292F",
    glyph: "✕",
    rateId: "ripple",
    /* No scheme: the XRP URI draft never became something wallets agree on, and
       a QR a wallet cannot parse is worse than an address it can. */
    uriScheme: null,
    requiresDestinationTag: true,
    supportsLightning: false,
  },
  eth: {
    id: "eth",
    symbol: "ETH",
    name: "Ethereum",
    network: "ERC-20",
    decimals: 6,
    tint: "#627EEA",
    glyph: "Ξ",
    rateId: "ethereum",
    uriScheme: "ethereum",
    requiresDestinationTag: false,
    supportsLightning: false,
  },
  ltc: {
    id: "ltc",
    symbol: "LTC",
    name: "Litecoin",
    network: null,
    decimals: 8,
    tint: "#345D9D",
    glyph: "Ł",
    rateId: "litecoin",
    uriScheme: "litecoin",
    requiresDestinationTag: false,
    supportsLightning: true,
  },
  usdt: {
    id: "usdt",
    symbol: "USDT",
    name: "Tether",
    network: "ERC-20",
    decimals: 2,
    tint: "#26A17B",
    glyph: "₮",
    rateId: "tether",
    uriScheme: null,
    requiresDestinationTag: false,
    supportsLightning: false,
  },
  usdc: {
    id: "usdc",
    symbol: "USDC",
    name: "USD Coin",
    network: "ERC-20",
    decimals: 2,
    tint: "#2775CA",
    glyph: "$",
    rateId: "usd-coin",
    uriScheme: null,
    requiresDestinationTag: false,
    supportsLightning: false,
  },
  sol: {
    id: "sol",
    symbol: "SOL",
    name: "Solana",
    network: null,
    decimals: 6,
    tint: "#9945FF",
    glyph: "◎",
    rateId: "solana",
    uriScheme: "solana",
    requiresDestinationTag: false,
    supportsLightning: false,
  },
  doge: {
    id: "doge",
    symbol: "DOGE",
    name: "Dogecoin",
    network: null,
    decimals: 8,
    tint: "#C2A633",
    glyph: "Ð",
    rateId: "dogecoin",
    uriScheme: "dogecoin",
    requiresDestinationTag: false,
    supportsLightning: false,
  },
  bch: {
    id: "bch",
    symbol: "BCH",
    name: "Bitcoin Cash",
    network: null,
    decimals: 8,
    tint: "#0AC18E",
    glyph: "Ƀ",
    rateId: "bitcoin-cash",
    uriScheme: "bitcoincash",
    requiresDestinationTag: false,
    supportsLightning: false,
  },
};

/* The four the checkout leads with, in the order they are listed. Everything
   else is behind "More currencies" — a list of nine coins is a decision nobody
   asked to make, and these are the four that get paid in. */
export const FEATURED_CURRENCIES: CryptoCurrencyId[] = ["btc", "xrp", "eth", "ltc"];

/* Every coin, featured ones first. */
export const CURRENCY_ORDER: CryptoCurrencyId[] = [
  ...FEATURED_CURRENCIES,
  ...(Object.keys(CRYPTO_CURRENCIES) as CryptoCurrencyId[]).filter(
    (id) => !FEATURED_CURRENCIES.includes(id),
  ),
];

export function isCryptoCurrencyId(value: unknown): value is CryptoCurrencyId {
  return typeof value === "string" && value in CRYPTO_CURRENCIES;
}

/* ── What is being bought ──────────────────────────────────────────────────
   Two things, and the price of both is read from the credit tables rather than
   sent by the browser. */

export type PaidPlanId = Exclude<PlanId, "free">;

export type Purchase =
  /** A month of a paid plan. */
  | { kind: "plan"; planId: PaidPlanId }
  /** One or more top-up packs. */
  | { kind: "topup"; packs: number };

/** The most packs one order may carry. A cap rather than a limit anybody will
 *  reach: it stops a typo turning a $10 order into a $10,000 one. */
export const MAX_TOP_UP_PACKS = 20;

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return typeof value === "string" && value in PLANS && value !== "free";
}

/** Reads a purchase out of whatever a caller sent, or returns null. */
export function readPurchase(value: unknown): Purchase | null {
  if (!value || typeof value !== "object") return null;
  const input = value as { kind?: unknown; planId?: unknown; packs?: unknown };

  if (input.kind === "plan") {
    return isPaidPlanId(input.planId) ? { kind: "plan", planId: input.planId } : null;
  }

  if (input.kind === "topup") {
    const packs = Number(input.packs);
    if (!Number.isInteger(packs) || packs < 1 || packs > MAX_TOP_UP_PACKS) return null;
    return { kind: "topup", packs };
  }

  return null;
}

/** What the order comes to, in whole US dollars and cents. */
export function purchasePriceUsd(purchase: Purchase): number {
  return purchase.kind === "plan"
    ? PLANS[purchase.planId].monthlyPriceUsd
    : purchase.packs * TOP_UP_PACK.priceUsd;
}

/** The credits the account receives once the payment settles. */
export function purchaseCredits(purchase: Purchase): number {
  return purchase.kind === "plan"
    ? PLANS[purchase.planId].monthlyCredits
    : purchase.packs * TOP_UP_PACK.credits;
}

/** The line item, as it reads on the order summary and in the ledger. */
export function purchaseLabel(purchase: Purchase): string {
  if (purchase.kind === "plan") return PLANS[purchase.planId].name;
  return purchase.packs === 1
    ? `${TOP_UP_PACK.credits} credit top-up`
    : `${purchase.packs} × ${TOP_UP_PACK.credits} credit top-up`;
}

/** How the charge recurs, in the two words a summary line has room for. */
export function purchaseCadence(purchase: Purchase): string {
  return purchase.kind === "plan" ? "monthly" : "one-off";
}

/* ── Converting a price into a coin ────────────────────────────────────────

   A rate is dollars per whole coin. The amount asked for is the price divided
   by the rate, rounded *up* to the coin's quoted precision — see the note at
   the top of the file for why the direction matters.

   The arithmetic is done on integers scaled by the coin's precision rather than
   on the floats directly, because 0.1 + 0.2 is the reason payment code does
   not trust binary floating point with money. */
export function convertUsdToCrypto(amountUsd: number, rateUsd: number, decimals: number): number {
  if (!(rateUsd > 0)) {
    throw new Error("A conversion needs a positive rate.");
  }

  const scale = 10 ** decimals;
  return Math.ceil((amountUsd / rateUsd) * scale) / scale;
}

/* ── Telling one payment from another ──────────────────────────────────────

   A deployment that collects into one static address per coin has a problem
   the address cannot solve: two customers paying $25 both send exactly the
   same amount to exactly the same address, and nothing on the chain says which
   order either payment was for.

   So the amount is the discriminator. Every open order is given an amount no
   other open order on that address has, by nudging it up by the smallest unit
   the coin is quoted in until it is unique — enforced by a unique index rather
   than by hoping, because "probably unique" is not a basis for crediting
   somebody's account.

   It is always up, never down, so a nudged order still covers its own price;
   and it is the smallest quoted unit, so on a coin quoted to eight places the
   difference is a fraction of a cent. */
export function nudgeAmount(amount: number, currency: CryptoCurrencyId, steps: number): number {
  const scale = 10 ** CRYPTO_CURRENCIES[currency].decimals;
  /* Rounded back through the scale so the result is exactly representable at
     the coin's precision — the amount a wallet is asked for has to be the
     amount the index compared. */
  return Math.round(amount * scale + steps) / scale;
}

/** An amount, written the way the coin quotes it — trailing zeroes and all, so
 *  a person copying it into a wallet sees the precision they are sending. */
export function formatCryptoAmount(amount: number, currency: CryptoCurrencyId): string {
  return amount.toFixed(CRYPTO_CURRENCIES[currency].decimals);
}

/** A dollar figure, as the checkout writes it. */
export function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* ── What the QR code carries ──────────────────────────────────────────────

   A wallet URI where the coin has one that wallets agree on, and the bare
   address where it does not. The amount travels in the URI so the payer does
   not have to type it — the commonest way a crypto checkout fails is a person
   sending a slightly wrong amount from memory.

   A Lightning payment is its own thing: the string is an invoice that already
   carries the amount, so it is passed through under the lightning: scheme
   rather than rebuilt. */
export function paymentUri({
  currency,
  address,
  amount,
  destinationTag,
  lightning,
}: {
  currency: CryptoCurrencyId;
  address: string;
  amount: number;
  destinationTag?: string | null;
  lightning?: boolean;
}): string {
  if (lightning) return `lightning:${address}`;

  const spec = CRYPTO_CURRENCIES[currency];
  if (!spec.uriScheme) return address;

  const params = new URLSearchParams({ amount: formatCryptoAmount(amount, currency) });
  if (destinationTag) params.set("dt", destinationTag);

  return `${spec.uriScheme}:${address}?${params.toString()}`;
}

/* ── The order ─────────────────────────────────────────────────────────────

   How long a quote stands. The rate is locked when the order is created, which
   is the only honest way to show a person an amount to send — a figure that
   moves while they are copying it is not a price. Thirty minutes is long enough
   for a confirmation on a slow chain to be on its way and short enough that the
   platform is not holding a stale rate through a market move. */
export const RATE_LOCK_MINUTES = 30;

export type CryptoPaymentStatus =
  /** Created, nothing received. */
  | "awaiting_payment"
  /** The payer says they have sent it; the chain has not confirmed it yet. */
  | "submitted"
  /** Settled. The credits are in the account. */
  | "confirmed"
  /** The rate lock ran out before anything arrived. */
  | "expired"
  /** The processor reported it as failed, underpaid or cancelled. */
  | "failed";

/** Whether an order can still be paid. */
export function isOpenStatus(status: CryptoPaymentStatus): boolean {
  return status === "awaiting_payment" || status === "submitted";
}

/** One coin's answer to "what would this cost me?". A coin the deployment
 *  cannot price or cannot take is absent from a quote rather than present with
 *  a zero in it. */
export type CurrencyQuote = {
  currency: CryptoCurrencyId;
  /** How much of the coin the order comes to at `rateUsd`. */
  amount: number;
  /** Dollars per whole coin at the moment the quote was made. */
  rateUsd: number;
  /** Whether this deployment can take the coin over Lightning as well. */
  lightningAvailable: boolean;
};

/** What the currency-picking step of the checkout renders. */
export type CryptoQuote = {
  purchase: Purchase;
  /** The line item, ready to print. */
  label: string;
  amountUsd: number;
  /** Credits the order buys, once it settles. */
  credits: number;
  /** How long the amounts below stand once an order is created. */
  rateLockMinutes: number;
  currencies: CurrencyQuote[];
};

/** The order as the browser sees it. No wallet address is secret — an address
 *  is meant to be published — but nothing here is trusted by the server either;
 *  every figure is re-derived before it is used to grant anything. */
export type CryptoPayment = {
  id: string;
  status: CryptoPaymentStatus;
  currency: CryptoCurrencyId;
  lightning: boolean;
  address: string;
  destinationTag: string | null;
  amountUsd: number;
  cryptoAmount: number;
  rateUsd: number;
  credits: number;
  purchase: Purchase;
  receiptEmail: string | null;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
};

/** The short reference a person quotes in a support message. The full id is a
 *  UUID, which nobody reads out loud. */
export function orderReference(id: string): string {
  return id.replace(/-/g, "").slice(0, 12).toUpperCase();
}

/* Deliberately permissive: this is the address a receipt goes to, not an
   identity, and a checkout that argues with an unusual address helps nobody.
   It only has to be something that could be delivered to. */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}
