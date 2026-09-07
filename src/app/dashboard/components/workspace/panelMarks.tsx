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

/* A headset with a message in it: the support mark.

   Solid where the three above are stroked, because that is what it is a drawing
   of — a person wearing a headset is a support desk, and at 16px an outline of
   one collapses into a tangle of hairlines. The band, the cups and the boom are
   the operator; the bubble is the conversation the button opens.

   Nothing here overlaps: the cups sit hard against the edges of the box and the
   bubble spans the gap between them with a unit of air on either side, which is
   the whole reason the mark still reads at 16px. The dots are knocked out of the
   bubble rather than painted, so the mark takes the toolbar's colour and works
   on a dark bar and a light one alike. */
export function SupportMark({ className }: MarkProps) {
  const id = React.useId();
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="#fff" />
        <circle cx="8.95" cy="12.1" r="1.1" fill="#000" />
        <circle cx="12" cy="12.1" r="1.1" fill="#000" />
        <circle cx="15.05" cy="12.1" r="1.1" fill="#000" />
      </mask>

      <g fill="currentColor">
        {/* The band, an arc rather than two joined curves, so its ends land in
            the middle of each cup instead of butting against a corner. */}
        <path
          d="M3 10.2a9 9 0 0 1 18 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect x="0.6" y="8.8" width="4.2" height="7.2" rx="2.1" />
        <rect x="19.2" y="8.8" width="4.2" height="7.2" rx="2.1" />
        {/* The boom swings off the right cup; the capsule sits at its end. */}
        <path
          d="M21.3 15.4c0 4-2.1 5.5-4.7 5.9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <rect x="12" y="19.6" width="4.6" height="3.5" rx="1.75" />
      </g>

      <g mask={`url(#${id})`} fill="currentColor">
        <rect x="5.9" y="7.5" width="12.2" height="9.8" rx="4.3" />
        {/* The tail is what makes it read as a message rather than a mouth. */}
        <path d="M7.3 15.6h4.6l-4 4.1a.6.6 0 0 1-1-.43z" />
      </g>
    </svg>
  );
}
