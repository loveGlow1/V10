"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bitcoin, CreditCard, Loader2, X } from "lucide-react";
import CryptoPaymentModal from "./CryptoPaymentModal";
import PlanSelector from "./PlanSelector";
import PricingCard from "./PricingCard";
import FeatureList from "./FeatureList";
import UpgradeButton from "./UpgradeButton";
import { ANNUAL_DISCOUNT, PLANS, TOP_UP_PACK, planPriceUsd, type PlanId } from "../../credits";
import { MAX_TOP_UP_USD, MIN_TOP_UP_USD, isPaidPlanId, topUpCreditsFor, type Purchase } from "@/lib/crypto-payments";
import { useCredits } from "../../useCredits";
import { PaymentMethod } from "./CardWelcome";

interface BillingModalProps {
  open: boolean;
  onClose: () => void;
}

/* One tap for the usual amounts; any other is typed. */
const TOP_UP_PRESETS = [TOP_UP_PACK.priceUsd, 20, 100, 500, 1000] as const;

export default function BillingModal({ open, onClose }: BillingModalProps) {
  /* Standard is preselected: it is the plan most people are choosing between the
     other two, not the one they are already on. */
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("standard");
  /* A month or a year of the selected plan. Monthly by default: it is the
     smaller commitment, and the saving is one tap away. */
  const [annual, setAnnual] = useState(false);

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
  const [topUpUsd, setTopUpUsd] = useState(String(TOP_UP_PACK.priceUsd));
  /* Top-ups are for accounts that have had a paid plan; asked each time the
     sheet opens, since buying a plan is what opens them. Unknown (null)
     shows the box — the payment routes refuse it anyway. */
  const [topUpAllowed, setTopUpAllowed] = useState<boolean | null>(null);
  const [topUpLockedReason, setTopUpLockedReason] = useState<string | null>(null);
  /* What is left of this month's $10,000; the most one top-up can be. */
  const [topUpRoom, setTopUpRoom] = useState<number>(MAX_TOP_UP_USD);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void fetch("/api/payments/top-up", { cache: "no-store" })
      .then((response) =>
        response.ok ? (response.json() as Promise<{ allowed?: boolean; reason?: string | null; roomUsd?: number }>) : null,
      )
      .then((body) => {
        if (!live || !body) return;
        setTopUpAllowed(body.allowed === true);
        setTopUpLockedReason(body.reason ?? null);
        if (typeof body.roomUsd === "number") setTopUpRoom(Math.min(MAX_TOP_UP_USD, body.roomUsd));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open]);

  /* A paid plan renews on its card until it is cancelled — in Stripe's
     billing portal, which also changes the card and shows invoices. */
  const { planId: currentPlan } = useCredits();
  const [portalBusy, setPortalBusy] = useState(false);
  async function openPortal() {
    setPortalBusy(true);
    setCardError(null);
    const response = await fetch("/api/payments/stripe/portal", { method: "POST" }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as { url?: string; error?: string } | undefined;
    if (body?.url) return window.location.assign(body.url);
    setCardError(body?.error ?? "Billing could not be opened. Try again.");
    setPortalBusy(false);
  }

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
    ? annual
      ? { kind: "plan", planId: selectedPlan, months: 12 }
      : { kind: "plan", planId: selectedPlan }
    : null;
  const planPrice = planPriceUsd(selectedPlan, annual ? 12 : 1);
  const priceText = `$${Number.isInteger(planPrice) ? planPrice : planPrice.toFixed(2)}`;
  const topUpAmount = Number(topUpUsd);
  const topUpMax = Math.min(MAX_TOP_UP_USD, topUpRoom);
  const topUpValid = Number.isInteger(topUpAmount) && topUpAmount >= MIN_TOP_UP_USD && topUpAmount <= topUpMax;
  const topUpPurchase: Purchase = { kind: "topup", usd: topUpValid ? topUpAmount : TOP_UP_PACK.priceUsd };

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

                {PLANS[selectedPlan].monthlyPriceUsd > 0 && (
                  <div
                    role="radiogroup"
                    aria-label="Billing period"
                    className="mt-4 grid grid-cols-2 gap-1 rounded-2xl border border-line/15 bg-layer/[0.04] p-1"
                  >
                    {[
                      { value: false, label: "Monthly" },
                      { value: true, label: `Annual · save ${Math.round(ANNUAL_DISCOUNT * 100)}%` },
                    ].map((option) => (
                      <button
                        key={option.label}
                        role="radio"
                        aria-checked={annual === option.value}
                        onClick={() => setAnnual(option.value)}
                        className={`h-9 rounded-xl text-sm font-semibold transition-colors ${
                          annual === option.value ? "bg-solid text-onSolid" : "text-muted"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-4">
                  <PricingCard plan={selectedPlan} months={annual ? 12 : 1} />
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
                        Pay {priceText} with card
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
                    ? `Add a card to start — nothing is charged today. A month later it moves to Standard at $${PLANS.standard.monthlyPriceUsd}/month unless you cancel first in Billing.`
                    : annual
                      ? `${priceText} a year — ${PLANS[selectedPlan].monthlyCredits} credits every month. By card it renews every year until you cancel, plus applicable tax (added at checkout where your country requires it). By crypto, ${priceText} for 12 months, paid once.`
                      : `${priceText} a month. By card it renews every month until you cancel, plus applicable tax (added at checkout where your country requires it). By crypto, ${priceText} for one month, paid once.`}
                </p>

                {currentPlan !== "free" && (
                  <button
                    type="button"
                    onClick={() => void openPortal()}
                    disabled={portalBusy}
                    className="mx-auto mt-3 flex items-center gap-1.5 text-xs font-semibold text-ink underline underline-offset-2 disabled:opacity-50"
                  >
                    {portalBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                    Manage or cancel your subscription
                  </button>
                )}

                {/* The other thing a person opens this sheet to do. Somebody who
                    needs one more publish today is not looking for a plan, and
                    making them take a monthly subscription to get one pack's
                    worth of credits is how a top-up becomes a cancellation. */}
                {/* The card on file: replace or remove it here, without
                    leaving for Stripe's portal. */}
                <PaymentMethod onManagePlan={() => void openPortal()} />

                {topUpAllowed === false ? (
                  <div className="mt-4 rounded-2xl border border-line/15 bg-layer/[0.04] px-4 py-3">
                    <p className="text-sm font-semibold text-ink text-center">Or add credit</p>
                    <p className="mt-0.5 text-xs font-medium text-muted text-center">
                      {topUpLockedReason ?? "Top-ups open once you've had a paid plan."}
                    </p>
                  </div>
                ) : (
                <div className="mt-4 rounded-2xl border border-line/15 bg-layer/[0.04] px-4 py-3">
                  <p className="text-sm font-semibold text-ink text-center">Or add credit</p>
                  {/* Any whole-dollar amount, at the pack's rate. Balance only:
                      no amount unlocks a plan's models or perks. */}
                  <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
                    {TOP_UP_PRESETS.filter((usd) => usd <= topUpMax).map((usd) => (
                      <button
                        key={usd}
                        type="button"
                        onClick={() => setTopUpUsd(String(usd))}
                        className={`h-8 rounded-full border px-3 text-xs font-semibold transition-colors ${
                          topUpAmount === usd ? "border-ink bg-ink text-canvas" : "border-line/20 text-ink hover:bg-layer/[0.06]"
                        }`}
                      >
                        ${usd}
                      </button>
                    ))}
                    <label className="flex h-8 items-center gap-1 rounded-full border border-line/20 px-3 text-xs font-semibold text-ink">
                      $
                      <input
                        type="number"
                        inputMode="numeric"
                        min={MIN_TOP_UP_USD}
                        max={topUpMax}
                        step={1}
                        value={topUpUsd}
                        onChange={(event) => setTopUpUsd(event.target.value)}
                        aria-label="Amount in US dollars"
                        className="w-16 bg-transparent outline-none"
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-xs font-medium text-muted text-center">
                    {topUpValid
                      ? `${topUpCreditsFor(topUpAmount).toLocaleString("en-US")} credits for $${topUpAmount.toLocaleString("en-US")}. One-off, never expire. Balance only — plans unlock every model. Plus applicable tax by card.`
                      : `Enter a whole amount from $${MIN_TOP_UP_USD} to $${topUpMax.toLocaleString("en-US")}${topUpMax < MAX_TOP_UP_USD ? " — what is left of this month's $10,000" : ""}.`}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <GatewayButton
                      small
                      icon={<CreditCard className="h-3.5 w-3.5" />}
                      busy={cardBusy === JSON.stringify(topUpPurchase)}
                      disabled={cardBusy !== null || !topUpValid}
                      onClick={() => payByCard(topUpPurchase)}
                    >
                      Card
                    </GatewayButton>
                    <GatewayButton
                      small
                      icon={<Bitcoin className="h-3.5 w-3.5" />}
                      disabled={cardBusy !== null || !topUpValid}
                      onClick={() => setCheckout(topUpPurchase)}
                    >
                      Crypto
                    </GatewayButton>
                  </div>
                </div>
                )}
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
