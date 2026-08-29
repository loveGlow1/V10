"use client";

import React from "react";

import DotMatrixText from "./DotMatrixText";

/* The band at the foot of Home: one line of encouragement and one button back
   to the composer at the top of the same page.

   The second line is the brand on a dot board — the one piece of display type
   in the app, which is why it is drawn rather than set. The button sits in a
   pool of its own light, so the eye lands on it after reading the line above. */
export default function KeepBuilding({ onKeepBuilding }: { onKeepBuilding: () => void }) {
  /* The board's own light: the green it is lit in, and the bloom a lit dot has
     against a dark room. */
  const lit = "text-accent [filter:drop-shadow(0_0_10px_rgba(52,245,160,0.35))]";

  return (
    <section className="relative w-full overflow-hidden px-4 pb-20 pt-16 text-center md:px-6 md:pb-28 md:pt-24">
      {/* The glow under the button, and nothing else: a band that lit its own
          heading would compete with the composer this page is really about. */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/2 h-[220px] w-[min(760px,120vw)] -translate-x-1/2 translate-y-1/3 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.07),transparent_70%)]"
      />

      <div className="relative mx-auto flex w-full max-w-[880px] flex-col items-center">
        <h2 className="text-[clamp(28px,7vw,54px)] font-semibold leading-[1.06] tracking-tight text-ink">
          Start building with
        </h2>

        {/* One line on a pointer. On a phone nineteen characters across 350px
            leaves a dot barely a pixel wide — the board stops reading as dots
            and becomes a green smear — so the phone gets two lines at roughly
            twice the pitch. The second is 37% of the first because that is the
            ratio of their widths in cells (33 to 89), which is what keeps the
            two lines the same size. */}
        <div className="mt-4 flex w-full flex-col items-center gap-2.5 md:hidden">
          <DotMatrixText text="QuickStark.Ai" fill={0.84} className={`w-full ${lit}`} />
          <DotMatrixText text="today" fill={0.84} className={`w-[37%] ${lit}`} />
        </div>

        <DotMatrixText
          text="QuickStark.Ai today"
          fill={0.84}
          className={`mt-6 hidden w-full md:block ${lit}`}
        />

        <button
          onClick={onKeepBuilding}
          className="mt-10 h-[52px] rounded-full bg-solid px-8 text-[15px] font-semibold text-onSolid shadow-[0_10px_40px_rgba(255,255,255,0.16)] transition-all hover:brightness-95 active:scale-[0.98] md:mt-12"
        >
          Keep Building
        </button>
      </div>
    </section>
  );
}
