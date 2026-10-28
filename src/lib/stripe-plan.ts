import type Stripe from "stripe";

import { purchaseCredits, purchaseLabel, purchasePriceUsd, type Purchase } from "@/lib/crypto-payments";
import { ANNUAL_DISCOUNT, PLANS } from "@/app/dashboard/credits";

/* What a Stripe Checkout line for a purchase says and costs — one place, so a
 * plan bought outright (/api/payments/stripe/checkout) and the plan a welcome
 * trial turns into (/api/payments/stripe/card) are the same product at the
 * same price. Priced inline from PLANS, so there is nothing to keep in step in
 * the Stripe Dashboard. */

/* The Stripe tax category every QuickStark product is sold under: Software as
   a Service, business use. Chosen by the owner; required by Managed Payments,
   which rejects a line item without an eligible code. */
export const PRODUCT_TAX_CODE = "txcd_10103001";

export function lineItemFor(purchase: Purchase): Stripe.Checkout.SessionCreateParams.LineItem {
  const credits = purchaseCredits(purchase);
  return {
    quantity: 1,
    price_data: {
      currency: "usd",
      unit_amount: Math.round(purchasePriceUsd(purchase) * 100),
      ...(purchase.kind === "plan" ? { recurring: { interval: purchase.months === 12 ? ("year" as const) : ("month" as const) } } : {}),
      product_data: {
        name:
          purchase.kind !== "plan"
            ? `QuickStark ${purchaseLabel(purchase)}`
            : purchase.months === 12
              ? `QuickStark ${PLANS[purchase.planId].name} plan — yearly`
              : `QuickStark ${PLANS[purchase.planId].name} plan — monthly`,
        description:
          purchase.kind !== "plan"
            ? `${credits} credits. Top-up credits never expire.`
            : purchase.months === 12
              ? `${credits} credits every month. Renews every year; cancel anytime. ${Math.round(ANNUAL_DISCOUNT * 100)}% less than monthly.`
              : `${credits} credits every month. Renews monthly; cancel anytime.`,
        tax_code: PRODUCT_TAX_CODE,
      },
    },
  };
}

/* ── The welcome trial ────────────────────────────────────────────────────
 *
 * The way the big SaaS products do it: a new account adds a card, gets its
 * free credit now, and is on a free month of a paid plan that bills on the
 * same day next month unless it is cancelled first (in the billing portal).
 * Stripe Checkout shows the terms on its own page ("1 month free, then $25.00
 * per month starting …"), the trial is a real Stripe subscription, and every
 * paid invoice after it is settled like any plan's (settlePaidInvoice). */

export const WELCOME_TRIAL_PLAN = "standard" as const;
export const WELCOME_TRIAL_PURCHASE: Purchase = { kind: "plan", planId: WELCOME_TRIAL_PLAN, months: 1 };

/** The same day next month, at this time — or the month's last day when it
 *  has no such day (Jan 31 → Feb 28), which is how Stripe bills months too. */
export function trialEndFrom(now: Date): Date {
  const end = new Date(now.getTime());
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return end;
}

/** What the screens say before the card is added: the plan, its price and
 *  the day the first charge lands. */
export type TrialOffer = { plan: string; priceUsd: number; credits: number; startsOn: string };

export function welcomeTrialOffer(now: Date): TrialOffer {
  const plan = PLANS[WELCOME_TRIAL_PLAN];
  return { plan: plan.name, priceUsd: plan.monthlyPriceUsd, credits: plan.monthlyCredits, startsOn: trialEndFrom(now).toISOString() };
}
