"use client";

import React from "react";
import { motion } from "framer-motion";

import { PLANS, type PlanId } from "../../credits";

/* The label names the plan the button actually applies to, so it cannot promise
   something different from the card above it.

   On a paid plan it opens checkout. On Free there is nothing to buy, so it says
   so and does nothing — a button that reads "Stay on Free" and then asks for
   money would be the plainest kind of lie a billing screen can tell. */
export default function UpgradeButton({
  plan = "standard",
  onUpgrade,
}: {
  plan?: PlanId;
  onUpgrade?: (plan: PlanId) => void;
}) {
  const { name, monthlyPriceUsd } = PLANS[plan];
  const free = monthlyPriceUsd === 0;

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.15 }}
      onClick={() => !free && onUpgrade?.(plan)}
      disabled={free}
      className="h-13 w-full rounded-2xl bg-solid py-3.5 text-base font-bold text-[#0A0A0A] disabled:opacity-60"
    >
      {free ? `Stay on ${name}` : `Upgrade to ${name}`}
    </motion.button>
  );
}
