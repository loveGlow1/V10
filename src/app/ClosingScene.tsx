"use client";

import Image from "next/image";

/* The closing call to action: the artwork's scene, edge to edge, with its words
 * set as type on top of it.
 *
 * ── Why the words are not in the picture any more ─────────────────────────
 *
 * They used to be. /page.jpg is a 1024px square with the wordmark, headline,
 * promise and button painted into it, and the headline spans 90% of that
 * canvas — so the frame WAS the type's size. The picture could not reach the
 * edge of a desktop screen without carrying every letter up with it, and every
 * way round that cost something: covering the screen enlarged the words,
 * cropping to a band took the grass, and building the margins out of the
 * picture invented pixels that read as invented next to a photograph.
 *
 * Separating the two ends the trade. /page-scene.jpg is that same file with the
 * words lifted out — sky, glow, cloud, mark, grass and rock, untouched — so the
 * scene is free to span any width, while the words below are held at the size
 * they were painted and never scale with it.
 *
 * The scene was made from the original by rebuilding the sky the words sat on:
 * for every column, rows 44 to 550 are the straight line between the last clean
 * row above and the first clean row below. That band is a smooth vertical ramp
 * in the artwork, so the reconstruction is the artwork's own gradient, and the
 * left-hand glow survives it because the work is done per column. Nothing below
 * row 550 is touched, which is everything anyone actually looks at.
 *
 * ── Held at the painted size ──────────────────────────────────────────────
 *
 * Every measurement below is in units of the original canvas, carried by --u:
 * one unit is one pixel of the 1024px file. Below 1024 the unit tracks the
 * viewport, so a phone gets exactly what it got when the words were painted in
 * — same sizes, same positions, to the pixel. At 1024 and above the unit locks
 * to 1px and stops growing, which is the whole point: the scene widens, the
 * words do not.
 *
 * Sizes and colours are measured off the file rather than chosen. The headline
 * is 85.7u because that is the size at which DM Sans sets the longer line to the
 * 921u it occupies in the artwork, measured off the render rather than guessed; the greens, the greys and the button fill
 * are the artwork's own pixel values. */

/* One unit = one pixel of the original 1024px canvas, until 1024. */
const UNIT = "min(0.09766vw, 1px)";

/* Section height. Below 1024 it is the square the file always was. Above it,
   the height that keeps the mark's top row exactly 570u down — the room the
   words need — while the scene scales with the width. The two expressions meet
   at 1024, so nothing jumps at the breakpoint. */
const HEIGHT = "min(100vw, calc(570px + 44.34vw))";

/* The artwork's own colours, sampled off the pixels. */
const WHITE = "#ffffff";
const GREEN = "rgb(174,252,106)";
const GREY = "rgb(204,216,212)";
const PILL = "rgb(178,251,118)";
const PILL_INK = "rgb(6,26,6)";

function u(n: number) {
  return `calc(${n} * var(--u))`;
}

export default function ClosingScene({ onStart }: { onStart: () => void }) {
  return (
    <section
      id="get-started"
      className="relative w-full overflow-hidden"
      style={{ ["--u" as string]: UNIT, height: HEIGHT }}
    >
      {/* Anchored to the bottom, so what a wide screen trims is sky and never
          the grass. */}
      <Image
        src="/page-scene.jpg"
        alt=""
        fill
        sizes="100vw"
        className="object-cover object-bottom"
        /* eager rather than priority, and never lazy. priority preloads into the
           <head>, which is right for the first screen and wrong for the last thing
           on the page. Lazy would leave this blank at the moment somebody arrives
           at it. */
        loading="eager"
      />

      <div className="absolute inset-0 font-display">
        <p
          className="absolute left-1/2 -translate-x-1/2 font-bold"
          style={{
            top: u(58),
            fontSize: u(41.7),
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: WHITE,
            whiteSpace: "nowrap",
          }}
        >
          QuickStark <span style={{ color: GREEN }}>.Ai</span>
        </p>

        <h2
          className="absolute left-1/2 -translate-x-1/2 text-center font-bold"
          style={{
            top: u(150),
            fontSize: u(85.7),
            /* 97u between the two cap tops, measured off the file. */
            lineHeight: 97 / 85.7,
            letterSpacing: "-0.03em",
            color: WHITE,
            whiteSpace: "nowrap",
          }}
        >
          Start building
          <br />
          on <span style={{ color: GREEN }}>QuickStark.Ai</span> today.
        </h2>

        <p
          className="absolute left-1/2 -translate-x-1/2 text-center"
          style={{
            top: u(367),
            fontSize: u(25.9),
            lineHeight: 1,
            color: GREY,
            whiteSpace: "nowrap",
          }}
        >
          Turn your ideas into fully functional apps—faster than ever.
        </p>

        <button
          type="button"
          onClick={onStart}
          className="absolute left-1/2 -translate-x-1/2 inline-flex items-center justify-center rounded-pill font-semibold transition-[box-shadow,transform] duration-300 hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/70"
          style={{
            top: u(438),
            width: u(314),
            height: u(75),
            gap: u(18),
            fontSize: u(26),
            background: PILL,
            color: PILL_INK,
          }}
        >
          Get Started
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: u(26), height: u(26) }}
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </section>
  );
}
