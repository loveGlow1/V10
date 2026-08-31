import React from "react";

/* The two marks the workspace's view switch carries.

   Drawn on the same 24 grid as the phone marks in ../marks.tsx — every
   coordinate a multiple of 0.75, every stroke 2.25 — so at the 14px they render
   at, each edge lands on a whole device pixel instead of greying two rows of
   them. Lucide's Monitor and SlidersHorizontal were doing this job before, and
   at that size their thin strokes and long stands read as smudges rather than
   as a screen and a set of controls. */

type MarkProps = { className?: string };

/* A window, not a monitor: a frame with a chrome bar and two lights in it. The
   pane below the bar is what is being previewed, so it is left empty — a stand
   and a bezel spend the mark's few pixels on furniture instead. */
export function PreviewMark({ className }: MarkProps) {
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
      <rect x="2.25" y="3.75" width="19.5" height="16.5" rx="3.75" />
      <path d="M2.25 9h19.5" />
      <circle cx="6" cy="6.375" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="9" cy="6.375" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* Two faders at different settings. The offset knobs are the whole mark: level
   knobs draw a column, and a column reads as a table rather than as something
   that has been adjusted. */
export function ManageMark({ className }: MarkProps) {
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
      <path d="M3 8.25h18" />
      <path d="M3 15.75h18" />
      <circle cx="15.75" cy="8.25" r="2.25" fill="currentColor" stroke="none" />
      <circle cx="8.25" cy="15.75" r="2.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* A terminal: a prompt chevron and a cursor rule, in a frame.

   The tracker lists operations that ran on a server, and this is the mark that
   says so before a word of it is read — the same shorthand a shell has used for
   forty years. Drawn on the same 24 grid as the two above, so it sits on the
   whole pixel at 14px like everything else in this row.

   The chevron sits left of centre and the rule beside it rather than under it,
   which is what makes the pair read as a prompt awaiting input instead of as a
   greater-than sign next to a dash. */
export function TerminalMark({ className }: MarkProps) {
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
      <rect x="2.25" y="3.75" width="19.5" height="16.5" rx="3.75" />
      <path d="M6.75 9.75 9.75 12l-3 2.25" />
      <path d="M12.75 15h4.5" />
    </svg>
  );
}
