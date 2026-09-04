/* The credit economy, in one place.

   Everything the platform charges for — what a plan grants, what an action
   costs, which bucket a charge comes out of — is decided here so that no
   surface can quote a different number than the one that will be billed. The
   dashboard, the billing modal and (once it exists) the server-side meter all
   read this module; none of them carry a figure of their own.

   Two rules are structural rather than conventional, because the business
   model rests on them:

     1. Publishing is a flat charge, not a metered one, and going live costs
        far more than staying live: `creditCostOf` returns PUBLISH_COST for a
        first publish and REDEPLOY_COST after, before it looks at any usage
        signal. Provisioning is the expensive part and it happens once. A
        redeploy is nominal on purpose — a platform that charges most for
        iterating is charging most for the thing it is for.
     2. Credits are spent expiring-soonest-first: today's daily grant, then
        last cycle's rollover, then this cycle's grant, then top-ups (which
        never expire). Spending the pool in any other order silently burns
        credits the user paid for while free ones expire unused.

   Nothing here reaches a database or a network. It is pure arithmetic over a
   balance, which is what lets the same functions run in the composer to
   preview a cost and on the server to enforce one. */

import { creditMultiplierFor } from "@/app/dashboard/models";
import { PUBLISH_SUBDOMAIN } from "@/lib/site";

export type PlanId = "free" | "standard" | "pro";

/* No plan has a daily grant. Every `dailyCredits` below is zero, and that is
 * deliberate rather than unfinished.
 *
 * A refilling daily allowance means an account can build at whatever rate the
 * refill sets, forever, without the balance ever being the thing that stops it
 * — wait a day, get five more, indefinitely. On Free that is a free product
 * with a rate limit rather than a free tier. On the paid plans it is the same
 * hole with a smaller entrance: the monthly grant is what the subscription buys
 * and what the pricing page names, and a daily top-up beside it makes the real
 * allowance a number nobody quoted.
 *
 * So credits arrive in exactly three ways, all of them countable: the one-time
 * signup grant, the monthly grant on a paid plan, and a purchase. The
 * `dailyCredits` field and renewDaily() stay because the mechanism is sound and
 * the column exists — turning a daily grant back on should be a number, not a
 * redesign. */

/* Going live the first time. This is the charge that pays for provisioning —
   a repository, a subdomain, hosting — which happens once per project and is
   real work whatever the app turns out to be.

   It is the largest single charge on the platform by a wide margin — at the
   top-up pack's rate, ten dollars — so it is deliberately the one action a user
   is expected to think before taking. */
export const PUBLISH_COST = 50;

/* Pushing a change to an app that is already live. Nominal on purpose.

   Charging the full publish price every time would tax the thing this platform
   exists to make cheap. Someone who publishes, spots a typo and fixes it should
   not pay ten dollars for the typo — they would batch changes, or stop
   deploying, or leave. Nothing is provisioned on a redeploy; it is a commit and
   a build, so it is priced like one. */
export const REDEPLOY_COST = 1;

/* Everything a new account ever gets for free: four credits, once, at signup.
 *
 * They land in the top-up bucket rather than the daily one, which is what makes
 * them a one-time balance instead of an allowance — top-ups never expire and
 * are never refilled. Nothing puts credits back afterwards but a purchase.
 *
 * Written in credits rather than dollars because credits are what the account
 * holds and what every screen counts in; at the top-up pack's rate of fifty
 * credits for ten dollars, four credits is eighty cents' worth.
 *
 * Four is below the full-build door on purpose. FULL_BUILD_ENTRY_COST in
 * api/build/route.ts is CREDIT_ACTIONS.generate.max, so a full build cannot be
 * started on the signup grant at all — what it buys is a look at the workspace:
 * an edit or two, a question, and the composer refusing the big one with a note
 * about topping up. That is the intended shape of the free tier, not an
 * oversight. Someone who wants a build pays for it.
 *
 * Keep this in step with public.signup_bonus_credits() in supabase/schema.sql,
 * which is the copy that actually runs at signup. */
export const SIGNUP_CREDITS = 4;

export type Plan = {
  id: PlanId;
  name: string;
  /** What the plan costs per month, in whole dollars. Free is 0. */
  monthlyPriceUsd: number;
  /** Granted every day and never carried forward — use it or lose it. Zero on
   * every plan: see the note above the plans for why nothing refills daily. */
  dailyCredits: number;
  /** Granted at the start of each billing cycle. */
  monthlyCredits: number;
  /** Billing cycles an unused monthly credit survives. 0 = expires with the cycle. */
  rolloverCycles: number;
  publishing: {
    /** The domain a published project is served from when it has no custom one. */
    subdomain: string;
    customDomains: boolean;
    privateRepos: boolean;
  };
  support: string;
  /** Plain-language entitlements, in the order a plan card should list them. */
  features: string[];
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    monthlyPriceUsd: 0,
    /* Nothing recurring at all. A Free account opens with SIGNUP_CREDITS and
       that is the whole of it. */
    dailyCredits: 0,
    monthlyCredits: 0,
    rolloverCycles: 0,
    publishing: {
      subdomain: PUBLISH_SUBDOMAIN,
      customDomains: false,
      privateRepos: false,
    },
    support: "Standard community support",
    features: [
      `${SIGNUP_CREDITS} credits to start, on the house`,
      /* "Change", not "build". The signup grant sits below the full-build door
         deliberately (see SIGNUP_CREDITS), so a card promising a free account
         it can build is promising the one thing it will be refused. Editing and
         asking questions are what four credits actually reach. */
      "Change and refine pages in your workspace",
      /* Said plainly rather than left to be discovered. A Free balance does not
         refill, so "what happens when it runs out" is the question the card has
         to answer, not one a person should hit mid-build. */
      "Credits do not refill — top up or upgrade to keep going",
      `Publishing from ${PUBLISH_COST} credits — top up or upgrade to go live`,
    ],
  },
  standard: {
    id: "standard",
    name: "Standard",
    monthlyPriceUsd: 25,
    dailyCredits: 0,
    monthlyCredits: 100,
    rolloverCycles: 1,
    publishing: {
      subdomain: PUBLISH_SUBDOMAIN,
      customDomains: true,
      privateRepos: true,
    },
    support: "Priority support",
    features: [
      "100 credits every month",
      "Private repositories and custom domains",
      "Unused credits roll over one cycle",
      "GitHub integration",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPriceUsd: 150,
    dailyCredits: 0,
    /* The one allowance the specification does not state. Held at Standard's
       rate of four credits per dollar, so the step up in price is a step up in
       capacity rather than a change of deal. Change this line, not the UI, if
       the intended figure is different. */
    monthlyCredits: 600,
    rolloverCycles: 1,
    publishing: {
      subdomain: PUBLISH_SUBDOMAIN,
      customDomains: true,
      privateRepos: true,
    },
    support: "Priority support",
    features: [
      "600 credits every month",
      "Private repositories and custom domains",
      "Unused credits roll over one cycle",
      "Priority support",
    ],
  },
};

/* The order the plans are offered in, cheapest first. */
export const PLAN_ORDER: PlanId[] = ["free", "standard", "pro"];

/* Bought mid-cycle when the pool runs dry. Top-ups are the only credits with
   no expiry, which is why they are spent last. */
export const TOP_UP_PACK = { credits: 50, priceUsd: 10 } as const;

/* ── The consumption matrix ────────────────────────────────────────────────
   Every billable thing the platform does is one of these four. `min`/`max`
   bound what an action may ever cost, so a runaway estimate cannot produce a
   charge outside the band the pricing page promises. */

export type CreditActionId = "chat" | "generate" | "publish" | "runtime";

export type CreditAction = {
  id: CreditActionId;
  label: string;
  min: number;
  max: number;
  description: string;
  /** False where the cost is carried by the plan rather than the credit pool. */
  billedInCredits: boolean;
};

export const CREDIT_ACTIONS: Record<CreditActionId, CreditAction> = {
  chat: {
    id: "chat",
    label: "Pure chat / planning",
    /* The floor is 1 rather than 0, and the zero was the mistake.
     *
     * "Pure chat" is not cheap here, because answering a question about a
     * project means sending the project: the answer path in builder/edit.ts
     * puts the whole page in front of the model before it says anything. That
     * is tens of thousands of input tokens whatever comes back, so a one-line
     * reply is the *worst* case for us — real money spent, and under the old
     * band it was billed at zero because the band only ever looked at output.
     *
     * A floor of 1 says the true thing: the cost of a question is reading the
     * page, and reading the page happens before the length of the answer is
     * known. */
    min: 1,
    max: 2,
    description:
      "Conversational prompts, error troubleshooting, and architecture planning. Priced from a floor because answering a question means reading the whole page first.",
    billedInCredits: true,
  },
  generate: {
    id: "generate",
    label: "Code generation / file editing",
    /* Raised roughly threefold in 2026-09, because the old band sold every
       generation below cost.
     *
     * A full build is one long call at the top of the model range, and it
     * answers with a whole document: tens of thousands of output tokens, plus
     * the thinking that produced them, which bills as output too. That is
     * about a dollar of model time. The old ceiling of 2.5 credits charged
     * fifty cents for it at the top-up rate, so the better the build, the more
     * it lost — and a free account's signup grant bought two of them.
     *
     * The ceiling is 8 rather than the 10-20 the same page costs elsewhere.
     * This is a deliberate half-step: it clears cost with a margin on every
     * shape of build without repricing the product in one move. The number to
     * revisit is this one. */
    min: 1.5,
    max: 8,
    description:
      "Variable cost based on output token length and scope of file modifications.",
    billedInCredits: true,
  },
  publish: {
    id: "publish",
    label: "Production publishing / deploy",
    /* The band's two ends are the two prices: a redeploy at the floor, a first
       publish at the ceiling. Nothing in between, and nothing outside. */
    min: REDEPLOY_COST,
    max: PUBLISH_COST,
    description:
      `${PUBLISH_COST} credits to take a project live the first time, then ${REDEPLOY_COST} for each deploy after that.`,
    billedInCredits: true,
  },
  runtime: {
    id: "runtime",
    label: "Runtime cloud / database sync",
    min: 0,
    max: 0,
    description:
      "Covered by base plan allowances; heavy background traffic scales with tier limits.",
    /* Metered against the plan's own limits, never drawn from the pool. */
    billedInCredits: false,
  },
};

/* What the estimator is allowed to look at. A generation is priced on how much
   it wrote and how far it reached; a chat turn only on how much it said. */
export type UsageSignal = {
  /** Tokens the model produced for this turn. */
  outputTokens?: number;
  /** Files the turn created, edited or deleted. */
  filesTouched?: number;
  /**
   * Which model did the work, as a picker id.
   *
   * The band below prices the SHAPE of a turn — how much was written, how far
   * it reached. This is the other half: what that turn cost to run. A page
   * generated on Fable and the same page on Haiku are the same work and ten
   * times apart on the bill, and a credit economy that cannot tell them apart
   * charges the Haiku user for the Fable one.
   *
   * Absent means the default rate, which is what an older caller that does not
   * send it will get. Never read from the browser: a model id is worth money
   * here, so /api/credits/spend uses the server's own constant and the build
   * path uses what the signed request actually ran on.
   */
  modelId?: string;
  /**
   * Whether the project is already live — the difference between provisioning
   * one and redeploying it.
   *
   * The browser may pass this to preview a price. The server must not take its
   * word for it: it is the one signal where understating costs the platform
   * money rather than the caller, so /api/credits/spend reads the project's
   * stored status and prices from that instead.
   */
  alreadyPublished?: boolean;
};

/* Tuning constants for the bands above. Named rather than inlined so the shape
   of the curve is legible: a chat turn leaves its floor once the answer runs
   past a paragraph and reaches the 2-credit ceiling at roughly a page and a
   half, and a generation reaches its 8-credit ceiling at a large multi-section
   build.

   All three moved with the bands in 2026-09. The per-file rate did most of the
   work — it is what separates a one-patch edit from a twelve-section build, and
   at 0.25 the two ended up close enough that a whole generated page priced
   like a typo fix. */
const CHAT_TOKENS_PER_CREDIT = 900;
const GENERATE_TOKENS_PER_CREDIT = 1500;
const GENERATE_CREDITS_PER_FILE = 0.6;

/** Credits carry two decimals, the same precision the balance is displayed in. */
export function roundCredits(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * What one action costs, given what it actually did.
 *
 * Deterministic: the same signal always prices the same, so an estimate shown
 * before a turn and the charge taken after it cannot disagree.
 */
export function creditCostOf(action: CreditActionId, signal: UsageSignal = {}): number {
  const spec = CREDIT_ACTIONS[action];

  /* Runtime never touches the pool — it is metered against the plan instead. */
  if (!spec.billedInCredits) return 0;

  /* A publish is one of two flat prices, decided only by whether the project is
     already live. Returned before any usage is read, so no token count or file
     count can move a deploy off its advertised price in either direction.

     Not multiplied by the model either, and that is deliberate: no model runs
     during a deploy. It is a commit, a build and a subdomain, and it costs the
     same whoever wrote the page. */
  if (action === "publish") {
    return signal.alreadyPublished ? REDEPLOY_COST : PUBLISH_COST;
  }

  const outputTokens = Math.max(0, signal.outputTokens ?? 0);
  const filesTouched = Math.max(0, signal.filesTouched ?? 0);

  /* The model's rate, applied AFTER the band rather than inside it.
   *
   * Order matters and this is the way round that means what it says. Clamping
   * first and multiplying second makes the band a description of the DEFAULT
   * model's turn, which each model then scales: Sonnet's ceiling is 8, Opus's
   * is 20, Fable's is 40. Multiplying first and clamping second would let the
   * shared ceiling swallow the difference — every model above the default
   * would price identically at the top, which is exactly where the expensive
   * ones are expensive. */
  const rate = creditMultiplierFor(signal.modelId);

  if (action === "chat") {
    /* A short answer sits at the floor; a long one reaches the band's ceiling.
       Troubleshooting a build should not feel metered — though asking Fable
       about it costs what asking Fable costs. */
    const base = clamp(roundCredits(outputTokens / CHAT_TOKENS_PER_CREDIT), spec.min, spec.max);
    return roundCredits(base * rate);
  }

  /* Generation starts at the floor — any edit is worth something — and grows
     with how much was written and how many files it reached. */
  const cost =
    spec.min +
    outputTokens / GENERATE_TOKENS_PER_CREDIT +
    filesTouched * GENERATE_CREDITS_PER_FILE;

  return roundCredits(clamp(roundCredits(cost), spec.min, spec.max) * rate);
}

/* ── The balance ───────────────────────────────────────────────────────────
   Four buckets rather than one number, because they expire at different times
   and the order they are spent in is the difference between a user losing
   credits and not. */

export type CreditBalance = {
  /** Today's allowance. Reset every day; whatever is left is discarded. */
  daily: number;
  /** This cycle's plan grant. */
  monthly: number;
  /** Last cycle's unused grant, surviving one further cycle on plans that allow it. */
  rollover: number;
  /** Purchased packs. No expiry, so these are spent last. */
  topUp: number;
};

/* The order the buckets are drained in: soonest to expire first. */
const SPEND_ORDER = ["daily", "rollover", "monthly", "topUp"] as const;

export function startingBalance(planId: PlanId): CreditBalance {
  const plan = PLANS[planId];

  return {
    daily: plan.dailyCredits,
    monthly: plan.monthlyCredits,
    rollover: 0,
    topUp: 0,
  };
}

/**
 * What a brand-new account holds the moment it is created, and the most it will
 * ever hold without paying: the signup credits, in the bucket that neither
 * expires nor refills.
 */
export function signupBalance(): CreditBalance {
  return { ...startingBalance("free"), topUp: SIGNUP_CREDITS };
}

export function totalCredits(balance: CreditBalance): number {
  return roundCredits(balance.daily + balance.rollover + balance.monthly + balance.topUp);
}

export function canAfford(balance: CreditBalance, cost: number): boolean {
  return totalCredits(balance) + 1e-9 >= cost;
}

export type SpendResult =
  | { ok: true; balance: CreditBalance; spent: number }
  /* Refused rather than partially applied: half a generation is not a thing
     the platform can deliver, so the balance is left exactly as it was. */
  | { ok: false; balance: CreditBalance; shortfall: number };

/**
 * Takes `cost` out of the pool, draining the soonest-to-expire bucket first.
 *
 * Returns a new balance; the one passed in is never mutated, so a caller can
 * price a turn speculatively without committing to it.
 */
export function spendCredits(balance: CreditBalance, cost: number): SpendResult {
  if (cost <= 0) return { ok: true, balance, spent: 0 };

  if (!canAfford(balance, cost)) {
    return { ok: false, balance, shortfall: roundCredits(cost - totalCredits(balance)) };
  }

  const next = { ...balance };
  let outstanding = cost;

  for (const bucket of SPEND_ORDER) {
    if (outstanding <= 0) break;
    const taken = Math.min(next[bucket], outstanding);
    next[bucket] = roundCredits(next[bucket] - taken);
    outstanding = roundCredits(outstanding - taken);
  }

  return { ok: true, balance: next, spent: cost };
}

/** A new day: the daily grant is refilled and yesterday's remainder is dropped. */
export function renewDaily(balance: CreditBalance, planId: PlanId): CreditBalance {
  return { ...balance, daily: PLANS[planId].dailyCredits };
}

/**
 * A new billing cycle: this cycle's unused grant becomes next cycle's rollover
 * on a plan that allows it, the previous rollover expires, and top-ups — which
 * were paid for outright — survive untouched.
 */
export function renewCycle(balance: CreditBalance, planId: PlanId): CreditBalance {
  const plan = PLANS[planId];

  return {
    daily: plan.dailyCredits,
    monthly: plan.monthlyCredits,
    rollover: plan.rolloverCycles > 0 ? balance.monthly : 0,
    topUp: balance.topUp,
  };
}

/** Adds bought packs to the pool. */
export function applyTopUp(balance: CreditBalance, packs = 1): CreditBalance {
  return { ...balance, topUp: roundCredits(balance.topUp + packs * TOP_UP_PACK.credits) };
}

/** The two-decimal form every credit figure in the UI is written in. */
export function formatCredits(value: number): string {
  return value.toFixed(2);
}
