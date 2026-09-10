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

   Two centre lines, and the second is derived from the first. The heading and
   the dot board are centred on the column by the same mx-auto. The button and
   every part of its light are centred on the A of .Ai — because a button under
   the one mint word on the board is a better place to stand than the middle of
   a line whose middle is the K of QuickStark.

   That second line is one number: md:left-[10.7%] on the button's wrapper.
   The board is a 131-column grid, its .Ai A occupies columns 77 to 82, so the
   A's centre sits 14 columns right of the board's — 14/131, which is 10.7% of
   whatever width the column has. A percentage rather than a pixel offset is
   what keeps the button under the A at 768px and at 2560px alike; the two
   would drift apart at every width but one if this were px. Re-derive it if
   the wordmark ever changes, and it is md-only because a phone gets the board
   on two lines with the A somewhere else entirely.

   Below that line nothing is nudged. Every lit span lives inside the button's
   own wrapper, so left-1/2 is the button's centre by construction and the
   whole light travels with the button rather than being re-aimed at it. No
   span here may carry an offset or a translate that is not -50% — the moment
   one does, the light is centred somewhere the button is not, and at some
   width that shows. */

/** The mint, as a literal: an SVG fill and a shadow cannot take a Tailwind class. */
const MINT = "rgb(52 245 160)";

export default function KeepBuilding({ onKeepBuilding }: { onKeepBuilding: () => void }) {
  /* The board's own light. White dots with a white bloom — the mint is spent on
     the four characters below rather than on the whole line, because a line
     that is entirely one colour has nothing to pick out. */
  const lit = "text-ink [filter:drop-shadow(0_0_9px_rgba(255,255,255,0.28))]";

  /* The bottom padding is where the light ends.

     It used to be 188/212px, chosen so a 320px pool could reach transparent on
     its own before the footer's divider — the rule then being that a pool of
     light cannot have a hard horizontal edge without turning into a rectangle.

     That rule was wrong about this room. In the reference the green does not
     fade out at all: it spreads downward off the button, widens as it goes,
     stays lit all the way to the foot of the band, and stops dead on the
     footer's hairline. The straight line is the end of the light — a floor
     seen edge-on, ending at a wall — and it only reads that way because the
     light is still bright when it gets there.

     So the padding is now the light's length rather than its room: the wash is
     168px tall and starts 20px below the button, so 112/124px of it shows and
     the section's overflow-hidden cuts the rest. Change one of these numbers
     and the others have to move, or the green either stops short of the
     divider or never gets to full strength before it. */
  return (
    <section className="relative w-full overflow-hidden px-4 pb-[132px] pt-16 text-center md:px-6 md:pb-[144px] md:pt-24">
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
         * THE POCKET. The button gets a band of dark of its own, and sits
         * about the middle of it: the wordmark's glow ends roughly 49px above
         * the pill and the green begins roughly the same distance below. That
         * balance is held by two numbers moving together and it is the reason
         * neither may be edited alone. The margin above came down by 20px
         * (mt-10/12 to mt-5/7), which lifts the button toward the board, and
         * every layer of the light went down by the same 20px, which keeps the
         * light where it already was on the page and hands the whole 20px to
         * the gap underneath. Move one without the other and the button either
         * drifts back into the green or the green stops short of the divider.
         *
         * The wrapper is exactly as wide as the button — a block in a
         * flex-col/items-center column takes its content's width — so every
         * `left-1/2 -translate-x-1/2` below resolves to the button's own
         * centre, at every width, with no measuring and nothing to keep in
         * sync. That is the whole trick: the light is a child of the thing
         * casting it, not a decoration hung off the section or the viewport.
         *
         * Four parts and the pill, from the floor up: the wash that runs to
         * the foot of the band, the pool of denser light inside it, the pill
         * itself, and the core with its filament — the brightest thing on the
         * floor. Nothing sits around the pill; the light is all below it. */}
        <div className="relative mt-5 md:left-[10.7%] md:mt-7">
          {/* THE WASH: the light on the floor, from the button to the wall.

              This is the whole figure. It hangs off the button's bottom edge,
              is brightest on the line the core sits on, and from there it
              spreads down and outward — the gradient's vertical radius is 185%
              of the box, so it is nowhere near spent when the section's bottom
              edge cuts it. That cut is the point: the straight line under the
              green is the footer's own hairline, and light that arrives at it
              still lit reads as a floor ending at a wall. Light that faded out
              first would just be a smudge with a rule underneath it.

              It widens on the way down for free. The iso-alpha contours of an
              ellipse this tall are narrow beside its centre and broad below
              it, so the green is tight where it leaves the button and spans
              most of the band by the time it reaches the divider.

              The mask is what keeps it off the button. A gradient this strong
              would otherwise put green in the air beside the pill and up
              toward the dot board — the old halo's mistake, arrived at from
              below instead of from around. Fading the top 34% of the layer to
              nothing leaves a band of dark under the button that the light
              starts on the far side of, and the pill keeps its own rim as the
              only thing lighting it.

              Widths: the box is 160vw with a 25% horizontal radius, so the
              green spans 80% of the screen at every width and the gradient is
              transparent a whole half-viewport before the box ends. That
              margin is not decoration. A mask only covers its own element, so
              the blur bleeding past the box edge gets cut off square there —
              give this layer a width the gradient actually reaches and the
              masking turns that falloff into a vertical seam. Under lg it also
              comes down in opacity, because a light that only narrows reads
              hotter in a smaller frame.

              NOTE — the wash carries the brightness; the near layers stay
              quiet. 0.32 falling to 0.03 across this gradient is what makes
              the floor still read as lit at the divider. The pool below is
              0.19 and the pale core 0.42, and those two are ceilings rather
              than starting points: raising them to give the light more
              presence is the wrong lever every time, because it turns a floor
              into a lamp pointed at the reader. Presence comes from this layer
              reaching the bottom edge still lit. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-full h-[168px] w-[160vw] -translate-x-1/2 translate-y-[20px] bg-[radial-gradient(ellipse_25%_185%_at_50%_30%,rgba(52,245,160,0.32),rgba(52,245,160,0.23)_26%,rgba(52,245,160,0.15)_50%,rgba(52,245,160,0.08)_72%,rgba(52,245,160,0.03)_90%,transparent_100%)] opacity-90 blur-[22px] [-webkit-mask-image:linear-gradient(180deg,transparent_0%,#000_34%)] [mask-image:linear-gradient(180deg,transparent_0%,#000_34%)] lg:opacity-100"
          />

          {/* THE POOL: the near, denser part of the same light.
           *
              Its centre sits 72px below the button — the same line as the core
              below, because a light source has one brightest point and
              everything on the floor has to agree where it is. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-full h-[84px] w-[min(540px,56vw)] -translate-x-1/2 translate-y-[30px] rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(52,245,160,0.19),rgba(52,245,160,0.055)_46%,transparent_74%)] opacity-90 blur-[15px] lg:opacity-100"
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
              under it. Both are centred on the same line, 72px down — the core
              gives the light its width, the filament gives it a centre. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-full h-[15px] w-[min(420px,44vw)] -translate-x-1/2 translate-y-[65px] rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(170,255,220,0.42),rgba(52,245,160,0.17)_44%,transparent_72%)] opacity-[0.88] blur-[7px] lg:opacity-100"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-full h-[4px] w-[min(270px,30vw)] -translate-x-1/2 translate-y-[70px] rounded-full bg-[linear-gradient(90deg,transparent,rgba(200,255,235,0.55),transparent)] opacity-[0.88] blur-[3px] lg:opacity-100"
          />
        </div>
      </div>
    </section>
  );
}
