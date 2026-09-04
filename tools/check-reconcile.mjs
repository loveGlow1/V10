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
  const live = { status: "awaiting_payment", expectedSats: 50_000, expiresAt: NOW + 60_000 };
  const dead = { ...live, expiresAt: NOW - 60_000 };
  const chain = (confirmedSats, pendingSats = 0) => ({ confirmedSats, pendingSats });
  const act = (order, funding) => decideOrder(order, funding, NOW).kind;

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

  console.log(failed === 0 ? "\nreconciliation decides correctly." : `\n${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(1);
}
