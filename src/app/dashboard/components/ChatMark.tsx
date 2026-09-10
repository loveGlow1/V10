import React from "react";

/* The support chat's mark: a solid message bubble with its dots knocked out.
 *
 * The dots are cut from the shape with a mask rather than painted, so they take
 * whatever is behind the mark — which is what lets one drawing sit on the
 * launcher's dark disc and on a white tile alike.
 *
 * They were briefly painted in the accent, to put some of the brand's green on
 * a widget that had none. That was the right instinct and the wrong place for
 * it: the launcher is an outlined dark disc now, so the bubble on it is light,
 * and mint on a white bubble is close to invisible — the dots would have been
 * three faint smudges at 24px. The green moved to the rim and the pool of light
 * around the button, where the same restraint reads as light rather than as
 * decoration, and where it is not fighting the shape it sits inside. See
 * SupportChat. */
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
