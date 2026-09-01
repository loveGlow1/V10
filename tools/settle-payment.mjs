#!/usr/bin/env node
/* Confirming a crypto payment by hand.
 *
 *   npm run settle                      — lists every order still waiting
 *   npm run settle -- <reference|id>    — settles that one, after showing it
 *   npm run settle -- <id> <txid> --yes — settles it unprompted, with a receipt
 *
 * Why this exists: on a deployment that collects into its own static wallets,
 * nothing is watching the chain. The app can create an order, show an address
 * and record that the payer says they sent it — but the last step, "the money
 * arrived", is a human looking at a wallet. This is that step, and it is the
 * only way credits are released short of a processor calling the webhook.
 *
 * It does not touch the database directly, deliberately. It makes the same
 * signed call to /api/payments/crypto/webhook that a payment processor would,
 * so the path that grants credits is the same path in both cases — one
 * settlement route, tested by every use of either. That also means this script
 * cannot do anything the webhook cannot: it can confirm an order, and it cannot
 * invent one, change an amount, or pay out twice.
 *
 * What to check before running it, because nothing here can check it for you:
 * that a payment of EXACTLY the amount the order names arrived at the address
 * the order names. The amount is the identifier — every open order on an
 * address is given a distinct one — so an approximate match is not a match.
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline/promises";

/* The app reads these through Next, which layers .env.local over .env. Read
   them the same way, so this agrees with the running deployment. */
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

/* Kept in step with SETTLEMENT_SIGNATURE_HEADER in
   src/lib/crypto-payments-server.ts. */
const SIGNATURE_HEADER = "x-crypto-signature";

const OPEN_STATUSES = "(awaiting_payment,submitted)";

function die(message, detail) {
  console.error(`\n${message}${detail ? `\n    ${detail}` : ""}\n`);
  process.exit(1);
}

const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
const secret = readEnv("CRYPTO_PAYMENTS_WEBHOOK_SECRET");
/* Where the running app is. Defaults to a local dev server; point it at the
   deployment to settle a real order. */
const appUrl = (readEnv("APP_URL") ?? "http://localhost:3000").replace(/\/+$/, "");

if (!supabaseUrl || !serviceKey) {
  die(
    "Cannot read orders: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.",
    "crypto_payments is readable only by its owner and the service role — see docs/PAYMENTS.md.",
  );
}

/* PostgREST rather than a Supabase client: one dependency-free GET, and the
   service key is what RLS defers to. */
async function readOrders(filter) {
  const url = new URL(`${supabaseUrl}/rest/v1/crypto_payments`);
  url.searchParams.set(
    "select",
    "id,status,purchase_kind,plan_id,packs,credits,amount_usd,currency,lightning,address,crypto_amount,receipt_email,created_at,expires_at",
  );
  url.searchParams.set("order", "created_at.desc");
  for (const [key, value] of Object.entries(filter)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });

  if (!response.ok) {
    die(`Could not read orders (HTTP ${response.status}).`, await response.text());
  }

  return response.json();
}

function describe(order) {
  const what =
    order.purchase_kind === "plan"
      ? `${order.plan_id} plan`
      : `${order.packs} × top-up (${order.credits} credits)`;

  const reference = order.id.replace(/-/g, "").slice(0, 12).toUpperCase();
  const expired = new Date(order.expires_at).getTime() < Date.now();

  return [
    `  ${reference}   ${order.status}${expired ? " (quote expired)" : ""}`,
    `    ${what} — $${order.amount_usd}, ${order.credits} credits`,
    `    wants ${order.crypto_amount} ${order.currency.toUpperCase()}${order.lightning ? " over Lightning" : ""}`,
    `    to    ${order.address}`,
    `    id    ${order.id}`,
    order.receipt_email ? `    email ${order.receipt_email}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function list() {
  const orders = await readOrders({ status: `in.${OPEN_STATUSES}` });

  if (orders.length === 0) {
    console.log("\nNo orders are waiting on a payment.\n");
    return;
  }

  console.log(`\n${orders.length} order${orders.length === 1 ? "" : "s"} waiting on a payment:\n`);
  for (const order of orders) console.log(`${describe(order)}\n`);
  console.log("Settle one with:  npm run settle -- <id> [transaction reference]\n");
  console.log(
    "Check the amount exactly. Every open order on an address is given a distinct\n" +
      "amount, and that amount is the only thing that says which order a payment was for.\n",
  );
}

async function settle(idOrReference, txReference, assumeYes) {
  /* A full uuid addresses the row directly; anything else is treated as the
     short reference a person reads off the screen. */
  const orders = /^[0-9a-f-]{36}$/i.test(idOrReference)
    ? await readOrders({ id: `eq.${idOrReference}` })
    : (await readOrders({ status: `in.${OPEN_STATUSES}` })).filter(
        (order) =>
          order.id.replace(/-/g, "").slice(0, 12).toUpperCase() === idOrReference.toUpperCase(),
      );

  if (orders.length === 0) die(`No order matches "${idOrReference}".`);
  if (orders.length > 1) die(`"${idOrReference}" matches more than one order. Use the full id.`);

  const order = orders[0];

  console.log(`\nAbout to release credits for:\n\n${describe(order)}\n`);

  if (order.status === "confirmed") {
    console.log("This order is already settled. Nothing to do.\n");
    return;
  }

  if (!assumeYes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `Has exactly ${order.crypto_amount} ${order.currency.toUpperCase()} arrived at that address? [y/N] `,
    );
    rl.close();

    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log("\nLeft alone.\n");
      return;
    }
  }

  if (!secret) {
    die(
      "CRYPTO_PAYMENTS_WEBHOOK_SECRET is not set, so the settlement call cannot be signed.",
      "The webhook refuses every unsigned call — that is what stops anyone who finds the URL\n" +
        "    from granting themselves credits. See docs/PAYMENTS.md.",
    );
  }

  const rawBody = JSON.stringify({
    paymentId: order.id,
    status: "confirmed",
    ...(txReference ? { txReference } : {}),
  });

  const issuedAt = Date.now();
  const mac = createHmac("sha256", secret).update(`${issuedAt}\n${rawBody}`).digest("hex");

  const response = await fetch(`${appUrl}/api/payments/crypto/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SIGNATURE_HEADER]: `${issuedAt}.${mac}`,
    },
    body: rawBody,
  });

  const body = await response.text();

  if (!response.ok) {
    die(
      `The app refused the settlement (HTTP ${response.status}).`,
      `${body}\n    Called ${appUrl}/api/payments/crypto/webhook — set APP_URL to point elsewhere.`,
    );
  }

  console.log(`\nSettled. The credits are in the account.\n    ${body}\n`);
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const assumeYes = args.includes("--yes");
const positional = args.filter((arg) => !arg.startsWith("--"));

if (positional.length === 0) {
  await list();
} else {
  await settle(positional[0], positional[1], assumeYes);
}
