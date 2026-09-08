"use client";

import React from "react";

import { PLANS, type PlanId } from "../../credits";

interface PricingCardProps {
  plan: PlanId;
}

export default function PricingCard({ plan }: PricingCardProps) {
  const { name, monthlyPriceUsd } = PLANS[plan];

  return (
    /* An elevated surface with a hairline, not a coloured slab.
     *
     * This was a three-stop gold gradient with a dotted overlay on it — a
     * colourful card, a decorative pattern and a gradient, which is three of
     * the four things the palette's direction names to avoid, on the one
     * surface in the product that is meant to read as expensive. Premium here
     * is carried by the surface, the space and the size of the figure; the
     * accent appears once, on the plan's name, because that is the thing being
     * chosen. */
    <div className="relative overflow-hidden rounded-[22px] border border-line/[0.08] bg-sunken p-5">
      <div className="relative z-10 mb-4 flex items-center justify-between">
        <span className="text-base font-semibold text-accent">{name}</span>
      </div>

      {/* One figure: what the plan costs. It previously led with a promotional $0
          for the middle tier, which read as the price and disagreed with every
          other pricing surface in the product. */}
      <div className="relative z-10 flex flex-wrap items-end gap-2">
        <span className="text-[44px] font-semibold leading-none tracking-tight text-ink sm:text-[48px]">
          ${monthlyPriceUsd}
        </span>
        <span className="mb-1.5 text-xs font-medium text-muted">
          {monthlyPriceUsd === 0 ? "/ free forever" : "/ month"}
        </span>
      </div>
    </div>
  );
}
