#!/usr/bin/env node
/* The sweep decides the right thing about a payment.
 *
 *   npm run check:reconcile
 *
 * decideOrder is the one place in the system where being wrong costs money in
 * both directions at once: settle an order nobody paid and credits are given
 * away, expire one somebody did pay and a customer is told their money never
 * arrived. It runs unattended, every minute, against real orders.
 *
 * The case this exists for is the quiet one. When no block explorer answers,
 * the funding read comes back null — and null is not zero, though it looks
 * exactly like it at every call site. Read it as zero and every paid order gets
 * expired the next time mempool.space has a bad minute. There is no error in
 * that path, nothing throws, and the first sign is a customer who paid.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-reconcile");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, types: ["node"],
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [
      join(process.cwd(), "src/lib/reconcile-decision.ts"),
      join(process.cwd(), "src/lib/chain-watch.ts"),
    ],
  }),
);

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const is = (got, want, t) => (got === want ? ok(t, String(got)) : fail(t, `expected ${want}, got ${got}`));

try {
  execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

  const rewrite = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { rewrite(path); continue; }
      if (!path.endsWith(".js")) continue;
      const depth = path.slice(out.length + 1).split("/").length - 1;
      const prefix = depth === 0 ? "./" : "../".repeat(depth);
      writeFileSync(path, readFileSync(path, "utf8").replace(
        /(["'])@\/([^"']+)\1/g, (_, q, rest) => {
          const asFile = join(out, `${rest}.js`);
          const target = existsSync(asFile) ? `${rest}.js` : `${rest}/index.js`;
          return `${q}${prefix}${target}${q}`;
        }));
    }
  };
  rewrite(out);

  const { decideOrder } = await import(join(out, "lib/reconcile-decision.js"));
  const { btcToSats } = await import(join(out, "lib/chain-watch.js"));

  const NOW = 1_800_000_000_000;
  /* A dedicated address — one BTCPay derived for this order alone. */
  const live = {
    status: "awaiting_payment", expectedSats: 50_000, expiresAt: NOW + 60_000, sharedAddress: false,
  };
  const dead = { ...live, expiresAt: NOW - 60_000 };
  /* The same order on the shared static address. */
  const shared = { ...live, sharedAddress: true };
  const sharedDead = { ...dead, sharedAddress: true };

  let txSeq = 0;
  const pay = (sats, confirmed = true) => ({ txid: `tx${++txSeq}`, sats, confirmed });

  /* Totals with no itemisation — how a dedicated address reads. */
  const chain = (confirmedSats, pendingSats = 0) => ({
    confirmedSats, pendingSats,
    payments: [
      ...(confirmedSats > 0 ? [pay(confirmedSats, true)] : []),
      ...(pendingSats > 0 ? [pay(pendingSats, false)] : []),
    ],
  });

  /* Itemised — how a shared address must be read. */
  const chainOf = (...payments) => ({
    confirmedSats: payments.filter((p) => p.confirmed).reduce((n, p) => n + p.sats, 0),
    pendingSats: payments.filter((p) => !p.confirmed).reduce((n, p) => n + p.sats, 0),
    payments,
  });

  const act = (order, funding, used) => decideOrder(order, funding, NOW, used).kind;

  // ── Satoshis ────────────────────────────────────────────────────────────
  /* The orders carry BTC to ten decimal places; the chain counts whole
     satoshis. A conversion off by a factor of anything settles nothing or
     everything. */
  is(btcToSats(1), 100_000_000, "one whole coin");
  is(btcToSats(0.0003), 30_000, "a typical order");
  is(btcToSats(0.000000005), 1, "rounds to the nearest satoshi");

  // ── Nobody answered ─────────────────────────────────────────────────────
  /* The whole reason this file exists. */
  is(act(live, null), "leave", "an unreadable chain leaves a live order alone");
  is(act(dead, null), "leave", "an unreadable chain does NOT expire an order");

  // ── Paying ──────────────────────────────────────────────────────────────
  is(act(live, chain(50_000)), "settle", "the exact amount, confirmed, settles");
  is(act(live, chain(60_000)), "settle", "an overpayment settles");
  is(act(dead, chain(50_000)), "settle", "paid in full settles even after expiry");
  is(act(live, chain(49_999)), "leave", "one satoshi short does not settle");

  // ── Not paying yet ──────────────────────────────────────────────────────
  is(act(live, chain(0, 50_000)), "mark-submitted", "coin in the mempool is recorded");
  is(
    act({ ...live, status: "submitted" }, chain(0, 50_000)),
    "leave",
    "an order already marked submitted is not marked again",
  );
  is(act(live, chain(0)), "leave", "an empty address on a live order waits");

  // ── Ending ──────────────────────────────────────────────────────────────
  is(act(dead, chain(0)), "expire", "expired and never paid ends the order");
  is(act(dead, chain(20_000)), "strand", "an underpayment after expiry needs a person");
  is(act(dead, chain(0, 50_000)), "strand", "unconfirmed coin after expiry needs a person");

  /* Never resolved by guessing. Crediting a short payment either shorts the
     customer or pays out more than arrived, and both are somebody's judgement
     rather than a calculation. */
  is(act(dead, chain(49_999)), "strand", "one satoshi short after expiry is stranded, not expired");

  // ── An order that cannot be satisfied ───────────────────────────────────
  /* The table forbids it, so reaching here means something upstream is broken —
     and 0 >= 0 would settle every such order for free. */
  is(act({ ...live, expectedSats: 0 }, chain(0)), "strand", "an order asking for nothing is stranded");

  // ── The shared address ──────────────────────────────────────────────────
  /* The bug this section exists for, found by asking what happens when a $25
     order lands on the static address.
     
     A shared address's total is every order that ever used it added together.
     Judged against that total, an order settles the moment ANYBODY has ever
     paid the address — so one real payment makes every later order free. The
     amount is the identifier there, which is what the create route's nudging is
     for, and it means nothing unless the chain is read payment by payment. */

  is(
    act(shared, chainOf(pay(50_000))),
    "settle",
    "a shared address settles on a payment of the exact amount",
  );

  /* The one that was wrong. Total is 90,000 — far more than the 50,000 asked —
     and not one satoshi of it was sent against this order. */
  is(
    act(shared, chainOf(pay(40_000), pay(50_001))),
    "leave",
    "a shared address does NOT settle on someone else's payments",
  );

  is(
    act(sharedDead, chainOf(pay(40_000), pay(50_001))),
    "expire",
    "expired with only other orders' money on the address is an ordinary expiry",
  );

  /* An overpayment is unambiguous on a dedicated address and unidentifiable on
     a shared one: nothing says which order it was meant for. */
  is(act(live, chain(60_000)), "settle", "a dedicated address settles on an overpayment");
  is(
    act(shared, chainOf(pay(60_000))),
    "leave",
    "a shared address does not settle on an amount it did not quote",
  );

  is(
    act(sharedDead, chainOf(pay(60_000))),
    "expire",
    "an unmatched overpayment after expiry is not this order's to claim",
  );

  is(
    act(shared, chainOf(pay(50_000, false))),
    "mark-submitted",
    "a shared address sees its own payment arrive in the mempool",
  );

  is(
    act(shared, chainOf(pay(40_000, false))),
    "leave",
    "someone else's mempool payment is not this order arriving",
  );

  /* Amounts are unique among OPEN orders, not across history. Without this, a
     transaction that settled a $25 order last month would settle the next one
     asking the same nudged figure. */
  const settledAlready = chainOf(pay(50_000));
  const usedTxid = new Set(settledAlready.payments.map((p) => p.txid));
  is(
    act(shared, settledAlready, usedTxid),
    "leave",
    "a payment already credited to another order cannot settle this one",
  );
  is(
    act(sharedDead, settledAlready, usedTxid),
    "expire",
    "and after expiry it is an expiry, not a claim on spent money",
  );

  /* Both readings still agree that an unreadable chain settles nothing. */
  is(act(shared, null), "leave", "an unreadable chain leaves a shared order alone too");

  console.log(failed === 0 ? "\nreconciliation decides correctly." : `\n${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(1);
}
