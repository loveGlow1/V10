"use client";

import React from "react";
import { MoreHorizontal, PanelLeftClose } from "lucide-react";

import CreditPill from "./CreditPill";
import { MenuMark } from "./marks";

interface TopBarProps {
  onMenuClick: () => void;
  onUpgradeClick: () => void;
  /* The account's balance, already formatted. Optional: the drawer this bar
     opens carries it too, so a screen that has no room simply omits it rather
     than showing a figure it cannot fit. */
  credits?: string;
  /* An open app names itself in the bar, and the bar becomes the way back out
     of it. Home passes neither and keeps the layout it has. */
  projectName?: string;
  onBack?: () => void;
}

/* The phone bar: the way into the drawer, and the way onto a plan. The brand,
   the project switcher and the account menu live in the drawer and in the
   desktop header, which is what leaves room at 360px.

   Everything here is glass over the blue: a translucent fill, a hairline rim and
   one pixel of light along the top edge, so each control reads as a raised
   surface catching the light rather than a flat chip. */
export default function TopBar({
  onMenuClick,
  onUpgradeClick,
  credits,
  projectName,
  onBack,
}: TopBarProps) {
  /* Everything in this row is 34px tall — the two icon buttons and the pill
     between them. It was 30, which left the pill sitting two pixels inside the
     buttons on both edges, so the bar had no single line along its top or its
     bottom for the eye to follow. */
  const upgrade = (
    <button
      onClick={onUpgradeClick}
      className="flex h-[34px] shrink-0 items-center rounded-full bg-gradient-to-b from-[#FFE998] to-[#FFE07A] px-3.5 text-[12px] font-semibold leading-none text-[#3a2e00] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_6px_18px_rgba(255,224,122,0.14)] transition-all hover:brightness-105 active:scale-[0.98]"
    >
      Upgrade
    </button>
  );

  const round =
    "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-line/[0.14] bg-layer/[0.08] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition-colors hover:bg-layer/[0.12] active:scale-[0.98]";

  /* The balance, beside the button that tops it up — the same pairing the
     desktop header makes. On the app screen it stands down below 430px: the
     row there also carries the app's name, and at 390 the pill cuts that name
     to seven characters, which costs more than the figure gains. The drawer
     this bar opens carries the balance on every width. */
  const balance = credits ? <CreditPill credits={credits} onClick={onUpgradeClick} /> : null;

  /* The way out of an app, and the drawer's own collapse button brought up here:
     the same squircle and the same mark, so leaving a panel is one gesture with
     one shape wherever you meet it. Square rather than round is what tells it
     apart from the menu at the other end of the row. */
  const exit =
    "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl border border-line/[0.14] bg-layer/[0.08] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition-colors hover:bg-layer/[0.12] active:scale-[0.98]";

  /* Inside an app the bar is about the app: the way back out of it, what it is
     called, and the two things you might want while in it. */
  if (projectName !== undefined) {
    return (
      <header className="relative z-30 flex w-full items-center gap-2.5 px-4 pb-2 pt-[max(10px,env(safe-area-inset-top))] md:hidden">
        <button onClick={onBack} aria-label="Back to your apps" className={exit}>
          <PanelLeftClose className="h-4 w-4" />
        </button>

        {/* min-w-0 is what lets it truncate rather than push: the name gives way
            at any width, so it never reaches the pill beside it. */}
        <p className="min-w-0 flex-1 truncate text-[15px] font-medium leading-none text-ink">
          {projectName}
        </p>

        {balance && <span className="hidden min-[430px]:flex">{balance}</span>}

        {upgrade}

        <button onClick={onMenuClick} aria-label="Open menu" className={round}>
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </header>
    );
  }

  return (
    <header className="relative z-30 flex w-full items-center gap-2.5 px-4 pb-2 pt-[max(10px,env(safe-area-inset-top))] md:hidden">
      <button onClick={onMenuClick} aria-label="Open menu" className={round}>
        <MenuMark className="h-4 w-4" />
      </button>

      {/* Nothing between them but the balance, so Upgrade keeps the right edge. */}
      <div className="min-w-0 flex-1" />

      {balance}

      {upgrade}
    </header>
  );
}
