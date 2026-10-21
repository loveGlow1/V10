import type { SupabaseClient } from "@supabase/supabase-js";

/* Money in any currency a payment provider takes — naira through Paystack as
 * much as dollars through Stripe — and what it is worth in US dollars.
 *
 * Every payment is kept as it was made (amount and ISO 4217 currency on its
 * credit_ledger line) and valued in dollars on the day it was made, from
 * public.fx_rates (refreshed daily by /api/cron/fx-rates). The dollar value is
 * what card_status in supabase/schema.sql compares with its $25 line, so ₦40,000
 * through Paystack counts the same as its worth through Stripe.
 *
 * Amounts arrive in a provider's smallest unit, and the providers disagree on
 * what that is:
 *   Stripe    the currency's own minor unit: cents and kobo are ÷100, yen
 *             and CFA francs have none (÷1), dinars have three (÷1000).
 *   Paystack  always the subunit ×100 — kobo for NGN, pesewas for GHS, cents
 *             for ZAR, KES and USD — whatever the currency. */

export type Provider = "stripe" | "paystack";

/* Stripe's zero-decimal and three-decimal currencies:
   https://docs.stripe.com/currencies#zero-decimal */
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

/** An ISO 4217 code, upper case, or null for anything that is not one. */
export function currencyCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
}

/** A provider's smallest-unit amount as an ordinary amount: 4000000 kobo → 40000 (NGN). */
export function fromMinorUnits(minor: number, currency: string, provider: Provider): number {
  const code = currency.toUpperCase();
  if (provider === "paystack") return minor / 100;
  if (ZERO_DECIMAL.has(code)) return minor;
  if (THREE_DECIMAL.has(code)) return minor / 1000;
  return minor / 100;
}

/**
 * What `amount` of `currency` is worth in US dollars today, from fx_rates;
 * null when the currency has no rate yet (it is then valued later, from the
 * amount and currency kept on the line — see funded_usd).
 */
export async function toUsd(service: SupabaseClient, amount: number, currency: string): Promise<number | null> {
  const code = currency.toUpperCase();
  if (code === "USD") return round2(amount);
  const { data } = await service.from("fx_rates").select("usd_per_unit").eq("currency", code).maybeSingle();
  const rate = Number((data as { usd_per_unit?: unknown } | null)?.usd_per_unit);
  return Number.isFinite(rate) && rate > 0 ? round2(amount * rate) : null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Writes what a payment was — its amount and currency, and its dollar value —
 * onto the ledger line its settlement made (found by its dedupe key). For any
 * provider: Stripe's fulfillment calls it, and a Paystack webhook should too,
 * with `paystack:<reference>` as the key. Best effort: the credit is granted
 * already, and a line without an amount is still counted (at the pack rate,
 * or converted later from what is kept here).
 */
export async function recordPayment(
  service: SupabaseClient,
  line: {
    userId: string;
    dedupeKey: string;
    /** In the provider's smallest unit, as it reported it. */
    minorAmount: number;
    currency: string;
    provider: Provider;
    /** The dollar value when the provider already said it (Stripe's currency conversion). */
    knownUsd?: number | null;
  },
): Promise<void> {
  const code = currencyCode(line.currency);
  if (!code || !Number.isFinite(line.minorAmount) || line.minorAmount <= 0) return;
  const amount = fromMinorUnits(line.minorAmount, code, line.provider);
  const usd = line.knownUsd != null && line.knownUsd > 0 ? round2(line.knownUsd) : await toUsd(service, amount, code);
  const { error } = await service
    .from("credit_ledger")
    .update({ paid_amount: amount, paid_currency: code, amount_usd: usd })
    .eq("user_id", line.userId)
    .eq("dedupe_key", line.dedupeKey);
  // eslint-disable-next-line no-console
  if (error) console.warn(`payments: could not record what ${line.dedupeKey} cost:`, error.message);
}

/** Rates feed: units of each currency per US dollar, no key needed. */
const RATES_URL = "https://open.er-api.com/v6/latest/USD";

/** Refreshes fx_rates from the public feed. Returns how many currencies were written. */
export async function refreshFxRates(service: SupabaseClient): Promise<number> {
  const response = await fetch(RATES_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`The rates feed answered ${response.status}.`);
  const body = (await response.json()) as { result?: string; rates?: Record<string, unknown> };
  if (body.result !== "success" || !body.rates) throw new Error("The rates feed sent no rates.");
  const now = new Date().toISOString();
  const rows = Object.entries(body.rates)
    .map(([currency, perUsd]) => ({ currency: currencyCode(currency), perUsd: Number(perUsd) }))
    .filter((row): row is { currency: string; perUsd: number } => Boolean(row.currency) && Number.isFinite(row.perUsd) && row.perUsd > 0)
    .map((row) => ({ currency: row.currency, usd_per_unit: 1 / row.perUsd, updated_at: now }));
  if (rows.length === 0) throw new Error("The rates feed sent no usable rates.");
  const { error } = await service.from("fx_rates").upsert(rows, { onConflict: "currency" });
  if (error) throw error;
  return rows.length;
}
