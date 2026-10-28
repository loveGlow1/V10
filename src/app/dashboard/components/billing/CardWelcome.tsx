"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CreditCard, Loader2, LogOut, ShieldCheck, X } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase";

import { useCredits } from "../../useCredits";

/* The welcome credit, behind a card on file — see src/lib/stripe-card.ts.
 *
 *   CardWelcomeBanner  the soft ask, above the composer on Home and in the
 *                      workspace: for an established customer (funded $25+,
 *                      with us over two months) who has no card — they keep
 *                      working; and for a saved card that had already claimed
 *                      free credits on another account.
 *   CardGate           no card, no service: an account that has never paid
 *                      and has no valid card (new, or from before the rule
 *                      and holding the free credit it got at signup) sees
 *                      only this until it adds one. The server refuses its
 *                      work too — see lib/card-gate.ts. In the layout.
 *   CardReturn         back from Stripe: confirms the card, says what came of
 *                      it, refreshes the balance. Mounted once, in the layout.
 *
 * The card is saved on Stripe's own page in setup mode: the bank verifies it
 * with a zero-amount check and nothing is charged. */

type Status = {
  configured: boolean;
  card: { brand: string | null; last4: string | null } | null;
  welcomed: boolean;
  welcomeCredits: number;
  /* ok, suggest (asked, keeps working) or required (the gate) — see
     card_status in supabase/schema.sql. */
  status: "ok" | "suggest" | "required";
  required: boolean;
};

/* "Not now" on the soft ask lasts for this visit: it is back next time, the
   way emergent.sh keeps asking. */
const NOT_NOW = "qs-card-not-now";
function saidNotNow(): boolean {
  try {
    return window.sessionStorage.getItem(NOT_NOW) === "1";
  } catch {
    return false;
  }
}

/* "Continue without card" on the gate, likewise for this visit. It only lets
   them look around: the server still refuses credit-spending work without a
   card (lib/card-gate.ts), so nothing is given away. */
const SKIPPED_GATE = "qs-card-gate-skipped";
function skippedGate(): boolean {
  try {
    return window.sessionStorage.getItem(SKIPPED_GATE) === "1";
  } catch {
    return false;
  }
}

const CHANGED = "qs:card-changed";

/* Back from Stripe with a card, its confirmation still on its way: the gate
   holds off rather than flashing "Add card" over "Card verified". */
let confirming = false;

/* One read for every screen that asks — the gate and the banners on the
   same page share it — and a fresh one when a card is added. */
let shared: { at: number; read: Promise<Status | null> } | null = null;
/* A minute old is old enough to ask again: an account whose gifted credit
   runs out mid-visit should meet the gate without reloading. */
const FRESH_FOR_MS = 60_000;
function readStatus(fresh: boolean): Promise<Status | null> {
  if (!shared || fresh || Date.now() - shared.at > FRESH_FOR_MS) {
    shared = {
      at: Date.now(),
      read: fetch("/api/payments/stripe/card", { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<Status>) : null))
        .catch(() => null),
    };
  }
  return shared.read;
}

function useCardStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const load = useCallback((fresh: boolean) => {
    /* A copy, so the screen redraws even when the read is the shared one it
       already had (the gate's hold may have changed meanwhile). */
    void readStatus(fresh).then((read) => setStatus(read ? { ...read } : null));
  }, []);
  useEffect(() => {
    load(false);
    /* Whoever announces a change has already read afresh. Coming back to the
       tab reads again once the last read is a minute old. */
    const changed = () => load(false);
    window.addEventListener(CHANGED, changed);
    window.addEventListener("focus", changed);
    return () => {
      window.removeEventListener(CHANGED, changed);
      window.removeEventListener("focus", changed);
    };
  }, [load]);
  return status;
}

/** Off to Stripe's page to save a card, coming back to where this was. */
export async function startCardSetup(): Promise<string | null> {
  const returnTo = `${window.location.pathname}${window.location.search}`.replace(/[?&]card(_session)?=[^&]*/g, "") || "/dashboard";
  const response = await fetch("/api/payments/stripe/card", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnTo }),
  }).catch(() => null);
  const body = (await response?.json().catch(() => ({}))) as { url?: string; error?: string } | undefined;
  if (body?.url) {
    window.location.assign(body.url);
    return null;
  }
  return body?.error ?? "Stripe couldn't be reached. Try again.";
}

export function CardWelcomeBanner({ className = "" }: { className?: string }) {
  const { planId } = useCredits();
  const status = useCardStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(saidNotNow()), []);

  if (hidden || !status || !status.configured) return null;
  /* A card saved but no welcome: that card already unlocked one elsewhere. */
  const used = status.status === "ok" && Boolean(status.card) && !status.welcomed && planId === "free";
  /* The soft ask. An account that must add a card sees the gate instead. */
  const asked = status.status === "suggest";
  if (!used && !asked) return null;

  const go = async () => {
    setBusy(true);
    setError(null);
    const failed = await startCardSetup();
    if (failed) {
      setError(failed);
      setBusy(false);
    }
  };

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border border-line/[0.1] bg-layer/[0.04] px-3.5 py-2.5 text-left ${className}`}
      role="region"
      aria-label="Free credits"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#22c55e]/15 text-[#16a34a] dark:text-[#4ade80]">
        <ShieldCheck className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-snug text-ink">
          {used
            ? "That card already claimed free credits on another account"
            : !status.welcomed
              ? `Add a card to get your ${status.welcomeCredits} free credits`
              : "Add a card to your account"}
        </p>
        <p className="text-[12px] leading-snug text-muted">
          {error ??
            (used
              ? "Add a different card, or top up to keep building."
              : "You can keep building. No charge — your bank just checks the card is real.")}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void go()}
        disabled={busy}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 text-[12.5px] font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
        {used ? "Use another card" : "Add card"}
      </button>
      <button
        type="button"
        onClick={() => {
          setHidden(true);
          try {
            window.sessionStorage.setItem(NOT_NOW, "1");
          } catch {
            /* Private mode: hidden for this page only. */
          }
        }}
        aria-label="Not now"
        className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const SAID: Record<string, (credits: number) => string> = {
  granted: (credits) => `Card verified — ${credits} free credits added. You weren't charged.`,
  already: () => "Card saved. You weren't charged.",
  card_used: () => "Card saved, but it already claimed free credits on another account. You weren't charged.",
  invalid: () => "Card saved. You weren't charged.",
};

export function CardReturn() {
  const { refresh } = useCredits();
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = params.get("card");
    if (!state) return;
    const sessionId = params.get("card_session");
    /* Off the address either way, so a reload does not say it twice. */
    params.delete("card");
    params.delete("card_session");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    if (state !== "saved" || !sessionId) return;
    confirming = true;

    void fetch("/api/payments/stripe/card/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { welcome?: string; error?: string };
        if (!response.ok) {
          setNote({ text: body.error ?? "The card could not be saved. Try again.", ok: false });
          return;
        }
        const fresh = await readStatus(true);
        setNote({
          text: (SAID[body.welcome ?? "already"] ?? SAID.already)(fresh?.welcomeCredits ?? 5),
          ok: body.welcome !== "card_used",
        });
        await refresh();
      })
      .catch(() => setNote({ text: "Couldn't confirm the card. Reload the page to try again.", ok: false }))
      .finally(() => {
        confirming = false;
        window.dispatchEvent(new Event(CHANGED));
      });
  }, [refresh]);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 7000);
    return () => clearTimeout(timer);
  }, [note]);

  if (!note) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-[96] mx-auto flex max-w-md items-center gap-2.5 rounded-2xl border border-line/[0.12] bg-canvas px-4 py-3 text-[13px] text-ink shadow-[0_16px_40px_rgba(0,0,0,0.35)]"
    >
      <ShieldCheck className={`h-4 w-4 shrink-0 ${note.ok ? "text-[#16a34a] dark:text-[#4ade80]" : "text-warn"}`} />
      <p className="min-w-0 flex-1">{note.text}</p>
      <button type="button" onClick={() => setNote(null)} aria-label="Dismiss" className="text-muted hover:text-ink">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* No card, no service. Over everything until they add a card, sign out, or
   choose to continue without one for this visit — looking around, not
   building. What it says depends on who is looking: a new account is promised
   its welcome, an older one the free credit it already holds, and one whose
   card has run out is asked for a valid one. */
export function CardGate() {
  const status = useCardStatus();
  const { balance } = useCredits();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  useEffect(() => setSkipped(skippedGate()), []);

  if (skipped || confirming || !status?.required || !status.configured) return null;
  const holding = balance ? balance.daily + balance.rollover + balance.monthly + balance.topUp : 0;
  const title = status.card
    ? "Your card has expired"
    : !status.welcomed
      ? `Add a card to get your ${status.welcomeCredits} free credits`
      : holding > 0
        ? "Add a card to use your free credits"
        : "Add a card to keep building";

  const go = async () => {
    setBusy(true);
    setError(null);
    const failed = await startCardSetup();
    if (failed) {
      setError(failed);
      setBusy(false);
    }
  };
  const signOut = async () => {
    await createSupabaseBrowserClient().auth.signOut().catch(() => undefined);
    window.location.assign("/");
  };
  const continueWithout = () => {
    setSkipped(true);
    try {
      window.sessionStorage.setItem(SKIPPED_GATE, "1");
    } catch {
      /* Private mode: skipped for this page only. */
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/60 backdrop-blur-[3px] sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-gate-title"
        className="w-full max-w-[440px] rounded-t-[24px] border border-line/[0.1] bg-canvas px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-6 shadow-[0_24px_60px_rgba(0,0,0,0.5)] sm:rounded-2xl sm:pb-6"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#22c55e]/15 text-[#16a34a] dark:text-[#4ade80]">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <h2 id="card-gate-title" className="mt-4 text-[19px] font-semibold leading-snug text-ink">
          {title}
        </h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          {status.card
            ? "Add a valid card to keep using QuickStark."
            : "QuickStark needs a card on file before you can build."}{" "}
          You won&apos;t be charged — your bank just confirms the card is real. It keeps free credit for real people.
        </p>
        {error ? <p className="mt-3 text-[12.5px] text-warn">{error}</p> : null}
        <button
          type="button"
          onClick={() => void go()}
          disabled={busy}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink text-[14px] font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          {status.card ? "Add a valid card" : "Add card"}
        </button>
        <button
          type="button"
          onClick={continueWithout}
          className="mt-2.5 flex h-11 w-full items-center justify-center rounded-xl border border-line/[0.12] text-[14px] font-medium text-ink transition-colors hover:bg-layer/[0.06]"
        >
          Continue without card
        </button>
        <p className="mt-3 text-center text-[11.5px] text-muted">
          Secured by Stripe. Without a card you can look around, but building stays locked.
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mx-auto mt-3 flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-ink"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </div>
  );
}
