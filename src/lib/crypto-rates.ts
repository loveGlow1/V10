import { CRYPTO_CURRENCIES, type CryptoCurrencyId } from "@/lib/crypto-payments";

/* What a coin is worth, in dollars, right now.
 *
 * The one rule this module keeps: it never invents a rate. A missing rate comes
 * back as a missing entry, and the caller refuses the order — because the
 * alternative is quoting somebody an amount of Bitcoin derived from a number
 * nobody checked, and they will send it.
 *
 * So there is no default, no last-known-good fallback that outlives its
 * usefulness, and no "close enough" figure baked into the build. There is a
 * live source, a short cache in front of it, and an explicit override for
 * deployments that price from somewhere else.
 *
 * ── The cache ─────────────────────────────────────────────────────────────
 * Sixty seconds, in memory. It exists to stop a checkout screen listing nine
 * coins from making nine calls to a rate API that rate-limits by IP — not to
 * make prices stale. A serverless deployment gets one cache per warm instance,
 * which is the correct amount of caching for something this cheap to re-fetch.
 *
 * ── The override ──────────────────────────────────────────────────────────
 * CRYPTO_RATE_BTC=95000 and friends pin a coin's rate. That is for a test
 * deployment, a staging environment with no outbound network, or a business
 * that prices from its own desk. A pinned rate is used exactly as given and is
 * never cached, so it can be changed without a redeploy of anything but the
 * variable.
 */

/** Dollars per whole coin, for however many coins could be priced. */
export type RateTable = Partial<Record<CryptoCurrencyId, number>>;

const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 6_000;

const DEFAULT_RATES_ENDPOINT = "https://api.coingecko.com/api/v3/simple/price";

type CacheEntry = { rate: number; readAt: number };

const cache = new Map<CryptoCurrencyId, CacheEntry>();

function pinnedRate(currency: CryptoCurrencyId): number | null {
  const raw = process.env[`CRYPTO_RATE_${CRYPTO_CURRENCIES[currency].symbol}`];
  if (!raw) return null;

  const rate = Number(raw);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function cached(currency: CryptoCurrencyId): number | null {
  const entry = cache.get(currency);
  if (!entry) return null;
  if (Date.now() - entry.readAt > CACHE_TTL_MS) return null;
  return entry.rate;
}

/**
 * The dollar price of each coin asked for.
 *
 * Coins that could not be priced are simply absent from the result. Callers
 * must treat an absence as "cannot sell this coin right now" rather than as a
 * zero — a zero rate divides into an infinite amount of cryptocurrency.
 */
export async function ratesFor(currencies: CryptoCurrencyId[]): Promise<RateTable> {
  const table: RateTable = {};
  const wanted: CryptoCurrencyId[] = [];

  for (const currency of currencies) {
    const pinned = pinnedRate(currency);
    if (pinned !== null) {
      table[currency] = pinned;
      continue;
    }

    const fresh = cached(currency);
    if (fresh !== null) {
      table[currency] = fresh;
      continue;
    }

    wanted.push(currency);
  }

  if (wanted.length === 0) return table;

  const endpoint = process.env.CRYPTO_RATES_URL?.trim() || DEFAULT_RATES_ENDPOINT;
  const url = new URL(endpoint);
  url.searchParams.set("ids", wanted.map((id) => CRYPTO_CURRENCIES[id].rateId).join(","));
  url.searchParams.set("vs_currencies", "usd");

  const headers: Record<string, string> = { accept: "application/json" };
  /* CoinGecko's free tier works without a key and rate-limits hard; a demo key
     raises that ceiling. Sent only when one is configured. */
  const apiKey = process.env.COINGECKO_API_KEY?.trim();
  if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      /* Next caches fetches in route handlers by default. A price must not be
         served from a build-time or route cache; the one in this module is the
         only cache it gets. */
      cache: "no-store",
    });

    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error("crypto rates: the rate source answered", response.status);
      return table;
    }

    const body = (await response.json()) as Record<string, { usd?: unknown }>;

    for (const currency of wanted) {
      const rate = Number(body?.[CRYPTO_CURRENCIES[currency].rateId]?.usd);
      if (!Number.isFinite(rate) || rate <= 0) continue;

      table[currency] = rate;
      cache.set(currency, { rate, readAt: Date.now() });
    }
  } catch (error) {
    /* A timeout, a DNS failure, a deployment with no outbound network. Logged
       and left absent: the checkout says it cannot quote a price, which is
       true, rather than quoting one it made up. */
    // eslint-disable-next-line no-console
    console.error("crypto rates: could not read the rate source:", error);
  }

  return table;
}

/** One coin's rate, or null. */
export async function rateFor(currency: CryptoCurrencyId): Promise<number | null> {
  const table = await ratesFor([currency]);
  return table[currency] ?? null;
}
