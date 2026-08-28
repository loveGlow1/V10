"use client";

import React from "react";
import { Check } from "lucide-react";

import { PLANS, type PlanId } from "../../credits";

/* The entitlements come from the selected plan itself, so the list cannot
   promise something the credit economy does not grant — and so choosing Pro
   changes what is listed, which it previously did not. */
export default function FeatureList({ plan = "standard" }: { plan?: PlanId }) {
  return (
    <ul className="space-y-3">
      {PLANS[plan].features.map((feature) => (
        <li key={feature} className="flex items-center gap-2.5">
          <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            <Check className="w-3 h-3 text-white" />
          </span>
          <span className="text-white text-sm font-medium">{feature}</span>
        </li>
      ))}
    </ul>
  );
}
