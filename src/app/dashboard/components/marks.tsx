import React from "react";

/* The four marks the phone toolbar and header draw, traced off the reference
   screenshot rather than picked from an icon set. Each was measured from the
   screenshot's own pixels at 2.275x and rebuilt on a 24 grid, which is why the
   proportions differ from lucide's: the reference's bars are shorter and
   thicker, its mic is a solid capsule rather than an outline, its arrow is
   wider-shouldered and thinner, and its agent has ears, a mouth and a chin. */

type MarkProps = { className?: string };

/* Robot. Head 14 x 13.6 with ears outside it, two square eyes, a mouth bar, an
   antenna above and a chin below — the shape the reference's chip carries. */
export function AgentMark({
  className,
  accent = "currentColor",
}: MarkProps & { accent?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 1.8V6.6" stroke={accent} />
      <rect x="4.6" y="6.6" width="14.8" height="13" rx="4.2" />
      {/* Ears */}
      <rect x="0.9" y="11" width="1.9" height="4.8" rx="0.95" fill="currentColor" stroke="none" />
      <rect x="21.2" y="11" width="1.9" height="4.8" rx="0.95" fill="currentColor" stroke="none" />
      {/* Eyes */}
      <rect x="8.1" y="11.3" width="2.2" height="2.4" rx="0.55" fill="currentColor" stroke="none" />
      <rect x="13.7" y="11.3" width="2.2" height="2.4" rx="0.55" fill="currentColor" stroke="none" />
      {/* Mouth */}
      <rect x="9.9" y="16.1" width="4.2" height="1.4" rx="0.7" fill="currentColor" stroke="none" />
      {/* Chin: a filled wedge under the head, not an outlined V — at 16px the
          reference's reads as one solid shape merging into the head's edge. */}
      <path d="M8.3 19.2h7.4L12 23.2Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* Three bars: 18 long and 2.4 thick on the 24 grid — shorter and heavier than
   lucide's Menu, which is what makes the reference's read as a solid stack. */
export function MenuMark({ className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 5.6h18M3 12h18M3 18.4h18" />
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
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="8" y="1.6" width="8" height="13.6" rx="4" fill="currentColor" stroke="none" />
      <path d="M18.9 12v2.1a6.9 6.9 0 0 1-13.8 0V12" />
      <path d="M12 21v2.4" />
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
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 22.3V1.7" />
      <path d="M2.9 9.9 12 1.7l9.1 8.2" />
    </svg>
  );
}
