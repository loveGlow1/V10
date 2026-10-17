"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";

/* A list to pick one thing from, as a sheet that rises from the foot of the
   screen: a handle, a close on the left and the title centred, the choices in
   one rounded card with hairlines between them, a tick on the one in force,
   and any further rows (another page of choices, a setting) as separate cards
   underneath. The model picker in the workspace and the agent picker on Home
   both use it, so the two read as the same control. */

export type ChoiceRow = {
  id: string;
  title: string;
  subtitle?: string;
  /** A short tag beside the title: why it cannot be picked, or what it needs. */
  badge?: string;
  selected?: boolean;
  disabled?: boolean;
  /** Hover text — the full reason when the badge is short. */
  hint?: string;
  onSelect?: () => void;
};

export type ChoiceLink = {
  id: string;
  label: string;
  /** Shown on the right, before the chevron. */
  value?: string;
  onClick: () => void;
};

export default function ChoiceSheet({
  open,
  onClose,
  title,
  rows,
  links = [],
  note,
  onBack,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  rows: ChoiceRow[];
  links?: ChoiceLink[];
  /** A quiet line under the cards. */
  note?: React.ReactNode;
  /** When set, the left control goes back a page instead of closing. */
  onBack?: () => void;
}) {
  /* Portalled into the body, which only exists after hydration. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="choice-sheet"
          className="fixed inset-0 z-[85] flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 340 }}
            className="relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-[28px] border border-b-0 border-line/[0.10] bg-panel pb-[max(20px,env(safe-area-inset-bottom))] shadow-[0_-20px_60px_rgba(0,0,0,0.6)]"
          >
            <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-layer/[0.18]" />
            <div className="relative flex shrink-0 items-center justify-center px-5 pb-4 pt-3">
              <button
                onClick={onBack ?? onClose}
                aria-label={onBack ? "Back" : "Close"}
                className="absolute left-3 flex h-10 w-10 items-center justify-center rounded-full text-ink/80 transition-colors hover:bg-layer/[0.08] hover:text-ink"
              >
                {onBack ? <ChevronLeft className="h-6 w-6" strokeWidth={1.75} /> : <X className="h-6 w-6" strokeWidth={1.75} />}
              </button>
              <h3 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h3>
            </div>

            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pt-1">
              <div className="overflow-hidden rounded-[18px] bg-layer/[0.06]" role="menu">
                {rows.map((row, index) => (
                  <button
                    key={row.id}
                    role="menuitemradio"
                    aria-checked={Boolean(row.selected)}
                    disabled={row.disabled}
                    title={row.hint}
                    onClick={row.onSelect}
                    className={`relative flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors ${
                      row.disabled ? "cursor-not-allowed" : "hover:bg-layer/[0.04] active:bg-layer/[0.07]"
                    }`}
                  >
                    {index > 0 && <span aria-hidden className="absolute left-5 right-0 top-0 h-px bg-line/[0.08]" />}
                    <span className={`min-w-0 flex-1 ${row.disabled ? "opacity-55" : ""}`}>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[17px] leading-snug text-ink">{row.title}</span>
                        {row.badge && (
                          <span className="rounded-full bg-black/45 px-2.5 py-1 text-[12px] font-medium leading-none text-ink/90">
                            {row.badge}
                          </span>
                        )}
                      </span>
                      {row.subtitle && (
                        <span className="mt-1 block text-[14.5px] leading-snug text-muted">{row.subtitle}</span>
                      )}
                    </span>
                    {row.selected && <Check className="h-6 w-6 shrink-0 text-accent" strokeWidth={2} />}
                  </button>
                ))}
              </div>

              {links.map((link) => (
                <button
                  key={link.id}
                  onClick={link.onClick}
                  className="flex w-full items-center gap-3 rounded-[18px] bg-layer/[0.06] px-5 py-4 text-left transition-colors hover:bg-layer/[0.09]"
                >
                  <span className="flex-1 text-[17px] text-ink">{link.label}</span>
                  {link.value && <span className="text-[16px] text-muted">{link.value}</span>}
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
                </button>
              ))}

              {note && <p className="px-2 pb-1 text-center text-[12.5px] text-muted">{note}</p>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
