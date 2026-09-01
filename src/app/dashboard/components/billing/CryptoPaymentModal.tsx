"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Loader2,
  Mail,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";

import {
  CRYPTO_CURRENCIES,
  FEATURED_CURRENCIES,
  formatCryptoAmount,
  formatUsd,
  isOpenStatus,
  isPlausibleEmail,
  orderReference,
  paymentUri,
  purchaseCadence,
  type CryptoCurrencyId,
  type CryptoPayment,
  type CryptoQuote,
  type CurrencyQuote,
  type Purchase,
} from "@/lib/crypto-payments";
import { useCredits } from "../../useCredits";
import CoinMark from "./CoinMark";
import QrCode from "./QrCode";

/* Paying for a plan, or for credits, in cryptocurrency.
 *
 * Two screens, in the order the decision is actually made:
 *
 *   1. Pick a currency. Every coin this deployment takes, priced at the rate
 *      it would be charged at right now.
 *   2. Pay it. A QR code, the exact amount, the address, and then a wait.
 *
 * The line between them is a real one and the screen says so: the second screen
 * exists only once an order has been created on the server, and an order is
 * bound to one coin and one address, because that address is what a wallet is
 * about to send something irreversible to. Going back means a new order at a
 * fresh rate, never the same order in a different currency.
 *
 * Two things this component deliberately does not do:
 *
 *   It does not price anything. Every figure on screen came from
 *   /api/payments/crypto — the amount, the rate, the credits — because a
 *   browser that computed its own total could show one number and be charged
 *   another, and there is no undoing a chain payment made against the wrong
 *   figure.
 *
 *   It does not decide that a payment has arrived. "Confirm payment" records
 *   that the payer says they have sent it; the credits land when the settlement
 *   webhook says the network confirmed it. The screen is honest about that gap
 *   rather than showing a success it cannot vouch for.
 *
 * It must be rendered inside the dashboard's CreditsProvider: a settled payment
 * refreshes the balance in the header, and a paid plan that leaves a stale
 * figure on screen is a support ticket. */

interface CryptoPaymentModalProps {
  open: boolean;
  /** What is being bought. Null closes the modal without a purchase in flight. */
  purchase: Purchase | null;
  onClose: () => void;
  /** Called once, when the payment settles. */
  onSettled?: (payment: CryptoPayment) => void;
}

/* How often the screen asks whether the payment has confirmed. Six seconds is
   fast enough to feel live and slow enough that a tab left open overnight is
   not a load-bearing part of the platform's traffic. */
const POLL_MS = 6_000;

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function purchaseQuery(purchase: Purchase): string {
  return purchase.kind === "plan"
    ? `kind=plan&planId=${purchase.planId}`
    : `kind=topup&packs=${purchase.packs}`;
}

export default function CryptoPaymentModal({
  open,
  purchase,
  onClose,
  onSettled,
}: CryptoPaymentModalProps) {
  const { refresh } = useCredits();

  const [quote, setQuote] = useState<CryptoQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<CryptoCurrencyId>("btc");
  const [lightning, setLightning] = useState(false);
  const [showAllCurrencies, setShowAllCurrencies] = useState(false);
  const [explainLightning, setExplainLightning] = useState(false);
  const [email, setEmail] = useState("");
  const [payment, setPayment] = useState<CryptoPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  /* The purchase arrives as an object literal from the parent, so its identity
     changes on every render. Effects key off what it *says* instead. */
  const purchaseKey = purchase ? JSON.stringify(purchase) : null;

  const status = payment?.status ?? null;
  const paymentId = payment?.id ?? null;

  /* ── Loading the menu ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!open || !purchaseKey) return;

    let cancelled = false;
    setQuote(null);
    setQuoteError(null);

    void (async () => {
      try {
        const response = await fetch(
          `/api/payments/crypto/quote?${purchaseQuery(JSON.parse(purchaseKey) as Purchase)}`,
          { cache: "no-store" },
        );
        const body = await response.json();

        if (cancelled) return;

        if (!response.ok) {
          setQuoteError(body?.error ?? "Crypto payment is unavailable right now.");
          return;
        }

        setQuote(body as CryptoQuote);
      } catch {
        if (!cancelled) setQuoteError("Could not reach the payment service.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, purchaseKey]);

  /* The preselected coin has to be one that is actually on offer. Bitcoin
     leads where it is available — it is what most people arrive intending to
     pay with — and otherwise the first coin the deployment does take. */
  useEffect(() => {
    if (!quote) return;

    setCurrency((current) => {
      if (quote.currencies.some((entry) => entry.currency === current)) return current;
      return quote.currencies[0]?.currency ?? "btc";
    });
  }, [quote]);

  /* Lightning is a property of the coin, so it cannot survive a change of coin:
     leaving it on while switching to one with no Lightning route would send an
     order the server refuses. */
  useEffect(() => {
    setLightning(false);
  }, [currency]);

  /* ── Closing ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (open) return;

    /* Everything resets except nothing: a closed modal keeps no order, no
       quote and no typed address. Re-opening starts a fresh quote, which is
       the only honest thing to do with a rate that has been sitting in a
       closed tab. */
    setQuote(null);
    setQuoteError(null);
    setPayment(null);
    setError(null);
    setCopied(null);
    setBusy(false);
    setShowAllCurrencies(false);
    setExplainLightning(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /* ── Watching an order ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!paymentId || !status || !isOpenStatus(status)) return;

    const tick = async () => {
      try {
        const response = await fetch(`/api/payments/crypto/${paymentId}`, { cache: "no-store" });
        if (!response.ok) return;
        setPayment((await response.json()) as CryptoPayment);
      } catch {
        /* A dropped poll is not news. The next one is six seconds away, and
           replacing the order on screen with an error because one request
           failed would be worse than saying nothing. */
      }
    };

    const timer = setInterval(() => void tick(), POLL_MS);
    return () => clearInterval(timer);
  }, [paymentId, status]);

  /* The countdown on the rate lock, ticking only while there is one. */
  useEffect(() => {
    if (!paymentId || !status || !isOpenStatus(status)) return;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [paymentId, status]);

  /* Settled: the header's balance is stale from this moment, so it is re-read
     here rather than at the next page load. */
  const settledRef = useRef<string | null>(null);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  useEffect(() => {
    if (!payment || payment.status !== "confirmed") return;
    if (settledRef.current === payment.id) return;

    settledRef.current = payment.id;
    void refresh();
    onSettledRef.current?.(payment);
  }, [payment, refresh]);

  /* ── Actions ──────────────────────────────────────────────────────────── */
  const startPayment = useCallback(async () => {
    if (!purchaseKey) return;

    const receiptEmail = email.trim();

    if (receiptEmail && !isPlausibleEmail(receiptEmail)) {
      setError("That email address does not look right. Leave it blank to skip the receipt.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/payments/crypto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purchase: JSON.parse(purchaseKey),
          currency,
          lightning,
          receiptEmail: receiptEmail || undefined,
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        setError(body?.error ?? "Could not start that payment.");
        return;
      }

      setPayment(body as CryptoPayment);
    } catch {
      setError("Could not reach the payment service.");
    } finally {
      setBusy(false);
    }
  }, [currency, email, lightning, purchaseKey]);

  const confirmPayment = useCallback(async () => {
    if (!payment) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/payments/crypto/${payment.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

      const body = await response.json();

      if (!response.ok) {
        setError(body?.error ?? "Could not record that.");
        if (body?.payment) setPayment(body.payment as CryptoPayment);
        return;
      }

      setPayment(body as CryptoPayment);
    } catch {
      setError("Could not reach the payment service.");
    } finally {
      setBusy(false);
    }
  }, [payment]);

  const copy = useCallback(async (field: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(field);
      setTimeout(() => setCopied((current) => (current === field ? null : current)), 2000);
    } catch {
      /* Clipboard access can be refused — an insecure origin, a permission
         policy — and the address is on screen to be selected by hand. */
      setCopied(null);
    }
  }, []);

  const selected: CurrencyQuote | null = useMemo(
    () => quote?.currencies.find((entry) => entry.currency === currency) ?? null,
    [quote, currency],
  );

  const visibleCurrencies = useMemo(() => {
    if (!quote) return [];
    if (showAllCurrencies) return quote.currencies;
    return quote.currencies.filter((entry) => FEATURED_CURRENCIES.includes(entry.currency));
  }, [quote, showAllCurrencies]);

  const hiddenCount = (quote?.currencies.length ?? 0) - visibleCurrencies.length;

  return (
    <AnimatePresence>
      {open && purchase && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/70"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Crypto payment"
            initial={{ y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0.6 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            /* A bottom sheet at every width, the same as the billing sheet it
               opens from. Centring it on desktop would mean a Tailwind
               translate, and framer-motion writes its own transform on this
               element — the two do not compose, and the loser is the
               centring. */
            className={`fixed inset-x-0 bottom-0 z-[70] mx-auto max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-[28px] border border-line/[0.08] bg-panel/[0.94] pb-[max(2rem,env(safe-area-inset-bottom))] shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-[28px] sm:w-[96%] ${
              payment ? "sm:max-w-3xl" : "sm:max-w-md"
            }`}
          >
            <div className="flex justify-center pt-3 sm:hidden">
              <span className="h-1.5 w-10 rounded-full bg-layer/20" />
            </div>

            <button
              onClick={onClose}
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-line/40 transition-transform duration-200 hover:rotate-90 active:scale-[0.98]"
              aria-label="Close"
            >
              <X className="h-4 w-4 text-ink" />
            </button>

            {payment ? (
              <PayStep
                payment={payment}
                busy={busy}
                error={error}
                copied={copied}
                remainingMs={new Date(payment.expiresAt).getTime() - now}
                onBack={() => {
                  /* The order is left where it is: it expires on its own, and
                     silently cancelling an order somebody may already have paid
                     into is the one thing this screen must never do. */
                  setPayment(null);
                  setError(null);
                }}
                onCopy={copy}
                onConfirm={confirmPayment}
                onDone={onClose}
              />
            ) : (
              <CurrencyStep
                quote={quote}
                quoteError={quoteError}
                currency={currency}
                onSelectCurrency={setCurrency}
                lightning={lightning}
                onToggleLightning={setLightning}
                explainLightning={explainLightning}
                onExplainLightning={setExplainLightning}
                visibleCurrencies={visibleCurrencies}
                hiddenCount={hiddenCount}
                onShowAll={() => setShowAllCurrencies(true)}
                email={email}
                onEmail={setEmail}
                selected={selected}
                busy={busy}
                error={error}
                onPay={startPayment}
              />
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── Step one: which coin ──────────────────────────────────────────────── */

function CurrencyStep({
  quote,
  quoteError,
  currency,
  onSelectCurrency,
  lightning,
  onToggleLightning,
  explainLightning,
  onExplainLightning,
  visibleCurrencies,
  hiddenCount,
  onShowAll,
  email,
  onEmail,
  selected,
  busy,
  error,
  onPay,
}: {
  quote: CryptoQuote | null;
  quoteError: string | null;
  currency: CryptoCurrencyId;
  onSelectCurrency: (id: CryptoCurrencyId) => void;
  lightning: boolean;
  onToggleLightning: (on: boolean) => void;
  explainLightning: boolean;
  onExplainLightning: (open: boolean) => void;
  visibleCurrencies: CurrencyQuote[];
  hiddenCount: number;
  onShowAll: () => void;
  email: string;
  onEmail: (value: string) => void;
  selected: CurrencyQuote | null;
  busy: boolean;
  error: string | null;
  onPay: () => void;
}) {
  return (
    <div className="px-5 pt-6">
      <div className="flex items-baseline justify-between gap-3 border-b border-line/10 pb-4 pr-12">
        <p className="truncate text-sm font-bold text-ink">{quote?.label ?? "Crypto payment"}</p>
        <p className="shrink-0 text-sm font-bold text-muted">
          {quote ? `${formatUsd(quote.amountUsd)} USD` : "—"}
        </p>
      </div>

      <h2 className="mt-6 text-center text-[22px] font-bold leading-tight text-ink">
        Select payment currency
      </h2>

      {quoteError && (
        <p className="mt-5 rounded-2xl border border-danger/30 bg-danger/[0.08] px-4 py-3 text-sm font-medium text-danger">
          {quoteError}
        </p>
      )}

      {!quote && !quoteError && (
        <div className="mt-8 flex items-center justify-center gap-2 py-8 text-sm font-medium text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading live prices…
        </div>
      )}

      {quote && (
        <>
          <div className="mt-5 space-y-2">
            {visibleCurrencies.map((entry) => {
              const spec = CRYPTO_CURRENCIES[entry.currency];
              const isSelected = entry.currency === currency;

              return (
                <div
                  key={entry.currency}
                  className={`overflow-hidden rounded-2xl border transition-colors ${
                    isSelected ? "border-accent/60 bg-accent/[0.06]" : "border-line/15 bg-layer/[0.04]"
                  }`}
                >
                  <button
                    onClick={() => onSelectCurrency(entry.currency)}
                    aria-pressed={isSelected}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left active:scale-[0.995]"
                  >
                    <CoinMark currency={entry.currency} />

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold text-ink">
                        {spec.name}
                      </span>
                      {spec.network && (
                        <span className="block text-xs font-medium text-muted">{spec.network}</span>
                      )}
                    </span>

                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-bold text-ink">
                        {formatCryptoAmount(entry.amount, entry.currency)} {spec.symbol}
                      </span>
                      <span className="block text-[11px] font-medium text-muted">
                        1 {spec.symbol} = {formatUsd(entry.rateUsd)}
                      </span>
                    </span>
                  </button>

                  {entry.lightningAvailable && isSelected && (
                    <div className="flex items-center gap-3 border-t border-line/10 px-4 py-2.5">
                      <button
                        role="switch"
                        aria-checked={lightning}
                        aria-label="Pay over the Lightning Network"
                        onClick={() => onToggleLightning(!lightning)}
                        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                          lightning ? "bg-accent" : "bg-layer/25"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                            lightning ? "left-[18px]" : "left-0.5"
                          }`}
                        />
                      </button>

                      <span className="flex flex-1 items-center gap-1.5 text-[13px] font-medium text-soft">
                        <Zap className="h-3.5 w-3.5 text-warn" />
                        Lightning Network
                      </span>

                      <button
                        onClick={() => onExplainLightning(!explainLightning)}
                        className="shrink-0 text-[13px] font-semibold text-accent"
                      >
                        What&apos;s this?
                      </button>
                    </div>
                  )}

                  {entry.lightningAvailable && isSelected && explainLightning && (
                    <p className="border-t border-line/10 px-4 py-3 text-xs font-medium leading-relaxed text-muted">
                      Lightning settles in seconds for a fraction of a cent, instead of waiting for
                      block confirmations. Your wallet has to support it — if it does not, leave
                      this off and pay on-chain.
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {hiddenCount > 0 && (
            <button
              onClick={onShowAll}
              className="mt-2 flex w-full items-center gap-2 rounded-2xl border border-line/15 bg-layer/[0.04] px-4 py-3 text-left text-[15px] font-semibold text-ink active:scale-[0.995]"
            >
              <ChevronRight className="h-4 w-4 text-muted" />
              More currencies
              <span className="ml-auto text-xs font-medium text-muted">{hiddenCount}</span>
            </button>
          )}

          <label className="mt-5 flex items-center gap-2 rounded-2xl border border-line/15 bg-layer/[0.04] px-4 py-3">
            <Mail className="h-4 w-4 shrink-0 text-muted" />
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => onEmail(event.target.value)}
              placeholder="Your email for payment receipt"
              className="w-full bg-transparent text-sm font-medium text-ink outline-none placeholder:text-muted"
            />
          </label>
          <p className="mt-1.5 px-1 text-[11px] font-medium text-muted">
            Optional. Credits land in your account either way — this is only where the receipt is
            sent.
          </p>

          {error && (
            <p className="mt-4 rounded-2xl border border-danger/30 bg-danger/[0.08] px-4 py-3 text-sm font-medium text-danger">
              {error}
            </p>
          )}

          <button
            onClick={onPay}
            disabled={busy || !selected}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-solid py-3.5 text-base font-bold text-onSolid disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {selected ? `Pay with ${CRYPTO_CURRENCIES[selected.currency].name}` : "Pay"}
          </button>

          <p className="mt-3 text-center text-xs font-medium text-muted">
            Currency cannot be changed after proceeding. The rate is locked for{" "}
            {quote.rateLockMinutes} minutes once you continue.
          </p>
        </>
      )}
    </div>
  );
}

/* ── Step two: pay it ──────────────────────────────────────────────────── */

function PayStep({
  payment,
  busy,
  error,
  copied,
  remainingMs,
  onBack,
  onCopy,
  onConfirm,
  onDone,
}: {
  payment: CryptoPayment;
  busy: boolean;
  error: string | null;
  copied: string | null;
  remainingMs: number;
  onBack: () => void;
  onCopy: (field: string, value: string) => void;
  onConfirm: () => void;
  onDone: () => void;
}) {
  const spec = CRYPTO_CURRENCIES[payment.currency];
  const amount = formatCryptoAmount(payment.cryptoAmount, payment.currency);
  const uri = paymentUri({
    currency: payment.currency,
    address: payment.address,
    amount: payment.cryptoAmount,
    destinationTag: payment.destinationTag,
    lightning: payment.lightning,
  });

  const settled = payment.status === "confirmed";
  const dead = payment.status === "expired" || payment.status === "failed";

  return (
    <div className="grid gap-0 sm:grid-cols-[1.35fr_1fr]">
      {/* The payment itself */}
      <div className="px-5 pb-2 pt-6 sm:pb-6">
        <div className="flex items-center gap-3 pr-12">
          {isOpenStatus(payment.status) && (
            <button
              onClick={onBack}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-line/30 text-ink active:scale-[0.98]"
              aria-label="Back to currency selection"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-[19px] font-bold leading-tight text-ink">
              Crypto payment
            </h2>
            <p className="text-xs font-medium text-muted">
              Order #{orderReference(payment.id)}
            </p>
          </div>
        </div>

        {settled ? (
          <div className="mt-6 rounded-2xl border border-accent/40 bg-accent/[0.08] p-5 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-accent" />
            <p className="mt-3 text-base font-bold text-ink">Payment confirmed</p>
            <p className="mt-1 text-sm font-medium text-muted">
              {payment.credits} credits are in your account.
            </p>
            <button
              onClick={onDone}
              className="mt-5 h-11 w-full rounded-2xl bg-solid text-sm font-bold text-onSolid"
            >
              Done
            </button>
          </div>
        ) : dead ? (
          <div className="mt-6 rounded-2xl border border-danger/30 bg-danger/[0.08] p-5 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-danger" />
            <p className="mt-3 text-base font-bold text-ink">
              {payment.status === "expired" ? "This quote expired" : "This payment did not go through"}
            </p>
            <p className="mt-1 text-sm font-medium text-muted">
              Nothing was charged. Start again to get a fresh rate.
            </p>
            <button
              onClick={onBack}
              className="mt-5 h-11 w-full rounded-2xl bg-solid text-sm font-bold text-onSolid"
            >
              Start again
            </button>
          </div>
        ) : (
          <>
            <div className="mt-5 flex flex-col items-center rounded-2xl border border-line/15 bg-layer/[0.04] p-5">
              <QrCode value={uri} label={`Send ${amount} ${spec.symbol}`} />
              <p className="mt-3 max-w-[38ch] text-center text-xs font-medium leading-relaxed text-muted">
                Scan the code, or copy the amount and address below, and pay from your crypto
                wallet.
              </p>
            </div>

            {/* The amount is a field of its own, and a copyable one. Sending
                "about the right amount" is the commonest way a crypto checkout
                goes wrong, and typing eight decimal places by hand is how it
                happens. */}
            <CopyField
              label={`Amount to send${payment.lightning ? " (Lightning)" : ""}`}
              value={`${amount} ${spec.symbol}`}
              copied={copied === "amount"}
              onCopy={() => onCopy("amount", amount)}
            />

            <CopyField
              label={
                spec.network ? `${spec.name} address (${spec.network})` : `${spec.name} address`
              }
              value={payment.address}
              copied={copied === "address"}
              onCopy={() => onCopy("address", payment.address)}
              mono
            />

            {payment.destinationTag && (
              <>
                <CopyField
                  label="Destination tag"
                  value={payment.destinationTag}
                  copied={copied === "tag"}
                  onCopy={() => onCopy("tag", payment.destinationTag as string)}
                  mono
                />
                <p className="mt-1.5 flex items-start gap-1.5 px-1 text-[11px] font-medium text-warn">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  Send the tag with the payment. A {spec.symbol} payment without it cannot be
                  matched to this order.
                </p>
              </>
            )}

            {spec.network && (
              <p className="mt-2 px-1 text-[11px] font-medium text-muted">
                Send over {spec.network} only. Funds sent on another network cannot be recovered.
              </p>
            )}

            {error && (
              <p className="mt-4 rounded-2xl border border-danger/30 bg-danger/[0.08] px-4 py-3 text-sm font-medium text-danger">
                {error}
              </p>
            )}

            {payment.status === "submitted" ? (
              <div className="mt-5 flex items-center gap-3 rounded-2xl border border-line/15 bg-layer/[0.04] px-4 py-3.5">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                <p className="text-[13px] font-medium leading-relaxed text-soft">
                  Waiting for the network to confirm. You can close this — the credits land as soon
                  as the payment confirms.
                </p>
              </div>
            ) : (
              <button
                onClick={onConfirm}
                disabled={busy}
                className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-solid text-sm font-bold text-onSolid disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                I&apos;ve sent the payment
              </button>
            )}

            <p className="mt-3 text-center text-xs font-medium text-muted">
              Rate held for {mmss(remainingMs)}
            </p>
          </>
        )}
      </div>

      {/* The order summary */}
      <aside className="border-t border-line/10 px-5 py-6 sm:border-l sm:border-t-0">
        <h3 className="text-center text-[15px] font-bold text-ink">Order summary</h3>
        <div className="mx-auto mt-3 h-px w-16 bg-line/20" />

        <p className="mt-5 text-sm font-bold text-ink">{payment.purchase.kind === "plan" ? "Plan" : "Credits"}</p>
        <p className="mt-1 flex items-end gap-1.5">
          <span className="text-[32px] font-extrabold leading-none text-ink">
            {formatUsd(payment.amountUsd)}
          </span>
          <span className="mb-1 text-xs font-medium text-muted">
            {purchaseCadence(payment.purchase)}
          </span>
        </p>

        <p className="mt-4 text-xs font-medium text-muted">
          Date
          <span className="mt-0.5 block text-sm font-semibold text-soft">
            {new Date(payment.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
        </p>

        <dl className="mt-5 space-y-2 border-t border-line/10 pt-4 text-sm">
          <Row label="Subtotal" value={formatUsd(payment.amountUsd)} />
          {/* Zero, and shown rather than hidden: a summary that omits tax reads
              as a summary that has not decided yet. */}
          <Row label="Tax" value={formatUsd(0)} />
          <Row label="Credits" value={`${payment.credits}`} />
          <Row label="Total" value={formatUsd(payment.amountUsd)} strong />
        </dl>

        <div className="mt-5 flex items-center gap-2 border-t border-line/10 pt-4">
          <CoinMark currency={payment.currency} className="h-6 w-6 text-[11px]" />
          <span className="text-sm font-bold text-ink">
            {formatCryptoAmount(payment.cryptoAmount, payment.currency)} {spec.symbol}
          </span>
        </div>
        <p className="mt-1 text-[11px] font-medium text-muted">
          at {formatUsd(payment.rateUsd)} per {spec.symbol}
        </p>

        {payment.receiptEmail && (
          <p className="mt-4 truncate text-[11px] font-medium text-muted">
            Receipt to {payment.receiptEmail}
          </p>
        )}
      </aside>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? "font-bold text-ink" : "font-medium text-muted"}>{label}</dt>
      <dd className={strong ? "font-bold text-ink" : "font-semibold text-soft"}>{value}</dd>
    </div>
  );
}

function CopyField({
  label,
  value,
  copied,
  onCopy,
  mono,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  mono?: boolean;
}) {
  return (
    <div className="mt-4">
      <p className="mb-1.5 px-1 text-xs font-semibold text-muted">{label}</p>
      <div className="flex items-center gap-2 rounded-2xl border border-line/15 bg-layer/[0.04] px-4 py-3">
        <span
          className={`min-w-0 flex-1 truncate text-sm text-ink ${mono ? "font-mono" : "font-bold"}`}
          title={value}
        >
          {value}
        </span>
        <button
          onClick={onCopy}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line/20 text-muted active:scale-[0.98]"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-accent" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <span aria-live="polite" className="sr-only">
        {copied ? `${label} copied` : ""}
      </span>
    </div>
  );
}
