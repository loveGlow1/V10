#!/usr/bin/env node
/* Which model an edit goes to, and why.
 *
 *   npm run check:edit-routing
 *
 * editModelFor had two signals, both about SIZE: how long the instruction is
 * and how big the page is. They are necessary, they are not sufficient, and
 * the gap was measurable — of ten worked examples in the routing brief, SIX
 * went to the cheap model against its own judgement. All six were short
 * sentences asking for something structural:
 *
 *     "Add authentication, database, roles and payments."       6 words
 *     "Redesign the entire landing page."                       5 words
 *
 * A word counter cannot tell those from "change the button text", and the page
 * is often small, so both signals read zero while the work is enormous.
 *
 * THE TWO HALVES OF THIS FILE ARE EQUALLY IMPORTANT. Escalating correctly is
 * half the job; the other half is not escalating "change the login button
 * text", because a rule that reaches for the expensive model whenever it sees
 * the word `login` costs more than it saves and stops being worth having.
 *
 * The bias, where a case is genuinely ambiguous, is towards the strong model —
 * on the reasoning editModelFor already carried: a big edit sent to the cheap
 * model half-lands, the customer asks again, and the retry goes to the strong
 * model anyway. A false escalation costs one price difference; a false economy
 * costs two calls.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-edit-routing");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  extends: join(root, "tsconfig.json"),
  compilerOptions: {
    noEmit: false, outDir: out, rootDir: join(root, "src"),
    module: "commonjs", moduleResolution: "node",
    declaration: false, incremental: false, plugins: [],
    baseUrl: root, paths: { "@/*": ["src/*"] },
  },
  include: [join(root, "src/lib/builder/edit.ts")],
}, null, 2));
try {
  execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "pipe"] });
} catch { /* the emit is what matters; real type errors are the repo's own tsc */ }
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));
const shim = join(out, "node_modules");
mkdirSync(shim, { recursive: true });
try { execFileSync("ln", ["-sfn", out, join(shim, "@")]); } catch { /* already there */ }

const require = createRequire(import.meta.url);
const { editModelFor, EDIT_MODEL, EDIT_MODEL_STRONG } =
  require(join(out, "lib/builder/edit.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };

/* A page small enough that the size signals stay quiet, so each case is
   decided by the SHAPE of the ask and nothing else. */
const SMALL = `<html>${"x".repeat(20_000)}</html>`;

function routes(prompt, wantStrong, label, page = SMALL) {
  const got = editModelFor(prompt, page);
  const isStrong = got === EDIT_MODEL_STRONG;
  if (isStrong === wantStrong) ok(`${wantStrong ? "strong" : "fast  "} · ${label}`);
  else fail(`${wantStrong ? "strong" : "fast  "} · ${label}`,
    `${JSON.stringify(prompt)} went to ${got}`);
}

// ── Structural work, however short the sentence ───────────────────────────
//
// Every one of these is a real example from the routing brief, and every one
// used to go to the cheap model.

console.log("— structural asks must reach the strong model —");
routes("Add authentication, database and customer dashboard.", true, "auth + database + dashboard");
routes("Add authentication, database, roles and payments.", true, "auth + roles + payments");
routes("Convert this existing app into a multi-tenant SaaS with authentication and role-based permissions.",
  true, "THE ONE: 14 words, an entire re-architecture");
routes("Redesign the entire landing page.", true, "the entire page");
routes("Redesign this section.", true, "a redesign, even of one section");
routes("Rebuild this entire page from this screenshot.", true, "rebuild from a reference");
routes("set up stripe checkout", true, "a two-word verb still counts");
routes("wire the contact form to a database table", true, "wiring to storage");
routes("remove the sign-in flow", true, "removing infrastructure is structural too");
routes("Make it work from the screenshot I sent earlier", true,
  "a reference with no attachment — editPage's `looking` cannot see this one");

// ── The other half: what must stay cheap ──────────────────────────────────
//
// These are why the rule is a verb AND an object rather than a word list.
// Matching nouns alone sends every one of them to the expensive model.

console.log("\n— ordinary edits must stay on the cheap model —");
routes("Change the login button text", false, "THE ONE: names login, changes text");
routes("Make the sign in button bigger", false, "names sign in, resizes a button");
routes("Fix the typo on the account page", false, "names account, fixes a typo");
routes("Change the payment section heading", false, "names payment, edits a heading");
routes("Make the pricing table narrower", false, "names pricing, adjusts width");
routes("Replace the hero image", false, "replace, but not of infrastructure");
routes("Replace the hero image with the new one", false, "the same, spelled out");
routes("Move the pricing table down a bit", false, "a nudge");
routes("Change the footer copyright year", false, "one number");
routes("Make the cards rounder", false, "a radius");
routes("Update the price", false, "three words");

// ── The size signals still work ───────────────────────────────────────────
//
// The shape signals were ADDED. Nothing that escalated before may stop.

console.log("\n— the original size signals are untouched —");
routes(`make it nicer ${"and nicer ".repeat(200)}`, true, "a very long instruction");
routes("make it nicer", true, "a page too large for the small model",
  `<html>${"x".repeat(500_000)}</html>`);
routes("make it nicer", false, "the same ask against a small page");

// ── A model somebody picked ───────────────────────────────────────────────
//
// The picker settled builds and nothing else. An edit, a question and a
// clarification all ran on whatever editModelFor guessed, so selecting Opus
// and then asking for a change got Haiku — a control that visibly did nothing.
//
// An explicit pick now outranks every heuristic below it. Whether the account
// MAY have that model is decided before this function is reached (plan and
// balance, in api/build/route.ts); what arrives here has already been allowed,
// so honouring it is the whole job.

console.log("\n— a picked model outranks the guess —");

function picks(prompt, chosen, want, label, page = SMALL) {
  const got = editModelFor(prompt, page, chosen);
  if (got === want) ok(`picked · ${label}`);
  else fail(`picked · ${label}`, `${JSON.stringify(prompt)} with ${chosen} went to ${got}, wanted ${want}`);
}

/* Up: the ask looks small and they asked for the strong one anyway. */
picks("Change the button text", EDIT_MODEL_STRONG, EDIT_MODEL_STRONG,
  "THE ONE: a tiny edit on the model they chose");
picks("Update the price", EDIT_MODEL_STRONG, EDIT_MODEL_STRONG, "another small one");

/* Down: the ask looks structural and they asked for the cheap one. This is
   the direction that used to be impossible, and it is the point — somebody
   experimenting, or watching their balance, is allowed to. */
picks("Add authentication, database, roles and payments.", EDIT_MODEL, EDIT_MODEL,
  "THE OTHER ONE: structural work on the cheap model, because they said so");
picks("Redesign the entire landing page.", EDIT_MODEL, EDIT_MODEL,
  "a redesign on the cheap model, because they said so");

/* A pick beats the size signals too, in both directions. */
picks(`make it nicer ${"and nicer ".repeat(200)}`, EDIT_MODEL, EDIT_MODEL,
  "a very long instruction on the model they chose");
picks("make it nicer", EDIT_MODEL, EDIT_MODEL, "a huge page on the model they chose",
  `<html>${"x".repeat(500_000)}</html>`);

/* Auto, and nothing at all, leave the heuristics exactly as they were — which
   is what most people will be on and must not change. */
routes("Add authentication and roles", true, "no pick: the guess still decides");
if (editModelFor("Add authentication and roles", SMALL, null) === EDIT_MODEL_STRONG) {
  ok("picked · null is Auto — the guess decides");
} else {
  fail("picked · null is Auto — the guess decides");
}
if (editModelFor("Change the button text", SMALL, "") === EDIT_MODEL) {
  ok("picked · an empty pick is no pick");
} else {
  fail("picked · an empty pick is no pick");
}

/* And the two models are actually different, or none of this means
   anything. */
if (EDIT_MODEL === EDIT_MODEL_STRONG) {
  fail("the two tiers are different models", `both are ${EDIT_MODEL}`);
} else {
  ok(`the two tiers are different models — ${EDIT_MODEL} vs ${EDIT_MODEL_STRONG}`);
}

console.log(failed === 0 ? "\nall good" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
