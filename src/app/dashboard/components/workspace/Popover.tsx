"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { useMediaQuery } from "@/hooks/use-media-query";

/* A panel hung off a control.

   From md up that is what it is: a small card anchored to the button, which is
   how a pointer expects to be answered. On a phone it is not — a 300px card
   pinned to the right edge of a 414px screen is a desktop popover wearing a
   smaller size, and the thing it is anchored to sits under a thumb.

   So a phone gets the sheet this app already uses everywhere else: the blurred
   black field, the #121215 card with a titled header and a round close button,
   the same one the agent, privacy and advanced panels open. Same content, the
   shape each screen already knows. */
export default function Popover({
  open,
  onClose,
  title,
  align = "right",
  side = "bottom",
  width = "w-[300px]",
  sheetOnMobile = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Shown on the phone sheet's header. The anchored card carries its own. */
  title: string;
  /** Which edge of the control the anchored card lines up with. */
  align?: "left" | "right";
  /** Which side of the control it opens on — "top" for a bar at the foot of the screen. */
  side?: "top" | "bottom";
  width?: string;
  /* A panel hung off the composer stays hung off it on a phone: the bar is at
     the foot of the screen, so the answer opens right above the thumb that
     asked. Only panels anchored to the top of the screen become sheets. */
  sheetOnMobile?: boolean;
  children: React.ReactNode;
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Escape closes it, the way the rest of the app's panels behave.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  if (isDesktop || !sheetOnMobile) {
    return (
      <div
        className={`absolute z-50 ${align === "right" ? "right-0" : "left-0"} ${
          side === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"
        } ${width} max-w-[calc(100vw-24px)] rounded-xl border border-line/[0.09] bg-panel p-3.5 shadow-[0_20px_60px_rgba(0,0,0,0.7)]`}
      >
        {children}
      </div>
    );
  }

  /* Portalled to the body: the anchor sits inside a panel that clips and
     scrolls, and a sheet has to cover the screen rather than that panel. Only
     reachable after a press, so the document is there to portal into. */
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xl"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-[24px] border border-line/[0.08] bg-panel p-5 shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
      >
        <div className="flex items-center justify-between pb-1">
          <h3 className="text-base font-semibold tracking-tight text-ink">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line/[0.06] bg-layer/[0.04] text-ink/70 transition-all hover:bg-layer/[0.08] hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
