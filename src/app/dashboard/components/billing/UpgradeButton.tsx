"use client";

import React from "react";
import { motion } from "framer-motion";

import { PLANS, type PlanId } from "../../credits";

/* The label names the plan the button actually applies to, so it cannot promise
   something different from the card above it. */
export default function UpgradeButton({ plan = "standard" }: { plan?: PlanId }) {
  const { name, monthlyPriceUsd } = PLANS[plan];

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.15 }}
      className="h-13 w-full rounded-2xl bg-solid py-3.5 text-base font-bold text-[#0A0A0A]"
    >
      {monthlyPriceUsd === 0 ? `Stay on ${name}` : `Upgrade to ${name}`}
    </motion.button>
  );
}
