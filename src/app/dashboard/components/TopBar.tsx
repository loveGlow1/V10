"use client";

import React from "react";
import { Menu } from "lucide-react";

interface TopBarProps {
  onMenuClick: () => void;
  onUpgradeClick: () => void;
}

/* The phone bar. It carries only the two things a handset has room for — the way
   into the drawer and the way onto a plan — and leaves the brand, the project
   switcher and the account menu to the drawer and the desktop header.

   Every control here is lit the same way: a hairline rim, a single pixel of
   light along the top edge and none along the bottom, so the piece reads as a
   raised surface catching the light from above rather than a flat chip. */
export default function TopBar({ onMenuClick, onUpgradeClick }: TopBarProps) {
  return (
    <header className="relative z-30 flex min-h-[68px] w-full items-center justify-between px-4 pt-[env(safe-area-inset-top)] md:hidden">
      <button
        onClick={onMenuClick}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.06] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-colors hover:bg-white/[0.10] active:scale-[0.98]"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5 stroke-[2]" />
      </button>

      <button
        onClick={onUpgradeClick}
        className="h-11 rounded-full bg-gradient-to-b from-[#F9E58A] to-[#F4D96B] px-5 text-sm font-semibold text-[#3a2e00] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_6px_18px_rgba(244,217,107,0.12)] transition-all hover:brightness-105 active:scale-[0.98]"
      >
        Upgrade Plan
      </button>
    </header>
  );
}
