#!/usr/bin/env node
/* Checks the crypto checkout end to end, before a customer does it for you.
 *
 *   npm run check:payments                — checks this machine's configuration
 *   npm run check:payments https://site   — also asks that deployment's /api/health
 *
 * Every way this feature fails is invisible from the outside until money is
 * involved, and each one fails differently:
 *
 *   no wallet set          → the modal says "not switched on for this deployment"
 *   rate source unreachable→ the modal says "live prices are unavailable"
 *   no service role key    → the coin list renders and "Pay with" then fails
 *   no callback secret     → everything works and nobody is ever credited
 *
 * That last one is the reason this script exists. It is the only failure that
 * looks like success from every screen, and the first sign of it is somebody
 * asking where their credits are.
 *
 * A wallet address is checked as far as it can be: anything Base58Check —
 * a Bitcoin address beginning 1 or 3, and the same family on Litecoin, Dogecoin
 * and Bitcoin Cash — has a checksum, and a checksum catches the one mistake
 * that cannot be undone, which is a typo in the address money is sent to.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

/* The app reads these through Next, which layers .env.local over .env. */
function readEnv(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [".env.local", ".env"]) {
    let text;
    try {
      text = readFileSync(resolvePath(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    const match = text.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, "m"));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/* Kept in step with CRYPTO_CURRENCIES in src/lib/crypto-payments.ts. */
const COINS = {
  BTC: { name: "Bitcoin", rateId: "bitcoin" },
  XRP: { name: "XRP", rateId: "ripple" },
  ETH: { name: "Ethereum", rateId: "ethereum" },
  LTC: { name: "Litecoin", rateId: "litecoin" },
  USDT: { name: "Tether", rateId: "tether" },
  USDC: { name: "USD Coin", rateId: "usd-coin" },
  SOL: { name: "Solana", rateId: "solana" },
  DOGE: { name: "Dogecoin", rateId: "dogecoin" },
  BCH: { name: "Bitcoin Cash", rateId: "bitcoin-cash" },
};

let failures = 0;
let warnings = 0;

function line(mark, text, detail) {
  console.log(`${mark} ${text}${detail ? `\n     ${detail.split("\n").join("\n     ")}` : ""}`);
}
const pass = (text, detail) => line("PASS", text, detail);
const info = (text, detail) => line("    ", text, detail);
function warn(text, detail) {
  warnings += 1;
  line("WARN", text, detail);
}
function fail(text, detail) {
  failures += 1;
  line("FAIL", text, detail);
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Verifies a Base58Check address, or returns null when it is not one. */
function base58CheckValid(address) {
  if (![...address].every((ch) => BASE58.includes(ch))) return null;

  let num = 0n;
  for (const ch of address) num = num * 58n + BigInt(BASE58.indexOf(ch));

  let hex = num.toString(16);
  if (hex.length % 2) hex = `0${hex}`;

  let leading = 0;
  for (const ch of address) {
    if (ch === "1") leading += 1;
    else break;
  }

  const bytes = Buffer.concat([Buffer.alloc(leading, 0), Buffer.from(hex, "hex")]);
  if (bytes.length !== 25) return null;

  const payload = bytes.subarray(0, 21);
  const sha = (b) => createHash("sha256").update(b).digest();

  return bytes.subarray(21).equals(sha(sha(payload)).subarray(0, 4));
}

console.log("\nCrypto checkout\n");

/* ── The wallets ─────────────────────────────────────────────────────────── */

const configured = [];

for (const [ticker, coin] of Object.entries(COINS)) {
  const address = readEnv(`CRYPTO_WALLET_${ticker}`);
  if (!address) continue;

  configured.push({ ticker, ...coin, address });

  const checksum = base58CheckValid(address);

  if (checksum === true) {
    pass(`${coin.name} collects at ${address}`, "Base58Check verifies.");
  } else if (checksum === false) {
    fail(
      `${coin.name} address fails its checksum: ${address}`,
      "This is a typo, not a valid address. Anything sent to it is gone.",
    );
  } else {
    /* bech32, hex, or a chain with its own format. Not something this script
       can verify, and saying so is better than implying it checked. */
    pass(`${coin.name} collects at ${address}`, "Format not checkable here — confirm it in your wallet.");
  }

  const tag = readEnv(`CRYPTO_WALLET_${ticker}_TAG`);
  if (ticker === "XRP" && !tag) {
    warn(
      "No destination tag for XRP.",
      "Fine for a wallet you control outright. On an exchange or any shared\n" +
        "wallet, a payment without its tag is not credited to you.",
    );
  }

  const lightning = readEnv(`CRYPTO_LIGHTNING_${ticker}`);
  if (lightning) info(`${coin.name} also takes Lightning at ${lightning}`);
}

if (configured.length === 0) {
  fail(
    "No wallet is configured, so the checkout offers nothing.",
    'The modal shows "Crypto payments are not switched on for this deployment".\n' +
      "Set CRYPTO_WALLET_BTC (or another) — see docs/PAYMENTS.md.",
  );
}

/* ── The rate source ─────────────────────────────────────────────────────── */

if (configured.length > 0) {
  const pinned = configured.filter((coin) => readEnv(`CRYPTO_RATE_${coin.ticker}`));
  for (const coin of pinned) {
    warn(
      `${coin.name} is priced from CRYPTO_RATE_${coin.ticker}, not the market.`,
      "Correct for staging or a fixed desk rate. On a production deployment this\n" +
        "is a price that does not move while the market does.",
    );
  }

  const live = configured.filter((coin) => !readEnv(`CRYPTO_RATE_${coin.ticker}`));

  if (live.length > 0) {
    const endpoint = readEnv("CRYPTO_RATES_URL") || "https://api.coingecko.com/api/v3/simple/price";
    const url = new URL(endpoint);
    url.searchParams.set("ids", live.map((coin) => coin.rateId).join(","));
    url.searchParams.set("vs_currencies", "usd");

    const headers = { accept: "application/json" };
    const apiKey = readEnv("COINGECKO_API_KEY");
    if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });

      if (!response.ok) {
        fail(
          `The rate source answered HTTP ${response.status}.`,
          response.status === 429
            ? "Rate-limited. Set COINGECKO_API_KEY to raise the ceiling — shared hosting\n" +
              "  IPs hit this sooner than a laptop does."
            : 'Without a rate the checkout says "live prices are unavailable" and sells\n' +
              "  nothing. Pin one with CRYPTO_RATE_<TICKER> if this host has no outbound\n" +
              "  network.",
        );
      } else {
        const body = await response.json();
        for (const coin of live) {
          const rate = Number(body?.[coin.rateId]?.usd);
          if (Number.isFinite(rate) && rate > 0) {
            pass(`${coin.name} priced at $${rate.toLocaleString("en-US")}`);
          } else {
            fail(`The rate source returned no price for ${coin.name}.`);
          }
        }
      }
    } catch (error) {
      fail(
        "Could not reach the rate source at all.",
        `${error?.message ?? error}\n` +
          "Nothing can be sold without a price. If this host has no outbound network,\n" +
          "pin rates with CRYPTO_RATE_<TICKER>.",
      );
    }
  }
}

/* ── Settlement ──────────────────────────────────────────────────────────── */

if (readEnv("CRYPTO_PAYMENTS_WEBHOOK_SECRET")) {
  pass("A settlement callback secret is set.");
} else {
  fail(
    "CRYPTO_PAYMENTS_WEBHOOK_SECRET is not set.",
    "Every settlement call is refused, so payments can be made and never credited —\n" +
      "the one failure that looks like success from every screen.\n" +
      'Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
  );
}

if (readEnv("SUPABASE_SERVICE_ROLE_KEY")) {
  pass("The service role key is set, so orders can be written.");
} else {
  fail(
    "SUPABASE_SERVICE_ROLE_KEY is not set.",
    "The currency list renders and pressing Pay then fails: crypto_payments is not\n" +
      "writable from a browser, deliberately. npm run settle needs it too.",
  );
}

/* ── The deployment, if one was named ────────────────────────────────────── */

const target = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

if (target) {
  const base = target.replace(/\/+$/, "");
  console.log("");
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10_000) });
    const health = await response.json();

    /* The label is a noun phrase, so the same one reads correctly either way —
       "a wallet is set" / "a wallet is NOT set". */
    const say = (ok, label, remedy) =>
      ok ? pass(`${base}: ${label} is set`) : fail(`${base}: ${label} is NOT set`, remedy);

    say(
      health.cryptoCheckoutConfigured,
      "a wallet",
      "Set CRYPTO_WALLET_BTC in the hosting environment — env vars are read at build\n" +
        "as well as runtime, so redeploy rather than restart.",
    );
    say(
      health.cryptoSettlementConfigured,
      "the settlement secret",
      "Set CRYPTO_PAYMENTS_WEBHOOK_SECRET there and redeploy.",
    );
    say(
      health.storageConfigured,
      "the service role key",
      "Set SUPABASE_SERVICE_ROLE_KEY there and redeploy.",
    );
  } catch (error) {
    fail(`Could not read ${base}/api/health`, String(error?.message ?? error));
  }
}

console.log("");

if (failures > 0) {
  console.log(`${failures} thing${failures === 1 ? "" : "s"} to fix before this can take payment.\n`);
  process.exit(1);
}

console.log(
  warnings > 0
    ? `Ready to take payment, with ${warnings} thing${warnings === 1 ? "" : "s"} worth a look.\n`
    : "Ready to take payment.\n",
);
