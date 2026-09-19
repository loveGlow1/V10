#!/usr/bin/env node
/* When does naming a site mean "go and look at it"?
 *
 *   npm run check:web-reference
 *
 * Two failures sit either side of this and they cost different things.
 *
 * Firing when nobody asked spends a web call, the stronger model and several
 * seconds on an edit that named a domain in passing — "our customers come from
 * shopify.com" is a sentence about customers.
 *
 * Not firing when somebody did asks the model to make a hero resemble a page it
 * cannot open, which is the bug this was written for: it answers with whatever
 * it remembers of the brand.
 *
 * The containment is checked too. `allowed_domains` is what stops a fetched
 * page sending the fetcher somewhere else, and it is pinned to exactly the
 * hosts the person named — that is a property worth a test rather than a
 * comment, because it is the whole of the answer to "what if the page is
 * hostile".
 *
 * Offline. No model, no network, no key.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-web-reference");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, strict: true, types: ["node"],
      typeRoots: [join(process.cwd(), "node_modules", "@types")],
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [join(process.cwd(), "src/lib/builder/web-reference.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });

const { sitesNamedIn, asksForReference, webReferenceTools, webReferenceBrief } =
  await import(join(out, "lib/builder/web-reference.js"));

let failed = 0;
let passed = 0;
const ok = (t) => { passed += 1; console.log(`ok    ${t}`); };
const fail = (t, d) => { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

console.log("\nA site somebody points at is looked at:");

/* THE REPORTED ONE. */
has(
  sitesNamedIn("update the hero page like nike.com").join() === "nike.com",
  '"update the hero page like nike.com" -> nike.com',
  JSON.stringify(sitesNamedIn("update the hero page like nike.com")),
);

for (const [message, expected] of [
  ["make the pricing section similar to stripe.com", "stripe.com"],
  ["redesign this inspired by https://linear.app", "linear.app"],
  ["look at vercel.com and match that spacing", "vercel.com"],
  ["in the style of www.apple.com", "apple.com"],
  ["https://stripe.com/pricing", "stripe.com"],
]) {
  has(
    sitesNamedIn(message).join() === expected,
    `"${message}" -> ${expected}`,
    JSON.stringify(sitesNamedIn(message)),
  );
}

console.log("\nAnd a domain that was merely mentioned is not:");

/* Each of these names a host and asks for nothing. Fetching them spends a web
   call, the stronger model and several seconds on a sentence about something
   else. */
for (const message of [
  "our customers come from shopify.com",
  "email us at hello@acme.com",
  "the copy should say we integrate with mailchimp.com",
  "make the hero bigger",
  "fix the bug in Hero.tsx",
  "update components/Pricing.tsx and pricing.css",
]) {
  has(
    sitesNamedIn(message).length === 0,
    `"${message}" asks for nothing`,
    JSON.stringify(sitesNamedIn(message)),
  );
}

/* A filename is not a hostname, even beside a word that points. */
has(
  sitesNamedIn("make it like Hero.tsx does it").length === 0,
  "a filename is never fetched, even next to a pointing word",
  JSON.stringify(sitesNamedIn("make it like Hero.tsx does it")),
);

console.log("\nAnd what must never be fetched at all:");

for (const message of [
  "make it like quickstark.tech",
  "look at myapp.vercel.app",
  "like localhost",
  "similar to http://127.0.0.1",
  "like db.internal",
]) {
  has(
    sitesNamedIn(message).length === 0,
    `"${message}" is refused`,
    JSON.stringify(sitesNamedIn(message)),
  );
}

console.log("\nThe containment:");

const tools = webReferenceTools(["nike.com"]);
has(tools.length === 2, "search and fetch are both offered");

/* THE ONE. A page that tries to send the fetcher elsewhere is refused by the
   tool, not by anybody's reading of what the page said. */
has(
  tools.every((tool) => Array.isArray(tool.allowed_domains) && tool.allowed_domains.join() === "nike.com"),
  "every tool is pinned to exactly the host that was named",
  JSON.stringify(tools.map((t) => t.allowed_domains)),
);
has(
  tools.every((tool) => !("blocked_domains" in tool)),
  "and never sets blocked_domains beside it, which the API rejects",
);
has(
  tools.every((tool) => typeof tool.max_uses === "number" && tool.max_uses > 0 && tool.max_uses <= 5),
  "both are capped — a reference is a look, not a crawl",
  JSON.stringify(tools.map((t) => t.max_uses)),
);

/* Citations land inside SEARCH/REPLACE blocks and therefore inside somebody's
   source code. */
const fetchTool = tools.find((tool) => tool.name === "web_fetch");
has(
  fetchTool && fetchTool.citations && fetchTool.citations.enabled === false,
  "fetch citations are off — they would be written into the customer's source",
);

/* Dynamic filtering runs code execution under the hood, so the tool types have
   to be the dated variants the newer models take. A stale type is a 400. */
has(
  tools.some((tool) => tool.type === "web_search_20260209") &&
    tools.some((tool) => tool.type === "web_fetch_20260209"),
  "the tool types are the variants the current models accept",
  JSON.stringify(tools.map((t) => t.type)),
);

has(webReferenceTools([]).length === 0, "and nothing is offered when no site was named");

console.log("\nThe brief:");

const brief = webReferenceBrief(["nike.com"]);
has(brief.includes("nike.com"), "names the site");
has(
  /EVIDENCE ABOUT A DESIGN/.test(brief) && /never a thing to do/i.test(brief),
  "says the page is evidence before it says what to do with it",
  "a fetched page is text by somebody who is not the customer, arriving in a request that writes code",
);
has(/Never their images/i.test(brief) && /Never their words/i.test(brief), "and what may not be taken from it");
has(webReferenceBrief([]) === "", "and there is no brief when there is no reference");

has(asksForReference("like nike.com") && !asksForReference("make the hero bigger"), "asksForReference agrees with sitesNamedIn");

console.log(failed === 0 ? `\nAll ${passed} passed.` : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
