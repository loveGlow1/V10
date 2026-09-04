#!/usr/bin/env node
/* The credit economy adds up.
 *
 *   npm run check:credits
 *
 * Not "are the numbers the ones we meant" — that is a business decision and no
 * tool can hold an opinion about it. This checks the RELATIONSHIPS between them,
 * which are the part that silently stops being true when one number moves.
 *
 * The failure that prompted it: 50 credits for $10 sat beside Standard's 100
 * for $25, so a one-off purchase cost 20 cents a credit and a subscription cost
 * 25. Buying without committing was cheaper than committing. Nothing threw,
 * nothing looked wrong on either screen, and the two numbers were only wrong in
 * each other's company — which is exactly the kind of thing a person reads past
 * and a check does not.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-credits");
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
      join(process.cwd(), "src/app/dashboard/credits.ts"),
      join(process.cwd(), "src/lib/site.ts"),
    ],
  }),
);

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const is = (got, want, t) => (got === want ? ok(t, String(got)) : fail(t, `expected ${want}, got ${got}`));
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

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

  const credits = await import(join(out, "app/dashboard/credits.js"));


  // ── What each tier actually costs per credit ────────────────────────────
  /* Printed every run rather than only on failure. The rates are a business
     decision and no tool can hold an opinion about them — but they can only be
     compared side by side, and side by side is exactly how nobody sees them. */
  const topUp = credits.topUpPricePerCredit();
  ok("a one-off top-up", `$${topUp.toFixed(2)}/credit`);
  for (const id of credits.PLAN_ORDER) {
    const rate = credits.pricePerCredit(id);
    if (rate !== null) ok(`${credits.PLANS[id].name}`, `$${rate.toFixed(2)}/credit`);
  }

  /* ── A dearer rate has to buy something ──────────────────────────────────
     The rule is not "a bigger plan is always a better rate" any more, because
     Pro deliberately is not: $150 for 300 credits is 50 cents each, twice
     Standard and above a top-up. That is allowed — Pro sells Fable, which no
     other plan can reach at any balance — but it is only allowed BECAUSE of
     that. A plan that costs more per credit than the one below it and unlocks
     nothing extra is a worse deal with no compensation, and that is the thing
     worth failing on. */
  const paid = credits.PLAN_ORDER.filter((id) => credits.PLANS[id].monthlyPriceUsd > 0);

  for (let i = 1; i < paid.length; i += 1) {
    const below = paid[i - 1];
    const above = paid[i];
    const cheaper = credits.pricePerCredit(below);
    const dearer = credits.pricePerCredit(above);
    if (dearer === null || cheaper === null || dearer <= cheaper) {
      ok(`${credits.PLANS[above].name} is not a worse rate than ${credits.PLANS[below].name}`);
      continue;
    }
    const extra = credits
      .modelsForPlan(above)
      .filter((model) => !credits.modelsForPlan(below).some((m) => m.id === model.id));
    has(
      extra.length > 0,
      `${credits.PLANS[above].name} costs more per credit but unlocks ${extra.map((m) => m.name).join(", ") || "nothing"}`,
      `${credits.PLANS[above].name} is $${dearer.toFixed(2)}/credit against ${credits.PLANS[below].name}'s $${cheaper.toFixed(
        2,
      )} and unlocks no model the cheaper plan cannot already use — a worse deal with nothing to show for it`,
    );
  }

  /* Same rule against the one-off price. A subscription whose credits cost more
     than buying them loose has to be selling access, not volume. */
  for (const id of paid) {
    const rate = credits.pricePerCredit(id);
    if (rate === null || rate <= topUp) {
      ok(`${credits.PLANS[id].name} credits are no dearer than a top-up`);
      continue;
    }
    const gated = credits.modelsForPlan(id).filter((model) => model.minPlan === id);
    has(
      gated.length > 0,
      `${credits.PLANS[id].name} credits cost more than a top-up, but it unlocks ${gated.map((m) => m.name).join(", ")}`,
      `${credits.PLANS[id].name} is $${rate.toFixed(2)}/credit against a top-up's $${topUp.toFixed(
        2,
      )} and unlocks nothing of its own — subscribers would be better off buying packs`,
    );
  }

  // ── The pack still does the job it exists for ───────────────────────────
  has(
    credits.TOP_UP_PACK.credits >= credits.PUBLISH_COST,
    "one top-up pack covers a first publish",
    `a pack is ${credits.TOP_UP_PACK.credits} and a publish is ${credits.PUBLISH_COST} — the button exists for somebody who needs one more publish today`,
  );

  // ── The free tier is the shape it was designed to be ────────────────────
  has(
    credits.SIGNUP_CREDITS > 0,
    "a new account gets something",
    "the signup grant is zero, so a free account cannot do anything at all",
  );
  has(
    credits.PLANS.free.monthlyCredits === 0,
    "the free plan does not refill",
    "a refilling free plan is a free product with a rate limit",
  );

  // ── Redeploying stays nominal next to going live ────────────────────────
  has(
    credits.REDEPLOY_COST < credits.PUBLISH_COST,
    "a redeploy costs less than a first publish",
    "iterating must not be taxed like provisioning",
  );

if (failed) {
  console.log(`\n${failed} check${failed === 1 ? "" : "s"} failed.`);
  process.exit(1);
}
console.log("\nAll passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
