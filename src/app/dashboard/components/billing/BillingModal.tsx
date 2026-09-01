"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import CryptoPaymentModal from "./CryptoPaymentModal";
import PlanSelector from "./PlanSelector";
import PricingCard from "./PricingCard";
import FeatureList from "./FeatureList";
import UpgradeButton from "./UpgradeButton";
import { PLANS, TOP_UP_PACK, type PlanId } from "../../credits";
import { isPaidPlanId, type Purchase } from "@/lib/crypto-payments";

interface BillingModalProps {
  open: boolean;
  onClose: () => void;
}

export default function BillingModal({ open, onClose }: BillingModalProps) {
  /* Standard is preselected: it is the plan most people are choosing between the
     other two, not the one they are already on. */
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("standard");

  /* What checkout is open for, or null. Held here rather than inside the
     checkout so that closing this sheet cannot take a payment screen down with
     it: an order in flight is an address somebody may be mid-way through
     sending to. */
  const [checkout, setCheckout] = useState<Purchase | null>(null);

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={onClose}
              className="fixed inset-0 bg-black/70 z-40"
            />

            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="fixed bottom-0 inset-x-0 mx-auto w-[94%] sm:w-[96%] max-w-md z-50 max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-[28px] bg-panel/[0.92] backdrop-blur-[28px] border border-line/[0.08] shadow-[0_30px_80px_rgba(0,0,0,0.45)] pb-[max(2rem,env(safe-area-inset-bottom))]"
            >
              {/* Drag indicator */}
              <div className="flex justify-center pt-3">
                <span className="w-10 h-1.5 rounded-full bg-layer/20" />
              </div>

              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 w-10 h-10 rounded-full bg-transparent border border-line/40 flex items-center justify-center hover:rotate-90 transition-transform duration-250 active:scale-[0.98]"
                aria-label="Close"
              >
                <X className="w-4 h-4 text-ink" />
              </button>

              <div className="px-5 pt-6">
                {/* pr-14 keeps the headline clear of the close button, which it ran
                    underneath once the title wrapped to a second line. */}
                <h1 className="text-[28px] sm:text-[30px] font-bold text-ink leading-[1.1] pr-14">
                  Try QuickStark.Ai for free
                </h1>
                <p className="text-muted text-sm font-medium mt-2">
                  Choose your plan. Cancel anytime.
                </p>

                <div className="mt-5">
                  <PlanSelector selected={selectedPlan} onSelect={setSelectedPlan} />
                </div>

                <div className="mt-4">
                  <PricingCard plan={selectedPlan} />
                </div>

                <div className="mt-5">
                  <FeatureList plan={selectedPlan} />
                </div>

                <div className="mt-5">
                  <UpgradeButton
                    plan={selectedPlan}
                    onUpgrade={(plan) =>
                      isPaidPlanId(plan) && setCheckout({ kind: "plan", planId: plan })
                    }
                  />
                </div>

                {/* The footnote states the same figure as the card, rather than a
                    promotional one that disagreed with it. */}
                <p className="text-muted text-xs font-medium text-center mt-3">
                  {PLANS[selectedPlan].monthlyPriceUsd === 0
                    ? "No card required. Upgrade whenever you need more."
                    : `$${PLANS[selectedPlan].monthlyPriceUsd} per month, paid in crypto. Cancel anytime.`}
                </p>

                {/* The other thing a person opens this sheet to do. Somebody who
                    needs one more publish today is not looking for a plan, and
                    making them take one to get five dollars' worth of credits is
                    how a top-up becomes a cancellation. */}
                <button
                  onClick={() => setCheckout({ kind: "topup", packs: 1 })}
                  className="mt-4 w-full rounded-2xl border border-line/15 bg-layer/[0.04] px-4 py-3 text-sm font-semibold text-ink active:scale-[0.99]"
                >
                  Or top up {TOP_UP_PACK.credits} credits for ${TOP_UP_PACK.priceUsd}
                  <span className="mt-0.5 block text-xs font-medium text-muted">
                    One-off. Top-up credits never expire.
                  </span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <CryptoPaymentModal
        open={checkout !== null}
        purchase={checkout}
        onClose={() => setCheckout(null)}
      />
    </>
  );
}
