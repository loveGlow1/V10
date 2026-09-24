#!/usr/bin/env node
/* Does the generator know what the project is wired to?
 *
 *   npm run check:integrations
 *
 * The plumbing was right and nothing read it. A customer pastes a Stripe
 * secret key into Server keys; it reaches Vercel and is set on the generated
 * project's environment, where the build and the running function can read it.
 * That half works. But `projectSecretNames` had exactly one caller — the panel
 * that draws the list — so the build prompt was composed as though every
 * project had no services at all, and the blueprint's rule for that case fired
 * as designed: "payment connects to a back end that is not attached yet". The
 * customer was shown that sentence with their key on the project the whole
 * time.
 *
 * Two things are asserted here and the second is the one that matters. The
 * mapping has to recognise the names people actually paste — a name nobody
 * uses is a service that is never detected. And the brief has to keep saying
 * server-only, every time, because a model that knows a Stripe key exists will
 * otherwise reach for it wherever the code it is writing happens to be, and a
 * secret in a client component is a secret published to every visitor.
 *
 * Offline. No model, no network, no key.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-integrations");
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
    files: [join(process.cwd(), "src/lib/builder/integrations.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });

const { connectedServices, integrationBrief } = await import(join(out, "lib/builder/integrations.js"));

let failed = 0;
let passed = 0;
const ok = (t) => { passed += 1; console.log(`ok    ${t}`); };
const fail = (t, d) => { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

console.log("\nThe names people actually paste are recognised:");

/* Each of these is the name the service's own documentation uses, which is
   what somebody copies. A mapping that wants a name nobody writes detects
   nothing and is worse than none, because it looks like it works. */
for (const [key, expected] of [
  ["STRIPE_SECRET_KEY", "stripe"],
  ["STRIPE_RESTRICTED_KEY", "stripe"],
  ["RESEND_API_KEY", "resend"],
  ["TWILIO_AUTH_TOKEN", "twilio"],
  ["ANTHROPIC_API_KEY", "anthropic"],
  ["OPENAI_API_KEY", "openai"],
  ["GEMINI_API_KEY", "gemini"],
]) {
  const found = connectedServices([key]);
  has(found.length === 1 && found[0].id === expected, `${key} -> ${expected}`, JSON.stringify(found));
}

has(connectedServices(["stripe_secret_key"]).length === 1, "and the case somebody typed it in does not matter");

console.log("\nAnd a key this platform has no opinion about is left alone:");

/* Guessing a capability from an unrecognised name would tell the model to
   build against a service nobody described. */
for (const key of ["INTERNAL_WEBHOOK_TOKEN", "MY_API_KEY", "DATABASE_PASSWORD", ""]) {
  has(connectedServices([key]).length === 0, `${JSON.stringify(key)} declares nothing`);
}

has(connectedServices([]).length === 0, "and a project with no keys declares nothing");

console.log("\nThe brief:");

has(integrationBrief([]) === "", "there is no brief when nothing is connected",
  "the blueprints' pending state is the right answer for a project with no keys");

const brief = integrationBrief(connectedServices(["STRIPE_SECRET_KEY", "RESEND_API_KEY"]));

has(/Stripe/.test(brief) && /Resend/.test(brief), "names every service that is connected");
has(
  /NOT pending/i.test(brief),
  "says plainly that these are not pending",
  "this is the sentence that stops 'payments connect to a back end that is not attached yet'",
);

/* THE ONE. secretKeyProblem refuses a NEXT_PUBLIC_ name, so every key here is
   server-only by construction — and the model has to be told, because knowing
   a Stripe key exists is not knowing where it may be read. */
has(
  /SERVER-ONLY/i.test(brief) && /route handler/i.test(brief),
  "and that every key is server-only, read in a route handler",
  "a secret in a client component is a secret published to every visitor",
);
has(
  /NEXT_PUBLIC_/.test(brief),
  "naming the prefix that would publish it",
);
has(
  /still not connected/i.test(brief),
  "while anything unlisted still gets the pending state",
  "the brief must not read as permission to pretend about services that are absent",
);

console.log("\nAnd the build path actually asks:");

const { readFileSync } = await import("node:fs");
const buildRoute = readFileSync(join(process.cwd(), "src/app/api/build/route.ts"), "utf8");

/* The whole point. projectSecretNames existed for a long time with one caller
   and it was the panel that draws the list. */
has(
  /projectSecretNames\(/.test(buildRoute),
  "the build reads the keys that are really set",
  "without this the mapping above is another correct module nobody calls",
);
has(
  /integrations: integrationBrief\(/.test(buildRoute),
  "and hands the result to the generator",
);

console.log(failed === 0 ? `\nAll ${passed} passed.` : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
