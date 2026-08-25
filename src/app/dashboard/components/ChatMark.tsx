import React from "react";

/* The support chat's mark: a solid message bubble with its dots knocked out.
   The dots are cut from the shape rather than painted a fixed colour, so the
   mark sits on the white launcher and on a dark tile alike. */
export default function ChatMark({ className }: { className?: string }) {
  const id = React.useId();
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <mask id={id}>
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <circle cx="8.2" cy="11.6" r="1.35" fill="#000" />
        <circle cx="12" cy="11.6" r="1.35" fill="#000" />
        <circle cx="15.8" cy="11.6" r="1.35" fill="#000" />
      </mask>
      <g mask={`url(#${id})`} fill="currentColor">
        <rect x="2.5" y="4.5" width="19" height="14.5" rx="4.5" />
        {/* The tail is what makes it read as a message rather than a face. */}
        <path d="M7.6 17.4h5.2l-4.3 4.1a.6.6 0 0 1-1-.44z" />
      </g>
    </svg>
  );
}
