"use client";

import React from "react";

import { ANNUAL_DISCOUNT, PLANS, planPriceUsd, type PlanId, type PlanMonths } from "../../credits";

interface PricingCardProps {
  plan: PlanId;
  /** 12 shows the annual price: the discounted monthly figure and the year's total. */
  months?: PlanMonths;
}

function formatUsd(value: number) {
  return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

export default function PricingCard({ plan, months = 1 }: PricingCardProps) {
  const { name, monthlyPriceUsd } = PLANS[plan];
  const annual = months === 12 && monthlyPriceUsd > 0;
  const yearly = planPriceUsd(plan, 12);
  const perMonth = annual ? yearly / 12 : monthlyPriceUsd;

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-[#F6E7A8] via-[#F4D48C] to-[#F1C38A] p-5">
      {/* Dotted decorative pattern */}
      <div
        className="pointer-events-none absolute top-0 right-0 h-24 w-24 opacity-30"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.25) 1.5px, transparent 1.5px)",
          backgroundSize: "8px 8px",
        }}
      />

      <div className="relative z-10 mb-4 flex items-center justify-between">
        <span className="text-base font-bold text-onSolid">{name} ⚡</span>
      </div>

      {/* One figure: what the plan costs. It previously led with a promotional $0
          for the middle tier, which read as the price and disagreed with every
          other pricing surface in the product. On annual, the per-month figure
          is the year's price divided by twelve — the same arithmetic both
          checkouts charge — with the monthly price struck through beside it. */}
      <div className="relative z-10 flex flex-wrap items-end gap-2">
        <span className="text-[44px] font-extrabold leading-none text-onSolid sm:text-[48px]">
          {formatUsd(perMonth)}
        </span>
        <span className="mb-1.5 text-xs font-medium text-onSolid">
          {monthlyPriceUsd === 0 ? "/ free forever" : "/ month + applicable tax"}
        </span>
        {annual && (
          <span className="mb-1.5 text-xs font-medium text-onSolid/60 line-through">
            {formatUsd(monthlyPriceUsd)}
          </span>
        )}
      </div>
      {annual && (
        <p className="relative z-10 mt-2 text-xs font-semibold text-onSolid">
          {formatUsd(yearly)} for 12 months — save {Math.round(ANNUAL_DISCOUNT * 100)}%
        </p>
      )}
    </div>
  );
}
