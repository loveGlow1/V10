"use client";

import React from "react";

/* The coin. Drawn rather than borrowed from an icon set so it carries the same
   gold as the Upgrade pill beside it: a struck disc with a lit top edge and a
   spark cut into its face. On a 24 grid, like the rest of the marks. */
function CoinMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="creditCoin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE998" />
          <stop offset="100%" stopColor="#F0B93B" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="9" fill="url(#creditCoin)" />
      {/* The spark, in the dark the gold buttons use for their text, so the
          glyph reads at 14px instead of dissolving into the disc. */}
      <path
        d="M12 6.75l1.6 3.65 3.65 1.6-3.65 1.6L12 17.25l-1.6-3.65L6.75 12l3.65-1.6z"
        fill="#3a2e00"
        opacity="0.85"
      />
    </svg>
  );
}

/* The balance, at the top of the screen and next to the button that changes it.

   It was only ever inside the account menu and the drawer, which meant the one
   number that decides whether the next build runs was two taps away from every
   screen it governs. Here it sits beside Upgrade, where a low balance and the
   remedy are the same glance. */
export default function CreditPill({
  credits,
  onClick,
  className = "",
}: {
  /** Already formatted — see formatCredits. */
  credits: string;
  /** Opens the billing panel: the pill is the way onto a plan, not a label. */
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={`Credit balance ${credits}. Manage your plan`}
      title={`${credits} credits`}
      className={`flex h-[34px] shrink-0 items-center gap-1.5 rounded-full border border-line/[0.09] bg-layer/[0.05] pl-1.5 pr-3 text-[13px] font-semibold leading-none text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors hover:bg-layer/[0.09] active:scale-[0.98] ${className}`}
    >
      <CoinMark className="h-[22px] w-[22px] shrink-0" />
      {/* Tabular figures: the balance changes after every build, and digits of
          differing widths make the pill twitch each time it does. */}
      <span className="tabular-nums">{credits}</span>
    </button>
  );
}
