"use client";

import React from "react";

import { PLANS, type PlanId } from "../../credits";

interface PricingCardProps {
  plan: PlanId;
}

export default function PricingCard({ plan }: PricingCardProps) {
  const { name, monthlyPriceUsd } = PLANS[plan];

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
        <span className="text-base font-bold text-black">{name} ⚡</span>
      </div>

      {/* One figure: what the plan costs. It previously led with a promotional $0
          for the middle tier, which read as the price and disagreed with every
          other pricing surface in the product. */}
      <div className="relative z-10 flex flex-wrap items-end gap-2">
        <span className="text-[44px] font-extrabold leading-none text-black sm:text-[48px]">
          ${monthlyPriceUsd}
        </span>
        <span className="mb-1.5 text-xs font-medium text-black">
          {monthlyPriceUsd === 0 ? "/ free forever" : "/ month"}
        </span>
      </div>
    </div>
  );
}
