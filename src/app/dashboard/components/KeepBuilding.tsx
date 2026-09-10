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
   is coming from.

   ── The axis ──────────────────────────────────────────────────────────────

   One centre line runs through the heading, the dot board, the button and
   every part of the light. It is not four things each centred by hand: the
   heading and the board are centred by the same mx-auto column, and every lit
   span lives inside the button's own wrapper, so left-1/2 is the button's
   centre line by construction. Nothing here may be nudged with a stray offset
   or a translate that is not -50% — the moment one of them is, the light is
   centred on the page and the button is centred on the column, and at some
   width those two stop being the same place. */

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
     moves: the band simply owns the space its own light needs.

     The light has since been made lower and wider, and now finishes about
     166px under the button rather than filling this — so the padding is no
     longer the tight fit it was, and there is room to grow the light again
     without moving the footer. It is the ceiling, not the measurement. */
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
         * The wrapper is exactly as wide as the button — a block in a
         * flex-col/items-center column takes its content's width — so every
         * `left-1/2 -translate-x-1/2` below resolves to the button's own
         * centre, at every width, with no measuring and nothing to keep in
         * sync. That is the whole trick: the light is a child of the thing
         * casting it, not a decoration hung off the section or the viewport.
         *
         * Four parts and the pill, from the floor up: the wide field, the
         * pool inside it, the pill itself, and the core with its filament —
         * the brightest thing on the floor. Nothing sits around the pill any
         * more; the light is all below it. */}
        <div className="relative mt-10 md:mt-12">
          {/* THE FIELD: how far the light gets before the room takes it.

              Low and wide, and it begins at the button's bottom edge —
              top-full with no lift, so no part of it is ever behind the pill.
              It used to start 64px above the button's top, which put a haze
              over the one thing in the band that has to stay crisp.

              The gradient does the shaping rather than the box: an ellipse
              58% of the width by 40% of the height, centred just over a third
              of the way down. That centre is the brightest line, 52px under
              the button, and the vertical radius is short enough that the
              light has spent itself before it reaches the pill's edge — what
              little arrives there is the contact glow a floor actually throws
              back, not a wash. Sideways it has the full 820px, which is what
              makes it read as a light field on a floor and not a disc behind a
              button.

              There is no halo any more. A layer centred ON the button, which
              is what that was, is light around the thing rather than under it:
              it hazed the air beside the pill and reached up toward the dot
              board, and it is the single reason this band read as noisy. The
              button's own four rim lines are the source now, and everything
              else is floor.

              Every width below is min(px, vw) on the same centre, so the
              tablet gets this composition at a smaller size rather than the
              desktop's spread clipped by the section's overflow-hidden — and
              under lg the near layers also come down in opacity, because a
              light that only narrows still reads hotter in a smaller frame.

              NOTE — wide and low, never hot. Every alpha here is a ceiling
              rather than a starting point: 0.14 on the field, 0.19 on the
              pool, 0.42 on the pale core. A light on a floor is a large dim
              thing; the moment one of these is raised to make it 'show up' it
              stops being a floor and becomes a lamp pointed at the reader. If
              it needs more presence, widen it.

              NOTE — this is the only floor light on Home, and it belongs to
              this button. One was tried under the composer at the top of the
              page and taken back out: two pools of the same light on one
              screen is not twice the effect, it is the end of the effect —
              a lit object is only lit while it is the one thing casting. The
              composer has its own orbiting rim and needs no floor. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-full h-[140px] w-[min(820px,88vw)] -translate-x-1/2 translate-y-[2px] bg-[radial-gradient(ellipse_58%_40%_at_50%_36%,rgba(52,245,160,0.14),rgba(52,245,160,0.06)_40%,rgba(52,245,160,0.018)_66%,transparent_84%)] opacity-90 blur-[24px] lg:opacity-100"
          />

          {/* THE POOL: the near, denser part of the same light.
           *
              Its centre sits 52px below the button — the same line as the core
              below, because a light source has one brightest point and
              everything on the floor has to agree where it is. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-full h-[84px] w-[min(540px,56vw)] -translate-x-1/2 translate-y-[10px] rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(52,245,160,0.19),rgba(52,245,160,0.055)_46%,transparent_74%)] opacity-90 blur-[15px] lg:opacity-100"
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

          {/* THE CORE, and the filament inside it: the brightest thing in
              the band, and the one place the mint goes pale.
           *
              Narrow, wider than the button, brightest at its centre and gone
              by its ends — and separated from the button by a band of dark.
              That gap is the whole effect: light touching the thing that casts
              it is a glow, and light with room between them is a floor.

              Drawn after the button so it sits over the field rather than
              under it. Both are centred on the same line, 52px down — the core
              gives the light its width, the filament gives it a centre. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-full h-[15px] w-[min(420px,44vw)] -translate-x-1/2 translate-y-[45px] rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(170,255,220,0.42),rgba(52,245,160,0.17)_44%,transparent_72%)] opacity-[0.88] blur-[7px] lg:opacity-100"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-full h-[4px] w-[min(270px,30vw)] -translate-x-1/2 translate-y-[50px] rounded-full bg-[linear-gradient(90deg,transparent,rgba(200,255,235,0.55),transparent)] opacity-[0.88] blur-[3px] lg:opacity-100"
          />
        </div>
      </div>
    </section>
  );
}
