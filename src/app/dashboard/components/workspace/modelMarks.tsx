import React from "react";

type MarkProps = { className?: string };

/* The burst that stands for a Claude model in the picker and on the chip —
   eight tapered arms on a common centre, drawn rather than imported so it
   inherits currentColor and needs no asset. */
export function ModelMark({ className }: MarkProps) {
  const arms = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      {arms.map((angle) => (
        <path
          key={angle}
          d="M12 2.2 L13.05 9.6 L12 12 L10.95 9.6 Z"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
    </svg>
  );
}

/* Auto is the router, not a model, so it gets a target rather than a burst:
   a ring with the arm that points into it. */
export function AutoMark({ className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden
      className={className}
    >
      <circle cx="12" cy="12" r="7.2" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
      <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2" />
    </svg>
  );
}
