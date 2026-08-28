import React from "react";

/* The agent's mark. lucide's Bot is a boxy 24px robot with squared ears and a
   two-pixel stroke — at the 16px the chip gives it, the ears collapse into the
   head and it reads as clip art. This is drawn for that size instead: one
   squircle head, two eyes set wide enough to survive the downscale, and a
   single antenna whose tip carries the brand green, so the chip picks up the
   same accent as the wordmark and the New Task control rather than sitting
   apart from them.

   Strokes are 1.8 on a 24 grid — 1.2px at 16 — which holds against the white
   labels beside it without going bold. `currentColor` everywhere but the tip,
   so the mark follows whatever colour its button is in. */
export default function AgentMark({
  className,
  accent = "#34F5A0",
}: {
  className?: string;
  /** The antenna tip. Pass `currentColor` where a monochrome mark is wanted. */
  accent?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Head. 15.6 x 12.6 on a 24 grid: narrower than a square-ish robot head,
          which keeps it from reading as a television at small sizes. */}
      <rect x="4.2" y="8.2" width="15.6" height="12.6" rx="5" />
      {/* Eyes: filled, so they stay solid dots rather than rings when scaled down */}
      <circle cx="9.2" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
      {/* Antenna. The glyph spans 2.85-20.8, centred on the grid rather than
          sitting high in it, so it lines up with the label beside it. */}
      <path d="M12 8.2V5.6" />
      <circle cx="12" cy="4.2" r="1.35" fill={accent} stroke={accent} />
    </svg>
  );
}
