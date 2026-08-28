"use client";

import { Check } from "lucide-react";

import { PLANS } from "../dashboard/credits";

export default function PricingPage() {
  /* Three tiers, priced from the credit economy rather than written out here —
     this page quoted $16 for the middle plan while the dashboard sold it at a
     different figure again. */
  const tiers = [
    { name: "Hobbyist", price: `$${PLANS.free.monthlyPriceUsd}`, desc: "Excellent tier to experiment with natural language architectures." },
    { name: "Professional", price: `$${PLANS.standard.monthlyPriceUsd}`, desc: "Best for builders, production systems, and fast scaling tools.", highlight: true },
    { name: "Enterprise", price: `$${PLANS.pro.monthlyPriceUsd}`, desc: "Engineered for corporations demanding strict isolated setups." }
  ];

  return (
    <div className="bg-brandBg min-h-[100dvh] text-white py-32 px-6 relative">
      <div className="noise-bg" />
      <div className="max-w-5xl mx-auto relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight">Production Tier Infrastructure</h1>
          <p className="text-brandTextSec mt-4 text-lg">Choose the capacity matrix required for your autonomous software generation engines.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {tiers.map((t) => (
            <div key={t.name} className={`glass-card rounded-premium p-8 flex flex-col justify-between ${t.highlight ? 'border-brandGreen/40 pro-glow-border scale-[1.02]' : ''}`}>
              <div>
                <h3 className="text-xl font-bold text-white">{t.name}</h3>
                <p className="text-sm text-brandTextSec mt-2 leading-relaxed">{t.desc}</p>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-white">{t.price}</span>
                  <span className="text-brandTextSec text-sm">/ month</span>
                </div>
              </div>
              <button className={`mt-8 w-full py-3 px-4 rounded-pill font-bold text-sm transition-all duration-300 ${t.highlight ? 'bg-brandGreen text-black hover:bg-white' : 'bg-brandSurface border border-brandBorder text-white hover:border-brandGreen'}`}>
                Select Matrix Allocation
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}