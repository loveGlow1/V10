"use client";

import React from "react";
import { ArrowRight } from "lucide-react";

import DotMatrixText from "./DotMatrixText";

/* The band at the foot of Home: one line of encouragement and one button back
   to the composer at the top of the same page.

   The second line is the brand on a dot board — the one piece of display type
   in the app, which is why it is drawn rather than set.

   ── The light ─────────────────────────────────────────────────────────────

   The whole band is one lit object standing in a dark room, and everything
   below is in service of that: the board is lit white with the name's own
   suffix picked out in the brand mint, the button is a rim of light rather
   than a filled shape, and the floor under it carries the pool that light
   would actually cast. A filled button here would read as a control that
   happened to land in the dark; an outlined one reads as the thing the light
   is coming from. */

/** The mint, as a literal: an SVG fill and a shadow cannot take a Tailwind class. */
const MINT = "rgb(52 245 160)";

export default function KeepBuilding({ onKeepBuilding }: { onKeepBuilding: () => void }) {
  /* The board's own light. White dots with a white bloom — the mint is spent on
     the four characters below rather than on the whole line, because a line
     that is entirely one colour has nothing to pick out. */
  const lit = "text-ink [filter:drop-shadow(0_0_9px_rgba(255,255,255,0.28))]";

  /* The bottom padding is the light's room to finish.

     It was pb-20/28, and the floor pool was 320px tall hanging off the
     section's own bottom edge — so overflow-hidden cut it in a straight line
     across the band. A hard horizontal edge is the one thing a pool of light
     cannot have; it stops reading as light and starts reading as a rectangle.
     The padding is now deep enough that the gradient reaches transparent on
     its own, inside the section, before the footer's divider. Nothing below
     moves: the band simply owns the space its own light needs. */
  return (
    <section className="relative w-full overflow-hidden px-4 pb-[188px] pt-16 text-center md:px-6 md:pb-[212px] md:pt-24">
      <div className="relative mx-auto flex w-full max-w-[880px] flex-col items-center">
        <h2 className="text-[clamp(28px,7vw,54px)] font-semibold leading-[1.06] tracking-tight text-ink">
          Start building with
        </h2>

        {/* One line on a pointer. On a phone nineteen characters across 350px
            leaves a dot barely a pixel wide — the board stops reading as dots
            and becomes a smear — so the phone gets two lines at roughly twice
            the pitch. The second is 37% of the first because that is the ratio
            of their widths in cells (33 to 89), which is what keeps the two
            lines the same size. */}
        <div className="mt-4 flex w-full flex-col items-center gap-2.5 md:hidden">
          <DotMatrixText
            text="QuickStark.Ai"
            fill={0.84}
            highlight=".Ai"
            highlightColor={MINT}
            className={`w-full ${lit}`}
          />
          <DotMatrixText text="today" fill={0.84} className={`w-[37%] ${lit}`} />
        </div>

        <DotMatrixText
          text="QuickStark.Ai today"
          fill={0.84}
          highlight=".Ai"
          highlightColor={MINT}
          className={`mt-6 hidden w-full md:block ${lit}`}
        />

        {/* The button, and the light it is made of.
         *
         * Three parts: the pill itself, which is a hairline and nothing else;
         * two bright rules hugging its top and bottom edge, brightest at the
         * centre and gone by the ends, which is what makes it read as lit
         * rather than merely outlined; and a soft halo behind the whole thing.
         * The halo is separate from the floor pool above because they are
         * different distances away — the halo belongs to the button and moves
         * with it. */}
        <div className="relative mt-10 md:mt-12">
          {/* THE SPILL: the pool the button's light lays on the floor.
           *
              It used to hang off the section — bottom-0 on the <section>, so
              its centre was wherever the band happened to end rather than
              wherever the button happens to be. It lives in the button's own
              wrapper now, so left-1/2 is the button's centre line, not the
              band's, and the two cannot drift apart at any width.

              Geometry, since it is all offsets: the box is 320px tall and
              starts at the button's bottom edge (top-full), pulled up 116px,
              which puts its centre — the brightest point — 44px below the
              button, on the same axis as the reflection just under it. The
              gradient is transparent by 70% of its radius, so it has finished
              112px past that centre, well inside the padding above.

              The colours are the ones it always had. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-full h-[320px] w-[min(980px,96vw)] -translate-x-1/2 -translate-y-[116px] rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(52,245,160,0.26),rgba(52,245,160,0.09)_42%,transparent_70%)] blur-[16px]"
          />

          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 h-[150px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(52,245,160,0.30),transparent_68%)] blur-xl"
          />

          <button
            onClick={onKeepBuilding}
            className="group relative inline-flex h-[52px] items-center gap-3 rounded-full border border-accent/25 bg-canvas/40 px-8 text-[15px] font-medium text-ink backdrop-blur-sm transition-colors hover:border-accent/45 active:scale-[0.98]"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-6 -top-[2px] h-[3px] rounded-full bg-[linear-gradient(90deg,transparent,rgba(52,245,160,0.85),transparent)] blur-[3px]"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(180,255,225,1),transparent)]"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-6 -bottom-[2px] h-[3px] rounded-full bg-[linear-gradient(90deg,transparent,rgba(52,245,160,0.85),transparent)] blur-[3px]"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-8 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(180,255,225,1),transparent)]"
            />
            Keep Building
            <ArrowRight className="h-[18px] w-[18px] shrink-0 transition-transform group-hover:translate-x-0.5" />
          </button>

          {/* THE REFLECTION: the button's own rim, bounced off the floor.
           *
              Narrow, wider than the button, brightest at its centre and gone by
              its ends — and separated from the button by a band of dark. That
              gap is the whole effect: light touching the thing that casts it is
              a glow, and light with room between them is a reflection. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-full h-[22px] w-[460px] -translate-x-1/2 translate-y-[40px] rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(140,255,215,0.62),rgba(52,245,160,0.30)_45%,transparent_72%)] blur-[8px]"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-full h-[6px] w-[230px] -translate-x-1/2 translate-y-[48px] rounded-full bg-[linear-gradient(90deg,transparent,rgba(200,255,235,0.8),transparent)] blur-[4px]"
          />
        </div>
      </div>
    </section>
  );
}
