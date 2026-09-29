"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bitcoin, CreditCard, Loader2, X } from "lucide-react";
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

  /* The card gateway. Separate from crypto end to end: it never opens the
     crypto sheet or waits on coin prices — it asks the Stripe route for a
     hosted checkout page and the browser goes there. The route prices the
     purchase from the same tables, and the webhook grants it. */
  const [cardBusy, setCardBusy] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  async function payByCard(purchase: Purchase) {
    const key = JSON.stringify(purchase);
    setCardBusy(key);
    setCardError(null);
    try {
      const response = await fetch("/api/payments/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchase }),
      });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !body.url) {
        setCardError(body.error ?? "Card payments are unavailable right now.");
        setCardBusy(null);
        return;
      }
      /* Left busy on purpose: the page is on its way to Stripe. */
      window.location.assign(body.url);
    } catch {
      setCardError("Could not reach the server. Check your connection and try again.");
      setCardBusy(null);
    }
  }

  const planPurchase: Purchase | null = isPaidPlanId(selectedPlan)
    ? { kind: "plan", planId: selectedPlan }
    : null;
  const topUpPurchase: Purchase = { kind: "topup", packs: 1 };

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
                  {planPurchase ? (
                    <div className="space-y-2">
                      <GatewayButton
                        primary
                        icon={<CreditCard className="h-4 w-4" />}
                        busy={cardBusy === JSON.stringify(planPurchase)}
                        disabled={cardBusy !== null}
                        onClick={() => payByCard(planPurchase)}
                      >
                        Pay ${PLANS[selectedPlan].monthlyPriceUsd} with card
                      </GatewayButton>
                      <GatewayButton
                        icon={<Bitcoin className="h-4 w-4" />}
                        disabled={cardBusy !== null}
                        onClick={() => setCheckout(planPurchase)}
                      >
                        Pay with crypto
                      </GatewayButton>
                    </div>
                  ) : (
                    <UpgradeButton plan={selectedPlan} />
                  )}
                </div>

                {cardError && (
                  <p className="mt-3 rounded-2xl border border-danger/30 bg-danger/[0.08] px-4 py-3 text-sm font-medium text-danger">
                    {cardError}
                  </p>
                )}

                {/* The footnote states the same figure as the card, rather than a
                    promotional one that disagreed with it. */}
                <p className="text-muted text-xs font-medium text-center mt-3">
                  {PLANS[selectedPlan].monthlyPriceUsd === 0
                    ? "No card required. Upgrade whenever you need more."
                    : `$${PLANS[selectedPlan].monthlyPriceUsd} per month. By card, plus applicable tax (added at checkout where your country requires it); by crypto, exactly $${PLANS[selectedPlan].monthlyPriceUsd}. Cancel anytime.`}
                </p>

                {/* The other thing a person opens this sheet to do. Somebody who
                    needs one more publish today is not looking for a plan, and
                    making them take a monthly subscription to get one pack's
                    worth of credits is how a top-up becomes a cancellation. */}
                <div className="mt-4 rounded-2xl border border-line/15 bg-layer/[0.04] px-4 py-3">
                  <p className="text-sm font-semibold text-ink text-center">
                    Or top up {TOP_UP_PACK.credits} credits for ${TOP_UP_PACK.priceUsd}
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-muted text-center">
                    One-off. Top-up credits never expire. Plus applicable tax by card.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <GatewayButton
                      small
                      icon={<CreditCard className="h-3.5 w-3.5" />}
                      busy={cardBusy === JSON.stringify(topUpPurchase)}
                      disabled={cardBusy !== null}
                      onClick={() => payByCard(topUpPurchase)}
                    >
                      Card
                    </GatewayButton>
                    <GatewayButton
                      small
                      icon={<Bitcoin className="h-3.5 w-3.5" />}
                      disabled={cardBusy !== null}
                      onClick={() => setCheckout(topUpPurchase)}
                    >
                      Crypto
                    </GatewayButton>
                  </div>
                </div>
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

function GatewayButton({
  children,
  icon,
  onClick,
  primary = false,
  small = false,
  busy = false,
  disabled = false,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  small?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center justify-center gap-2 rounded-2xl font-bold active:scale-[0.99] disabled:opacity-60 ${
        small ? "h-10 text-sm" : "h-12 text-base"
      } ${
        primary
          ? "bg-solid text-[#0A0A0A]"
          : "border border-line/15 bg-layer/[0.04] text-ink"
      }`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
