import React from "react";

/* One bot mark for the whole dashboard, so the support launcher, the chat's
   own avatar and the agent rows are recognisably the same character.

   The eyes are masked out to whatever is behind the mark rather than painted
   a fixed colour, so it sits on a white button and a dark tile alike. */
export default function BotMark({ className }: { className?: string }) {
  const id = React.useId();
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <mask id={id}>
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <rect x="8.1" y="10.3" width="2.7" height="3.4" rx="1.15" fill="#000" />
        <rect x="13.2" y="10.3" width="2.7" height="3.4" rx="1.15" fill="#000" />
      </mask>
      <rect x="2" y="5" width="20" height="14" rx="5" fill="currentColor" mask={`url(#${id})`} />
    </svg>
  );
}
