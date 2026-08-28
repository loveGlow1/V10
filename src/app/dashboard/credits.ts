/* The credit economy, in one place.

   Everything the platform charges for — what a plan grants, what an action
   costs, which bucket a charge comes out of — is decided here so that no
   surface can quote a different number than the one that will be billed. The
   dashboard, the billing modal and (once it exists) the server-side meter all
   read this module; none of them carry a figure of their own.

   Two rules are structural rather than conventional, because the business
   model rests on them:

     1. Publishing is free. `creditCostOf` returns 0 for a publish before it
        looks at anything else, so no future signal — token count, file count,
        plan — can make a deploy cost credits.
     2. Credits are spent expiring-soonest-first: today's daily grant, then
        last cycle's rollover, then this cycle's grant, then top-ups (which
        never expire). Spending the pool in any other order silently burns
        credits the user paid for while free ones expire unused.

   Nothing here reaches a database or a network. It is pure arithmetic over a
   balance, which is what lets the same functions run in the composer to
   preview a cost and on the server to enforce one. */

export type PlanId = "free" | "standard" | "pro";

/* Both plans get the same daily grant — the spec gives Free "5 daily build
   credits" and Pro "100 monthly credits + daily allowances", so the daily
   allowance is a platform-wide floor rather than a per-plan figure. */
export const DAILY_ALLOWANCE = 5;

export type Plan = {
  id: PlanId;
  name: string;
  /** What the plan costs per month, in whole dollars. Free is 0. */
  monthlyPriceUsd: number;
  /** Granted every day and never carried forward — use it or lose it. */
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
    dailyCredits: DAILY_ALLOWANCE,
    monthlyCredits: 0,
    /* Daily credits are explicitly non-rolling: an unused day is gone. */
    rolloverCycles: 0,
    publishing: {
      subdomain: ".quickstart.ai",
      customDomains: false,
      privateRepos: false,
    },
    support: "Standard community support",
    features: [
      `${DAILY_ALLOWANCE} daily build credits`,
      "Publish to a quickstart.ai subdomain",
      "Unlimited sandbox iteration",
      "Standard community support",
    ],
  },
  standard: {
    id: "standard",
    name: "Standard",
    monthlyPriceUsd: 25,
    dailyCredits: DAILY_ALLOWANCE,
    monthlyCredits: 100,
    rolloverCycles: 1,
    publishing: {
      subdomain: ".quickstart.ai",
      customDomains: true,
      privateRepos: true,
    },
    support: "Priority support",
    features: [
      "100 credits/month, plus daily allowances",
      "Private repositories and custom domains",
      "Unused credits roll over one cycle",
      "GitHub integration",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPriceUsd: 150,
    dailyCredits: DAILY_ALLOWANCE,
    /* The one allowance the specification does not state. Held at Standard's
       rate of four credits per dollar, so the step up in price is a step up in
       capacity rather than a change of deal. Change this line, not the UI, if
       the intended figure is different. */
    monthlyCredits: 600,
    rolloverCycles: 1,
    publishing: {
      subdomain: ".quickstart.ai",
      customDomains: true,
      privateRepos: true,
    },
    support: "Priority support",
    features: [
      "600 credits/month, plus daily allowances",
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

/* What a credit is worth in money, taken from the only place the platform puts
   a price on one. Everything that needs to convert between dollars and credits
   goes through this rather than carrying its own rate. */
export const CREDITS_PER_USD = TOP_UP_PACK.credits / TOP_UP_PACK.priceUsd;

export function creditsForUsd(usd: number): number {
  return roundCredits(usd * CREDITS_PER_USD);
}

/* Every new account opens with this much credit, on the house. Held in dollars
   because that is how the offer is made — "$5 of credit to get started" — and
   converted at the rate above, so raising the top-up rate does not silently
   change what a new account is worth. */
export const SIGNUP_BONUS_USD = 5;

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
    min: 0,
    max: 1,
    description:
      "Low-overhead conversational prompts, error troubleshooting, and architecture planning.",
    billedInCredits: true,
  },
  generate: {
    id: "generate",
    label: "Code generation / file editing",
    min: 0.5,
    max: 2.5,
    description:
      "Variable cost based on output token length and scope of file modifications.",
    billedInCredits: true,
  },
  publish: {
    id: "publish",
    label: "Production publishing / deploy",
    min: 0,
    max: 0,
    description:
      "Free. Pushing code live to Vercel does not deduct from the credit balance.",
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
};

/* Tuning constants for the bands above. Named rather than inlined so the shape
   of the curve is legible: a chat turn reaches its 1-credit ceiling at roughly
   a full page of output, and a generation reaches its 2.5 ceiling at a large
   multi-file change. */
const CHAT_TOKENS_PER_CREDIT = 1200;
const GENERATE_TOKENS_PER_CREDIT = 2000;
const GENERATE_CREDITS_PER_FILE = 0.25;

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

  /* Publishing and runtime never touch the pool. Returned before any signal is
     read, so no future input can turn a deploy into a charge. */
  if (action === "publish" || !spec.billedInCredits) return 0;

  const outputTokens = Math.max(0, signal.outputTokens ?? 0);
  const filesTouched = Math.max(0, signal.filesTouched ?? 0);

  if (action === "chat") {
    /* A one-line answer is free; a long one costs the single credit the band
       allows. Troubleshooting a build should not feel metered. */
    return clamp(roundCredits(outputTokens / CHAT_TOKENS_PER_CREDIT), spec.min, spec.max);
  }

  /* Generation starts at the floor — any edit is worth something — and grows
     with how much was written and how many files it reached. */
  const cost =
    spec.min +
    outputTokens / GENERATE_TOKENS_PER_CREDIT +
    filesTouched * GENERATE_CREDITS_PER_FILE;

  return clamp(roundCredits(cost), spec.min, spec.max);
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
 * What a brand-new account holds the moment it is created: the Free plan's
 * opening allowance plus the signup bonus.
 *
 * The bonus lands in the top-up bucket rather than the daily one, so it behaves
 * the way a gift should — it does not expire tonight, and it is spent only once
 * the day's free allowance is gone.
 */
export function signupBalance(): CreditBalance {
  return { ...startingBalance("free"), topUp: creditsForUsd(SIGNUP_BONUS_USD) };
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
