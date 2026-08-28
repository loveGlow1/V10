"use client";

import React, { useState } from "react";
import { Menu, AppWindow, MessageSquare } from "lucide-react";

interface TopBarProps {
  onMenuClick: () => void;
  onUpgradeClick: () => void;
}

/* The phone bar: the way into the drawer, the preview/chat pair, and the way
   onto a plan. The brand, the project switcher and the account menu live in the
   drawer and in the desktop header, which is what leaves room for these three
   at 360px.

   Everything here is glass over the blue: a translucent fill, a hairline rim and
   one pixel of light along the top edge, so each control reads as a raised
   surface catching the light rather than a flat chip. */
export default function TopBar({ onMenuClick, onUpgradeClick }: TopBarProps) {
  /* The pair the reference carries beside the hamburger. It holds its position,
     but there is no second view on this screen for it to switch to yet — the
     project workspace is where it will point once that view exists. */
  const [view, setView] = useState<"preview" | "chat">("preview");

  const segment = (active: boolean) =>
    `flex h-7 w-[42px] items-center justify-center rounded-full transition-all ${
      active
        ? "bg-[#19E7E8] text-[#06232b] shadow-[0_0_18px_rgba(25,231,232,0.35)]"
        : "text-white/60"
    }`;

  return (
    <header className="relative z-30 flex w-full items-center justify-between px-4 pb-2 pt-[max(10px,env(safe-area-inset-top))] md:hidden">
      <div className="flex items-center gap-2.5">
        <button
          onClick={onMenuClick}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-xl transition-colors hover:bg-white/[0.12] active:scale-[0.98]"
          aria-label="Open menu"
        >
          <Menu className="h-4 w-4 stroke-[2]" />
        </button>

        <div
          role="group"
          aria-label="View"
          className="flex h-[34px] items-center gap-1 rounded-full border border-white/[0.12] bg-white/[0.06] p-[3px] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl"
        >
          <button
            onClick={() => setView("preview")}
            aria-pressed={view === "preview"}
            aria-label="Preview"
            className={segment(view === "preview")}
          >
            <AppWindow className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView("chat")}
            aria-pressed={view === "chat"}
            aria-label="Chat"
            className={segment(view === "chat")}
          >
            <MessageSquare className="h-4 w-4" />
          </button>
        </div>
      </div>

      <button
        onClick={onUpgradeClick}
        className="h-[30px] shrink-0 rounded-full bg-gradient-to-b from-[#FFE998] to-[#FFE07A] px-3 text-[12px] font-semibold text-[#3a2e00] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_6px_18px_rgba(255,224,122,0.14)] transition-all hover:brightness-105 active:scale-[0.98]"
      >
        Upgrade Plan
      </button>
    </header>
  );
}
