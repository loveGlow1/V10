"use client";

import React from "react";
import { motion } from "framer-motion";

import { PLANS, PLAN_ORDER, type PlanId } from "../../credits";

interface PlanSelectorProps {
  selected: PlanId;
  onSelect: (plan: PlanId) => void;
}

/* Every plan the platform sells, in price order, read from the plan table rather
   than written out here — the two tiers this used to hard-code had drifted from
   the prices on the marketing pages, and a third could not be added without
   copying the markup again. */
export default function PlanSelector({ selected, onSelect }: PlanSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {PLAN_ORDER.map((id) => {
        const plan = PLANS[id];
        const isSelected = id === selected;

        return (
          <motion.button
            key={id}
            onClick={() => onSelect(id)}
            aria-pressed={isSelected}
            animate={
              isSelected
                ? { boxShadow: "0 0 0 2px #22C55E, 0 0 20px rgba(34,197,94,0.2)" }
                : { boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }
            }
            transition={{ duration: 0.25 }}
            className="rounded-2xl bg-[#18181B] p-3 text-left active:scale-[0.98]"
          >
            <span
              className={`mb-2 flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                isSelected ? "border-[#22C55E]" : "border-white/30"
              }`}
            >
              {isSelected && <span className="h-2 w-2 rounded-full bg-[#22C55E]" />}
            </span>

            <p className="mb-1 text-[15px] font-bold leading-tight text-white">{plan.name}</p>
            {/* The plan's own price, not a promotional one. */}
            <p className="text-sm font-bold text-[#22C55E]">${plan.monthlyPriceUsd}</p>
          </motion.button>
        );
      })}
    </div>
  );
}
