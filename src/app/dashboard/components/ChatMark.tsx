import React from "react";

/* The support chat's mark: a solid message bubble with three dots in it.
 *
 * The dots used to be knocked out of the bubble with a mask, so they took
 * whatever colour was behind the mark — which kept it working on the white
 * launcher and on a dark tile alike, but left the whole widget monochrome.
 * They are painted the accent now, which is the one spot of the brand's green
 * on the launcher.
 *
 * Painted rather than masked means they need a colour that survives both
 * grounds, and `fill-accent` is exactly that: the token is mint (52 245 160)
 * on the dark theme, where the bubble under it is near-black, and a deep
 * emerald (4 142 96) on the light one, where the bubble is white. One class,
 * strong contrast either way — which a fixed hex could not have done, since
 * mint on white is close to invisible.
 *
 * The bubble itself stays currentColor, so both call sites still set it with
 * a text colour and nothing else about the mark moved. */
export default function ChatMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <g fill="currentColor">
        <rect x="2.5" y="4.5" width="19" height="14.5" rx="4.5" />
        {/* The tail is what makes it read as a message rather than a face. */}
        <path d="M7.6 17.4h5.2l-4.3 4.1a.6.6 0 0 1-1-.44z" />
      </g>
      <g className="fill-accent">
        <circle cx="8.2" cy="11.6" r="1.35" />
        <circle cx="12" cy="11.6" r="1.35" />
        <circle cx="15.8" cy="11.6" r="1.35" />
      </g>
    </svg>
  );
}
