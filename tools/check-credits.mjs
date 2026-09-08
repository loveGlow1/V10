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

  /* ── And nobody arrives with more than the welcome ────────────────────────
   *
   * The grant is a number somebody may want to move; the ceiling is the rule
   * that move has to obey, and a ceiling nothing checks is a comment. Every
   * first-timer gets SIGNUP_CREDITS and no first-timer gets more than
   * MAX_SIGNUP_CREDITS — in the app, in the database, and in the copy the plan
   * card prints, which reads the same constant. */
  has(
    credits.SIGNUP_CREDITS <= credits.MAX_SIGNUP_CREDITS,
    `a new account is granted ${credits.SIGNUP_CREDITS}, at most ${credits.MAX_SIGNUP_CREDITS}`,
    `the signup grant is ${credits.SIGNUP_CREDITS} against a ceiling of ${credits.MAX_SIGNUP_CREDITS} — first-timers are being credited above the limit`,
  );

  /* The copy that actually runs at signup lives in Postgres, not here, and the
     two have only ever been held together by a comment asking somebody to
     remember. A new account credited 4 by the database while every screen
     promises 5 is a support ticket nothing in the build would have caught. */
  const schema = readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8");
  const sqlConstant = (name) => {
    const body = new RegExp(
      `create or replace function public\\.${name}\\(\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
    ).exec(schema);
    if (!body) return null;
    const number = /-?\d+(?:\.\d+)?/.exec(body[1]);
    return number ? Number(number[0]) : null;
  };

  is(sqlConstant("signup_bonus_credits"), credits.SIGNUP_CREDITS, "the database grants what SIGNUP_CREDITS says");
  is(
    sqlConstant("max_signup_bonus_credits"),
    credits.MAX_SIGNUP_CREDITS,
    "and caps it where MAX_SIGNUP_CREDITS says",
  );

  /* The clamp itself, not just the numbers: handle_new_user is the statement
     that moves credit into a brand-new account, and it has to hold the ceiling
     whatever the grant function is later edited to say. */
  const signupTrigger = /create or replace function public\.handle_new_user\(\)[\s\S]*?\$\$;/.exec(schema);
  has(
    signupTrigger !== null && signupTrigger[0].includes("max_signup_bonus_credits()"),
    "the signup trigger clamps the welcome to the ceiling on its way into the balance",
    "handle_new_user() writes the grant function's answer straight into the balance, so raising that function alone credits a first-timer above the limit",
  );

  /* A build on the default model has to stay out of reach on the welcome
     alone. That is what makes the free tier a look at the workspace rather
     than a free build, and it is the reason the grant is small. */
  has(
    credits.SIGNUP_CREDITS < credits.CREDIT_ACTIONS.generate.max,
    `the welcome (${credits.SIGNUP_CREDITS}) does not open a full build on the default model (${credits.CREDIT_ACTIONS.generate.max})`,
    "a new account can start a full build for free, which is a free product rather than a free tier",
  );

  // ── Redeploying stays nominal next to going live ────────────────────────
  has(
    credits.REDEPLOY_COST < credits.PUBLISH_COST,
    "a redeploy costs less than a first publish",
    "iterating must not be taxed like provisioning",
  );

  /* ── What /api/publish is allowed to charge ──────────────────────────────
   *
   * The publish route quotes a price to the person, checks their balance
   * against it, publishes, and then charges. Those are three separate reads of
   * the same number, and they are only safe if the number cannot move — so what
   * is asserted here is that NOTHING about the page can shift a publish off its
   * advertised price.
   *
   * This is the largest single charge on the platform. Somebody shown "5
   * credits" and billed something else has been overcharged, whatever the
   * arithmetic says. */
  const firstPublish = credits.creditCostOf("publish");
  const redeploy = credits.creditCostOf("publish", { alreadyPublished: true });

  has(firstPublish === credits.PUBLISH_COST, "a first publish is the advertised price", `${firstPublish}`);
  has(redeploy === credits.REDEPLOY_COST, "and a redeploy is the redeploy price", `${redeploy}`);

  /* A long page, a big model, a thousand files touched. A deploy is a commit
     and a subdomain: no model runs, so none of these may register. */
  for (const [name, signal] of [
    ["a huge page", { outputTokens: 500_000 }],
    ["many files", { filesTouched: 1_000 }],
    ["the priciest model", { modelId: "claude-fable-5-1" }],
    ["all three at once", { outputTokens: 500_000, filesTouched: 1_000, modelId: "claude-fable-5-1" }],
  ]) {
    has(
      credits.creditCostOf("publish", signal) === credits.PUBLISH_COST,
      `${name} does not change what a publish costs`,
      `${credits.creditCostOf("publish", signal)}`,
    );
    has(
      credits.creditCostOf("publish", { ...signal, alreadyPublished: true }) === credits.REDEPLOY_COST,
      `${name} does not change what a redeploy costs`,
      `${credits.creditCostOf("publish", { ...signal, alreadyPublished: true })}`,
    );
  }

  /* Both prices survive rounding unchanged. The route rounds before charging,
     and a price that moves when rounded is a price quoted wrong. */
  has(
    credits.roundCredits(firstPublish) === firstPublish && credits.roundCredits(redeploy) === redeploy,
    "both publish prices are already in the units a balance is kept in",
    `${credits.roundCredits(firstPublish)} / ${credits.roundCredits(redeploy)}`,
  );

  /* An account with exactly the price can publish; one a hair short cannot.
     canAfford is what the route checks before anything is written, so an
     off-by-one here either blocks a paying customer or lets a publish through
     unpaid. */
  const exactly = { daily: 0, rollover: 0, monthly: firstPublish, topUp: 0, planId: "free" };
  const short = { daily: 0, rollover: 0, monthly: firstPublish - 0.01, topUp: 0, planId: "free" };
  has(credits.canAfford(exactly, firstPublish) === true, "exactly enough credits can publish");
  has(credits.canAfford(short, firstPublish) === false, "a hair short cannot");

  /* Credits from different buckets add up — somebody with a part-used monthly
     allowance and a top-up pack must be able to publish. */
  const spread = {
    daily: firstPublish / 4,
    rollover: firstPublish / 4,
    monthly: firstPublish / 4,
    topUp: firstPublish / 4,
    planId: "free",
  };
  has(credits.canAfford(spread, firstPublish) === true, "and credits spread across buckets still add up");

  /* ── What a long brief costs ─────────────────────────────────────────────
     A price, not a cost — 700 words is about a fifth of a cent of input
     against a build that costs about a dollar. So there is nothing here for a
     tool to have an opinion about except the shape of it, and the shape is
     what somebody notices on their balance: the allowance has to be free, the
     surcharge has to stay small beside the work it rides on, and it has to be
     readable in the two decimals a balance is kept in. */
  const free = credits.FREE_CONTEXT_WORDS;
  const surcharge = credits.contextSurcharge;

  has(surcharge([free]) === 0, `${free} words are free on every message`, "the allowance charges");
  has(surcharge([0, 12, free]) === 0, "short messages are free however many there are");

  /* The full ceiling on every message of a six-turn thread — the worst case a
     person can actually reach. */
  const MAX_CONTEXT_WORDS = 1000;
  const worst = surcharge(Array(7).fill(MAX_CONTEXT_WORDS));
  const build = credits.CREDIT_ACTIONS.generate.max;
  has(
    worst < build / 2,
    `the worst case adds ${worst} to a build of up to ${build}`,
    `context can add ${worst}, which is no longer a surcharge but a second price`,
  );

  has(
    worst === credits.MAX_CONTEXT_SURCHARGE,
    `the worst case is the ceiling itself (${credits.MAX_CONTEXT_SURCHARGE})`,
    "the cap is not what stops the worst case, so the rate alone decides it",
  );

  /* Proportional, and in that direction: this is the property that makes the
     line on a ledger explicable — twice the context past the allowance, twice
     the charge. Below the cap, which is where all but the longest threads sit. */
  const one = surcharge([free + 100]);
  const two = surcharge([free + 200]);
  has(
    one > 0 && Math.abs(two - one * 2) < 0.005,
    `it scales with what was written (${one} for 100 words over, ${two} for 200)`,
    "the surcharge is not proportional, so a ledger line cannot be explained",
  );

  /* Per message, matching the ceiling it sits under. Two messages of 400 must
     cost what two messages of 400 cost — not what one message of 800 does. */
  has(
    surcharge([free + 100, free + 100]) === credits.roundCredits(one * 2),
    "each message gets its own allowance",
    "the allowance is being applied once per request rather than once per message",
  );

  has(
    surcharge([free + 3]) === 0,
    "a message a few words over rounds to nothing",
    "somebody is being charged an amount too small to appear on their balance",
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
