"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, Smartphone, X } from "lucide-react";

import { MOBILE_APPS } from "../comingSoon";

/* The pill that marks a feature as not here yet.

   Deliberately not the blue "Beta" pill beside it: beta means you can use it
   and it may break, and this is the opposite claim. A soft mint on a dark
   ground, the app's own accent, reads as a promise rather than a warning. */
export function ComingSoonBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full border border-accent/25 bg-accent/10 px-2 py-[2px] text-[9px] font-semibold uppercase tracking-wide text-accent ${className}`}
    >
      {MOBILE_APPS.label}
    </span>
  );
}

/* What pressing it says. The app's own sheet — the blurred black field, the
   #121215 card, the round close button — so it belongs to this product rather
   than arriving from somewhere else.

   No "notify me": there is nothing behind a form to put an address into, and a
   button that quietly drops what you typed is worse than no button. */
export function ComingSoonModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label={MOBILE_APPS.title}
            className="w-full max-w-md overflow-hidden rounded-[24px] border border-line/[0.08] bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
          >
            {/* A lit header rather than a plain one: the accent bloomed behind a
                phone, so the panel opens on the thing it is promising. */}
            <div className="relative overflow-hidden px-5 pb-5 pt-6">
              <div
                aria-hidden
                className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-accent/20 blur-3xl"
              />
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-line/[0.06] bg-layer/[0.04] text-ink/70 transition-all hover:bg-layer/[0.08] hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="relative flex flex-col items-center text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent shadow-[0_0_30px_rgba(52,245,160,0.15)]">
                  <Smartphone className="h-6 w-6" />
                </span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-ink">
                  {MOBILE_APPS.title}
                </h3>
                <p className="mt-2 max-w-[320px] text-[13px] leading-relaxed text-soft">
                  {MOBILE_APPS.blurb}
                </p>

                <span className="mt-4 flex items-center gap-1.5 rounded-full border border-line/[0.09] bg-layer/[0.03] px-3 py-1.5 text-[12px] text-muted">
                  <CalendarClock className="h-3.5 w-3.5 text-accent" />
                  Expected in {MOBILE_APPS.window}
                </span>
              </div>
            </div>

            <div className="border-t border-line/[0.06] px-5 py-4">
              <p className="text-[12px] leading-relaxed text-muted">{MOBILE_APPS.detail}</p>
              <button
                onClick={onClose}
                className="mt-4 h-10 w-full rounded-xl bg-solid text-[13px] font-medium text-onSolid transition-colors hover:bg-layer/90"
              >
                Got it
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
