import { createHmac, timingSafeEqual } from "node:crypto";

import {
  CRYPTO_CURRENCIES,
  CURRENCY_ORDER,
  isCryptoCurrencyId,
  type CryptoCurrencyId,
  type CryptoPayment,
  type CryptoPaymentStatus,
  type Purchase,
} from "@/lib/crypto-payments";

/* Where money is sent, and who is allowed to say it arrived.
 *
 * Two secrets-adjacent things live here, and neither may reach the browser:
 *
 *   the wallets  — an address is public by nature, but *which* address this
 *                  deployment collects on is configuration, and a build that
 *                  hard-coded one would send real payments to whichever
 *                  address happened to be committed;
 *   the callback secret — the only thing standing between "the chain
 *                  confirmed it" and anyone with the webhook URL granting
 *                  themselves credits.
 *
 * A coin with no address configured is not offered. That is the whole gate:
 * there is no fallback address, no placeholder and no default, because every
 * one of those is a way for a payment to be collected by somebody who is not
 * this deployment.
 */

/** Where payments in a given coin are collected, and how they are labelled. */
export type CryptoWallet = {
  currency: CryptoCurrencyId;
  address: string;
  /** XRP and the other tag chains: the payment is only credited when this
   *  travels with it. Null where the chain has no such notion. */
  destinationTag: string | null;
  /** A Lightning address or LNURL, when this deployment can take the coin over
   *  Lightning as well as on-chain. */
  lightningAddress: string | null;
};

/* Env var per coin rather than one blob of JSON: a hosting dashboard shows
   which of these is set, and a malformed JSON string would take the whole
   checkout down instead of one currency. */
function walletEnv(currency: CryptoCurrencyId): string {
  return `CRYPTO_WALLET_${CRYPTO_CURRENCIES[currency].symbol}`;
}

function lightningEnv(currency: CryptoCurrencyId): string {
  return `CRYPTO_LIGHTNING_${CRYPTO_CURRENCIES[currency].symbol}`;
}

function read(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The wallet for one coin, or null when this deployment does not take it. */
export function walletFor(currency: CryptoCurrencyId): CryptoWallet | null {
  const address = read(walletEnv(currency));
  if (!address) return null;

  const spec = CRYPTO_CURRENCIES[currency];

  return {
    currency,
    address,
    destinationTag: spec.requiresDestinationTag ? read(`${walletEnv(currency)}_TAG`) : null,
    lightningAddress: spec.supportsLightning ? read(lightningEnv(currency)) : null,
  };
}

/** The coins this deployment can actually be paid in, in checkout order. */
export function configuredCurrencies(): CryptoCurrencyId[] {
  return CURRENCY_ORDER.filter((id) => walletFor(id) !== null);
}

/** Whether crypto checkout is available at all. False on a deployment with no
 *  wallet configured, which is answered as a 503 rather than an empty list of
 *  currencies — "we cannot take payment right now" is a different thing from
 *  "there are no coins". */
export const isCryptoCheckoutConfigured = () => configuredCurrencies().length > 0;

/* ── The settlement callback ───────────────────────────────────────────────

   A payment is only ever settled by a caller that can prove it holds the
   shared secret. The proof is an HMAC over the exact bytes of the request
   body — over the raw text, not the parsed object, because two different byte
   strings can parse to the same JSON and only one of them was signed.

   Same shape as build-signature.ts: a timestamp, a dot, the digest. The
   timestamp is inside the signed payload, so a captured callback cannot be
   replayed a day later with its timestamp edited. */

const CALLBACK_MAX_AGE_MS = 5 * 60 * 1000;

function callbackSecret(): string | undefined {
  return process.env.CRYPTO_PAYMENTS_WEBHOOK_SECRET;
}

export const isSettlementCallbackConfigured = () => Boolean(callbackSecret());

/** The header a settlement callback carries its signature in. */
export const SETTLEMENT_SIGNATURE_HEADER = "x-crypto-signature";

/** Signs a callback body. Exists so an integration — or a test — can produce a
 *  signature the same way the verifier expects one. */
export function signSettlement(rawBody: string, issuedAt = Date.now()): string | null {
  const key = callbackSecret();
  if (!key) return null;

  const mac = createHmac("sha256", key).update(`${issuedAt}\n${rawBody}`).digest("hex");
  return `${issuedAt}.${mac}`;
}

/**
 * Whether `signature` was made over exactly these bytes, with this
 * deployment's secret, recently.
 *
 * Refuses when no secret is configured. An unverifiable callback is the one
 * thing this exists to stop, so "nothing to check against" has to mean no
 * rather than yes.
 */
export function verifySettlement(rawBody: string, signature: unknown): boolean {
  const key = callbackSecret();
  if (!key || typeof signature !== "string") return false;

  const [issuedAtRaw, mac] = signature.split(".");
  const issuedAt = Number(issuedAtRaw);
  if (!mac || !Number.isFinite(issuedAt)) return false;

  /* Both directions: a timestamp in the future is not a clock to be trusted,
     it is a signature that would outlive its window. */
  if (Math.abs(Date.now() - issuedAt) > CALLBACK_MAX_AGE_MS) return false;

  const expected = createHmac("sha256", key).update(`${issuedAt}\n${rawBody}`).digest("hex");

  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ── The order row ─────────────────────────────────────────────────────────

   crypto_payments as the routes read it, and the one place a row is turned
   into the shape the browser is given. Written once so two endpoints cannot
   disagree about what an order looks like — the checkout polls one of them and
   renders the other. */

/* One string literal rather than a joined one on purpose: supabase-js reads the
   select list at the type level, and a concatenation widens to `string`, which
   it cannot parse and answers with GenericStringError. */
// prettier-ignore
export const PAYMENT_COLUMNS = "id, user_id, status, purchase_kind, plan_id, packs, credits, amount_usd, currency, lightning, address, destination_tag, crypto_amount, rate_usd, receipt_email, tx_reference, failure_reason, created_at, expires_at, submitted_at, confirmed_at" as const;

export type CryptoPaymentRow = {
  id: string;
  user_id: string;
  status: string;
  purchase_kind: string;
  plan_id: string | null;
  packs: number | null;
  credits: number | string;
  amount_usd: number | string;
  currency: string;
  lightning: boolean;
  address: string;
  destination_tag: string | null;
  crypto_amount: number | string;
  rate_usd: number | string;
  receipt_email: string | null;
  tx_reference?: string | null;
  failure_reason?: string | null;
  created_at: string;
  expires_at: string;
  submitted_at?: string | null;
  confirmed_at: string | null;
};

const STATUSES: CryptoPaymentStatus[] = [
  "awaiting_payment",
  "submitted",
  "confirmed",
  "expired",
  "failed",
];

function readStatus(value: string): CryptoPaymentStatus {
  /* A row can only hold one of these — the column has a check constraint — so
     an unknown value means the database and this file have gone out of step.
     Reported as failed rather than guessed at: an order nobody can classify is
     not an order anybody should be told to pay. */
  return (STATUSES as string[]).includes(value) ? (value as CryptoPaymentStatus) : "failed";
}

/** The order as the browser is given it. */
export function paymentFromRow(row: CryptoPaymentRow): CryptoPayment {
  const purchase: Purchase =
    row.purchase_kind === "plan"
      ? { kind: "plan", planId: (row.plan_id ?? "standard") as "standard" | "pro" }
      : { kind: "topup", packs: Number(row.packs ?? 1) };

  return {
    id: row.id,
    status: readStatus(row.status),
    /* Same reasoning as the status: the column is written from this file's own
       list, so anything else is a mismatch rather than a currency. */
    currency: isCryptoCurrencyId(row.currency) ? row.currency : "btc",
    lightning: Boolean(row.lightning),
    address: row.address,
    destinationTag: row.destination_tag,
    amountUsd: Number(row.amount_usd),
    cryptoAmount: Number(row.crypto_amount),
    rateUsd: Number(row.rate_usd),
    credits: Number(row.credits),
    purchase,
    receiptEmail: row.receipt_email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at,
  };
}
