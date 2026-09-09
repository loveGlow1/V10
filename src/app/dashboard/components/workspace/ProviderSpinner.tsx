"use client";

import React from "react";

import { ProviderMark } from "./modelMarks";
import type { Provider } from "../../models";

/* What a model looks like while it is thinking.
 *
 * ── Why a maker's mark rather than a spinner ───────────────────────────────
 *
 * A generic spinner says "wait". This says WHO is working, which is the thing
 * the person actually chose. Somebody who picked Fable over Haiku made a
 * decision about cost and quality, and watching an anonymous circle turn tells
 * them nothing about whether that decision took effect.
 *
 * It also closes a gap that was showing. The chat used to say "Sent your
 * message" — the app's own point of view, describing a request leaving for
 * somewhere. Nobody using this needs to know there is an orchestrator behind
 * it, and a message "sent" invites the question of where. What replaces it is
 * this: the model that is going to answer, visibly working.
 *
 * ── One effect, every brand ────────────────────────────────────────────────
 *
 * The animation is shared and the identity is not. Three sparkles orbit at
 * different radii and periods, the mark breathes underneath them, and a soft
 * halo sits behind — all of it in `currentColor`, so the whole thing takes the
 * tint the maker's mark already carries: Anthropic's clay, Gemini's violet,
 * OpenAI's ink. One component, three unmistakable results, and a fourth the day
 * a fourth maker is added.
 *
 * Deliberately NOT per-brand animations. A different motion for each would read
 * as three different loading states rather than one system, and the mark is
 * already doing the work of saying which is which.
 *
 * ── Honest about what it means ─────────────────────────────────────────────
 *
 * It turns while a request is in flight and stops when the answer lands. It is
 * not a progress bar and does not pretend to know how far along anything is —
 * the step list underneath carries that, measured. This is the part that says
 * something is happening and who is doing it.
 */

/* Where each sparkle sits, how far it swings, and how long it takes. Prime-ish
   periods so the three never settle into a visible lockstep — a repeating
   pattern reads as a loop, and a loop reads as stuck. */
const SPARKLES = [
  { cx: 12, cy: 2.6, r: 1.5, period: "2.4s", delay: "0s" },
  { cx: 20.4, cy: 15, r: 1.1, period: "3.1s", delay: "-0.7s" },
  { cx: 4.2, cy: 16.4, r: 0.9, period: "3.7s", delay: "-1.5s" },
] as const;

/* A four-pointed star: the shape drawn with concave sides so the points read as
   points at 8px rather than as a blurred diamond. */
function sparklePath(cx: number, cy: number, r: number) {
  const i = r * 0.32; // how far the waist pulls in
  return (
    `M${cx} ${cy - r}` +
    `Q${cx + i} ${cy - i} ${cx + r} ${cy}` +
    `Q${cx + i} ${cy + i} ${cx} ${cy + r}` +
    `Q${cx - i} ${cy + i} ${cx - r} ${cy}` +
    `Q${cx - i} ${cy - i} ${cx} ${cy - r}Z`
  );
}

export default function ProviderSpinner({
  provider,
  className = "h-[18px] w-[18px]",
  /** Stops the motion. The mark stays, so the row keeps its shape. */
  active = true,
}: {
  provider: Provider;
  className?: string;
  active?: boolean;
}) {
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${className}`}>
      {/* The halo. Sits behind everything, breathing slightly out of phase with
          the mark so the two together read as one soft pulse rather than as a
          thing blinking. */}
      {active && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-current opacity-[0.07] motion-safe:animate-[qs-halo_2.8s_ease-in-out_infinite]"
        />
      )}

      {/* The maker's own mark, which is where the colour comes from. */}
      <ProviderMark
        provider={provider}
        className={`relative h-[62%] w-[62%] ${
          active ? "motion-safe:animate-[qs-breathe_2.8s_ease-in-out_infinite]" : ""
        }`}
      />

      {/* The sparkles, over the top. aria-hidden throughout: this is decoration
          on a row whose text already says what is happening, and a screen
          reader announcing three twinkling stars would be noise. */}
      {active && (
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full text-current motion-safe:animate-[qs-orbit_5.5s_linear_infinite]"
        >
          {SPARKLES.map((s) => (
            <path
              key={`${s.cx}-${s.cy}`}
              d={sparklePath(s.cx, s.cy, s.r)}
              fill="currentColor"
              className="motion-safe:animate-[qs-twinkle_var(--qs-period)_ease-in-out_infinite]"
              style={
                {
                  "--qs-period": s.period,
                  animationDelay: s.delay,
                  transformOrigin: `${s.cx}px ${s.cy}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </svg>
      )}
    </span>
  );
}
