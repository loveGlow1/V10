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

import { AUTO_MODEL, MODELS, creditMultiplierFor, modelById, type Model } from "@/app/dashboard/models";
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

/* The order the plans are offered in, cheapest first. Also the ranking the
   model gate below reads: a plan may pick anything its own tier or lower. */
export const PLAN_ORDER: PlanId[] = ["free", "standard", "pro"];

/* ── Which models a plan may pick ──────────────────────────────────────────

   The rule lives on the model — `minPlan` in dashboard/models.ts — because a
   model is what gets added and removed, and a rule kept anywhere else is a rule
   somebody forgets to update. This is the half that knows what a plan IS.

   Haiku and Sonnet are unmarked, so every plan including Free can pick them.
   Opus needs Standard, Fable needs Pro.

   The assignment below is the compile-time tie between the two files. Model's
   `minPlan` is written as a literal union rather than PlanId, because credits.ts
   already imports models.ts and the reverse would be a cycle; if the two ever
   disagree about what a plan is called, this line stops building. */
const PLAN_GATED_MODELS: readonly { minPlan?: PlanId }[] = MODELS;

/** Whether an account on `planId` is allowed to pick `model`. */
export function modelAllowedOnPlan(model: Model, planId: PlanId): boolean {
  const needed = model.minPlan ?? "free";
  return PLAN_ORDER.indexOf(planId) >= PLAN_ORDER.indexOf(needed as PlanId);
}

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
      `Build with ${modelNames("free")}`,
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
      `Everything on Free, plus ${addedModelNames("standard")}`,
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
      `Everything on Standard, plus ${addedModelNames("pro")}`,
      "Private repositories and custom domains",
      "Unused credits roll over one cycle",
      "Priority support",
    ],
  },
};

/** The plan a locked model needs, for saying so on the picker. Null when the
 *  model is not gated at all. */
export function planRequiredFor(model: Model): Plan | null {
  return model.minPlan && model.minPlan !== "free" ? PLANS[model.minPlan as PlanId] : null;
}

/** Every model this plan may pick, in picker order. "Auto" is a pointer rather
 *  than a model and never appears. */
export function modelsForPlan(planId: PlanId): Model[] {
  return MODELS.filter(
    (model) => model.provider !== "auto" && model.available !== false && modelAllowedOnPlan(model, planId),
  );
}

/* The plan cards below name their own models rather than repeating a list
   somebody has to remember to update. Function declarations, so they can be
   called from the PLANS initializer. */
function modelNames(planId: PlanId): string {
  return modelsForPlan(planId).map((model) => model.name).join(" and ");
}

/** What this plan adds over the one below it — what an upgrade actually buys. */
function addedModelNames(planId: PlanId): string {
  const below = PLAN_ORDER[PLAN_ORDER.indexOf(planId) - 1];
  const already = new Set(modelsForPlan(below).map((model) => model.id));
  return modelsForPlan(planId)
    .filter((model) => !already.has(model.id))
    .map((model) => model.name)
    .join(" and ");
}

/* Bought mid-cycle when the pool runs dry. Top-ups are the only credits with
   no expiry, which is why they are spent last.

   ── The price, and why it is not $10 ────────────────────────────────────────

   It was 50 credits for $10, which is 20 cents a credit against Standard's 25 —
   so the casual purchase was CHEAPER per credit than the commitment. That is
   backwards, and not subtly: it made subscribing the worse deal, and the
   rational move for anyone paying attention was to never take a plan and buy
   packs forever. A subscription has to be the better rate or it is not a
   subscription, it is a worse way to buy the same thing.

   $15 for 50 puts a top-up at 30 cents a credit — a 20% premium over the plan
   rate, which is what buying without committing should cost.

   The SIZE stays at 50, and that is deliberate rather than left alone. A pack
   is exactly one first publish (PUBLISH_COST), which is the whole reason the
   button exists: somebody who needs one more publish today is not looking for a
   plan, and a pack that no longer covers the thing it was sized for would send
   them to the plan or away. Shrinking the pack to fix the rate would have
   broken that; raising the price does not.

   check:credits enforces the ordering, so this cannot quietly invert again. */
export const TOP_UP_PACK = { credits: 50, priceUsd: 15 } as const;

/** What a credit costs on a plan, in dollars. Free has no rate — dividing by
 *  its zero price says "infinitely cheap", which is true and useless — so it
 *  answers null and callers skip it. */
export function pricePerCredit(planId: PlanId): number | null {
  const plan = PLANS[planId];
  if (plan.monthlyPriceUsd <= 0 || plan.monthlyCredits <= 0) return null;
  return plan.monthlyPriceUsd / plan.monthlyCredits;
}

/** What a credit costs when bought as a one-off. Must exceed every plan's rate:
 *  see the note on TOP_UP_PACK. */
export function topUpPricePerCredit(): number {
  return TOP_UP_PACK.priceUsd / TOP_UP_PACK.credits;
}

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

/* ── Knowing what this account can actually do ─────────────────────────────

   The refusal that prompted this said "A full build on this model costs up to
   8.00 credits and you have 5.25. Pick a cheaper model." It was true and it was
   useless: there WAS a cheaper model, on the same plan, whose build the balance
   covered — Haiku, at half the price. The person was told to solve a problem the
   system had already solved and simply not mentioned.

   So the rule here is: never refuse without naming what would work. Everything
   below exists to answer one question — given this balance and this plan, what
   can this person do right now. */

/** What must be in the pool before a full build on `model` may START.
 *
 *  The band describes a turn on the default model; every other model scales it,
 *  so the door does too — otherwise an account holding eight credits could open
 *  a Fable build that prices at forty. */
export function buildDoorFor(model: Model): number {
  return roundCredits(CREDIT_ACTIONS.generate.max * creditMultiplierFor(model.id));
}

/** Every model this account may pick AND can afford a build on, dearest first —
 *  so the head of the list is the best thing they can run right now. */
export function affordableModels(balance: CreditBalance, planId: PlanId): Model[] {
  return modelsForPlan(planId)
    .filter((model) => canAfford(balance, buildDoorFor(model)))
    .sort((a, b) => creditMultiplierFor(b.id) - creditMultiplierFor(a.id));
}

/** What a build will actually run on, and whether that is what was asked for. */
export type BuildModelChoice = {
  /** The model to build with. Always affordable, always allowed on the plan. */
  model: Model;
  /** What they asked for, when it is not what they got. Null when it is. */
  downgradedFrom: Model | null;
};

/**
 * The model a build should run on, given what was asked for and what is left.
 *
 * A balance too low for the requested model is not a refusal any more — it is a
 * step down to the dearest model this plan allows and this balance covers,
 * which on every plan bottoms out at Haiku. Refusing outright while a model
 * that would have run sat one row down in the same menu is the behaviour this
 * replaces.
 *
 * Only down, never up: a request can always cost less than asked, never more.
 *
 * Returns null when nothing at all fits, which is the only remaining refusal
 * and the one case where cannotAffordBuildMessage has the last word.
 *
 * The caller MUST tell the person when downgradedFrom is set. A page built on a
 * smaller model than the one on the chip, with nothing said, is indistinguishable
 * from a page that came back badly — and the second is the conclusion they will
 * reach.
 */
export function resolveBuildModel(
  requested: Model,
  balance: CreditBalance | null,
  planId: PlanId,
): BuildModelChoice | null {
  /* No balance to read: build what was asked for. The same fail-open the
     affordability gate takes — refusing an account we cannot see is worse than
     letting one build. */
  if (!balance) return { model: requested, downgradedFrom: null };

  if (canAfford(balance, buildDoorFor(requested))) {
    return { model: requested, downgradedFrom: null };
  }

  /* Dearest first, so the step down is as small as it can be: somebody short of
     Fable gets Opus if they can afford Opus, not Haiku. */
  const fallback = affordableModels(balance, planId).find(
    (entry) => creditMultiplierFor(entry.id) < creditMultiplierFor(requested.id),
  );

  return fallback ? { model: fallback, downgradedFrom: requested } : null;
}

/** What to say when a build was moved to a cheaper model. Names both, the
 *  reason, and the way back — a swap nobody explained is a bug report. */
export function downgradedModelMessage(
  choice: BuildModelChoice,
  balance: CreditBalance,
): string {
  const from = choice.downgradedFrom;
  if (!from) return "";
  return `${from.name} needs ${formatCredits(buildDoorFor(from))} credits for a build and you have ${formatCredits(
    totalCredits(balance),
  )}, so this one is running on ${choice.model.name} instead — it costs ${formatCredits(
    buildDoorFor(choice.model),
  )}. Top up or upgrade to build on ${from.name} next time.`;
}

/**
 * What "Auto" actually resolves to for this account.
 *
 * Starts at AUTO_MODEL and steps DOWN until the balance covers the build.
 * Never up: Auto is capped at the default, so it cannot quietly spend Opus
 * money on somebody who asked for nothing in particular. Reaching the dearer
 * models stays a deliberate press in the picker.
 *
 * With no balance to read it returns the ceiling unchanged — the same
 * fail-open the affordability gate takes, since refusing an account we cannot
 * see is worse than letting one build.
 */
export function autoModelFor(balance: CreditBalance | null, planId: PlanId): Model {
  const ceiling = modelById(AUTO_MODEL);
  if (!balance) return ceiling;

  /* Auto is the ceiling asking to be stepped down from, which is exactly what
     resolveBuildModel does. Nothing affordable leaves the ceiling, and the
     caller turns that into a refusal that can still name a price. */
  return resolveBuildModel(ceiling, balance, planId)?.model ?? ceiling;
}

/** The plan above this one, or null at the top. */
export function nextPlanUp(planId: PlanId): Plan | null {
  const next = PLAN_ORDER[PLAN_ORDER.indexOf(planId) + 1];
  return next ? PLANS[next] : null;
}

/**
 * Why a build cannot start, written for someone who wants to build one.
 *
 * Three shapes, in the order they help:
 *   1. Something cheaper on this plan would run  → name it and its price.
 *   2. Nothing runs, but a bigger plan exists    → name the plan and what it grants.
 *   3. Nothing runs and they are on the top plan → top up.
 *
 * An edit is offered in all three, because it is the one thing that stays
 * affordable when a build is not.
 */
export function cannotAffordBuildMessage(
  model: Model,
  balance: CreditBalance,
  planId: PlanId,
): string {
  const held = formatCredits(totalCredits(balance));
  const door = formatCredits(buildDoorFor(model));
  const opening = `A full build on ${model.name} needs ${door} credits and you have ${held}.`;

  const alternative = affordableModels(balance, planId).find((entry) => entry.id !== model.id);
  if (alternative) {
    return `${opening} ${alternative.name} can build it now for up to ${formatCredits(
      buildDoorFor(alternative),
    )} — pick it from the model menu. An edit to the page costs far less again.`;
  }

  const upgrade = nextPlanUp(planId);
  if (upgrade) {
    return `${opening} No model on the ${PLANS[planId].name} plan fits that balance right now. ${upgrade.name} is $${upgrade.monthlyPriceUsd} a month for ${upgrade.monthlyCredits} credits, or top up ${TOP_UP_PACK.credits} for $${TOP_UP_PACK.priceUsd}. Asking for a change to the page costs far less than a build.`;
  }

  return `${opening} Top up ${TOP_UP_PACK.credits} credits for $${TOP_UP_PACK.priceUsd} to keep building. Asking for a change to the page costs far less than a build.`;
}
