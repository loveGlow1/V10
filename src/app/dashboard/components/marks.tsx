import React from "react";

/* The four marks the phone toolbar and header draw, traced off the reference
   screenshot rather than picked from an icon set.

   Every coordinate below is a multiple of 0.75 and every stroke is 2.25. That
   is not arbitrary: these render at 16px from a 24 grid, so 1.5 units is
   exactly one CSS pixel and 0.75 is half of one. Snapping to that grid puts
   every edge on a whole device pixel at 2x and 3x, which is the difference
   between a mark that looks drawn and one that looks smeared — a rectangle of
   1.4 CSS pixels has no crisp edge at any density, it just greys the two rows
   it straddles. Strokes are 1.5px, the reference's own weight. */

type MarkProps = { className?: string };

/* Robot. Head 10 x 9 CSS pixels with ears outside it, two square eyes, a mouth
   bar, an antenna above and a filled wedge for a chin. */
export function AgentMark({
  className,
  accent = "currentColor",
}: MarkProps & { accent?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 1.5V6" stroke={accent} />
      <rect x="4.5" y="6" width="15" height="13.5" rx="4.5" />
      {/* Ears */}
      <rect x="0.75" y="10.5" width="2.25" height="5.25" rx="1.125" fill="currentColor" stroke="none" />
      <rect x="21" y="10.5" width="2.25" height="5.25" rx="1.125" fill="currentColor" stroke="none" />
      {/* Eyes */}
      <rect x="8.25" y="11.25" width="2.25" height="2.25" rx="0.75" fill="currentColor" stroke="none" />
      <rect x="13.5" y="11.25" width="2.25" height="2.25" rx="0.75" fill="currentColor" stroke="none" />
      {/* Mouth */}
      <rect x="9.75" y="15.75" width="4.5" height="1.5" rx="0.75" fill="currentColor" stroke="none" />
      {/* Chin: filled, so it merges into the head's edge the way the reference's does */}
      <path d="M8.25 19.5h7.5L12 23.25Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* Three bars: 12 CSS pixels long on 4-pixel centres — shorter and heavier than
   lucide's Menu, which is what makes the reference's read as a solid stack. */
export function MenuMark({ className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

/* Mic. The capsule is filled, not outlined — the single biggest difference
   between the reference's and lucide's, and the reason theirs reads solid at
   16px where the outline reads hollow. */
export function MicMark({ className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="8.25" y="1.5" width="7.5" height="13.5" rx="3.75" fill="currentColor" stroke="none" />
      <path d="M18.75 12v2.25a6.75 6.75 0 0 1-13.5 0V12" />
      <path d="M12 20.25v3" />
    </svg>
  );
}

/* Arrow. Wide shoulders and a long shaft: the head spans the full width and
   comes only a third of the way down, where lucide's is a tighter chevron. */
export function SendArrow({ className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 21.75V2.25" />
      <path d="M3.75 10.5 12 2.25l8.25 8.25" />
    </svg>
  );
}
