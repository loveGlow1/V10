"use client";

import Image from "next/image";

/* The closing call to action: the artwork's scene with its words set as type on
 * top of it.
 *
 * ── Why the words are not in the picture any more ─────────────────────────
 *
 * They used to be. /page.jpg is a 1024px square with the wordmark, headline,
 * promise and button painted into it, and the headline spans 90% of that
 * canvas — so the frame WAS the type's size, and the picture could not be shown
 * any larger without carrying every letter up with it.
 *
 * /page-scene.jpg is that same file with the words lifted out — sky, glow,
 * cloud, mark, grass and rock, untouched. The words below are set as type at the
 * size they were painted. Separating them means the picture's size and the
 * type's size are no longer the same dial.
 *
 * The scene was made from the original by rebuilding the sky the words sat on:
 * for every column, rows 44 to 550 are the straight line between the last clean
 * row above and the first clean row below. That band is a smooth vertical ramp
 * in the artwork, so what comes back is the artwork's own gradient, and the
 * left-hand glow survives it because the work is done per column. Nothing below
 * row 550 is touched, which is everything anyone actually looks at.
 *
 * ── How it reaches both edges without resizing anything ──────────────────
 *
 * The scene is drawn at 1:1 and never stretched — past its own width every
 * pixel in it would be enlarged, and the one thing in it with hard edges, the
 * mark, is what goes soft. A full-width 1440 layout was stretching it 1.41x,
 * and close to three times that on a 2x screen. Measured on the render, edge
 * energy across the mark falls from 7.59 to 4.48 when it is.
 *
 * So the margins are filled with the scene reflected, at 1:1, rather than with
 * the scene enlarged. This is only possible because the words came out of the
 * picture: with them in it, reflecting the top folded the headline back into
 * frame reversed, and the sky up there had to be faked instead. The scene has
 * no words at any height, so the reflection is the artwork's own pixels all the
 * way up — no gradients, nothing invented, nothing resized.
 *
 * ── Why the scene is cropped before it is reflected ───────────────────────
 *
 * A mirror turns whatever sits on its axis into a line of symmetry, and the
 * file's outermost columns are the worst possible axis. They carry a bright lip
 * — a border artifact of the render, +8 levels over six columns — and a thin
 * vertical light beam at column 22. Reflected, each became a hard vertical
 * line standing in the margin: measured, +10.4 at the join and +2.0 either side
 * of it.
 *
 * CROP drops those columns instead of repairing them. Repairing was tried three
 * ways — flattening the lip, flattening the edge gradient, and both per row
 * band — and every one of them traded the line for something worse: vertical
 * smears through the cloud, then blotches, because the correction has to grow
 * teeth to beat a gradient that steep. Cropping needs no correction at all. The
 * file stays exactly as it was; the reflection simply takes its axis 72 columns
 * in, where the profile is nearly flat. Measured across the file, that drops
 * the ridge at the join by 89%, and the beam is inside the part that is gone.
 *
 * The cost is 14% of the artwork's width, all of it sky and cloud edge — the
 * mark spans columns 372 to 722 and is nowhere near it, and the grass runs on
 * into the reflection without a break.
 *
 * ── Other things tried ────────────────────────────────────────────────────
 *
 * Resampling the file to 2048 with a sharpen first: edge energy came back 2.52
 * against 2.51 at 2x, which is nothing, because no resample invents detail the
 * file never had. Compositing the mark alone at 1:1 over a stretched
 * background: it breaks where the mark meets the grass, since a 1:1 mark
 * standing on 1.41x grass does not touch the ground it stands on.
 *
 * SCENE_MAX is the artwork's resolution. A larger export of the same scene
 * raises it, the scene itself reaches further before the reflection starts, and
 * not a pixel of type moves — the type has not been tied to the picture's size
 * since the words came out of it.
 *
 * ── Held at the painted size ──────────────────────────────────────────────
 *
 * Every measurement below is in units of the original canvas, carried by --u:
 * one unit is one pixel of the 1024px file. Below 1024 the unit tracks the
 * viewport, so a phone gets exactly what it got when the words were painted in
 * — same sizes, same positions, to the pixel. At 1024 it locks to 1px.
 *
 * Sizes and colours are measured off the file rather than chosen. The headline
 * is 85.7u because that is the size at which DM Sans sets the longer line to the
 * 921u it occupies in the artwork, measured off the render rather than guessed;
 * the greens, the greys and the button fill are the artwork's own pixel values. */

/* One unit = one pixel of the original 1024px canvas, until 1024. */
const UNIT = "min(0.09766vw, 1px)";

/* The artwork's own width in pixels. The scene is never drawn wider than this,
   because past it the mark is being stretched. Raise it the day a larger export
   of the same scene lands — nothing else here depends on the number. */
const SCENE_MAX = 1024;

/* How tall the band is on a desktop, and how much sky is taken off the top to
   get there.
   
   The scene is a square, and a 1024px square is taller than the window most
   people read this in — the end of it was below the fold. Shortening it cannot
   scale anything, so it crops: 102 rows of empty sky off the top and 92 rows of
   foreground grass off the bottom, 830 left. The bottom edge lands at row 932,
   eight rows above the rock, so nothing in the picture is cut through — the cut
   is all sky and all foreground. The words move up with the sky
   they sit on, at exactly the sizes they already were, and nothing else in the
   picture is touched: the mark still runs from row 555 to 885 and the grass
   still crests at 880, 52 rows above the new bottom edge.
   
   The three are one sum — 102 of sky + 830 of band + 92 of grass = 1024 — so
   changing one means changing another. They are written out literally in the
   classes below rather than kept here, because Tailwind reads class names as
   text and cannot see a constant.
   
   None of this touches a phone. There the scene already fits the width and the
   band is the square it always was, so the words keep the offsets they were
   painted at — every `top` below carries the painted value and an lg: override,
   and only the override is tightened. */

/* How much of the scene is shown. The rest — 72 columns a side, since the crop
   is centred — is the file's own bad border, dropped rather than reflected. */
const SCENE_W = 880;
const CROP = (SCENE_MAX - SCENE_W) / 2;

/* How far the reflection runs before it folds back. Under 229, the mark's
   clearance from the cropped edge (the mark spans columns 372 to 722). */
const FOLD = 220;

/* Six folds a side is 1320px of reflected scene, which is the margin on a
   3500px screen. Each is one <img>, and every copy on the section resolves to
   the same URL, so it stays one download and one decode. */
const FOLDS = [0, 1, 2, 3, 4, 5];

/* The same sizes as the scene itself, so the browser fetches one file. */
const SIZES = `(min-width: ${SCENE_MAX}px) ${SCENE_MAX}px, 100vw`;

/* The artwork's own colours, sampled off the pixels. */
const WHITE = "#ffffff";
const GREEN = "rgb(174,252,106)";
const GREY = "rgb(204,216,212)";
const PILL = "rgb(178,251,118)";
const PILL_INK = "rgb(6,26,6)";

function u(n: number) {
  return `calc(${n} * var(--u))`;
}

/* One margin, built from the scene reflected back on itself.
 *
 * object-cover on a square source in a tall FOLD-wide box is a 1:1 crop, so
 * object-left / object-right pick out the scene's own outermost columns at
 * their painted size. Every other fold is flipped, which is what makes
 * consecutive folds meet on a shared column. */
function Reflection({ side }: { side: "left" | "right" }) {
  const isLeft = side === "left";
  const edge = `calc(50% + ${SCENE_W / 2}px)`;
  /* Where the reflection takes its axis: CROP columns in from the file's edge,
     which is exactly the column the cropped scene ends on. */
  const from = isLeft ? `-${CROP}px center` : `calc(100% + ${CROP}px) center`;

  return (
    <div
      aria-hidden
      /* Hidden below 1024, where there is no margin to fill: the scene already
         spans the screen there. */
      /* A full scene tall and pulled up by the crop, so the reflection keeps
         1:1 — object-cover in a box shorter than the file would shrink it —
         and the band's own overflow does the cropping. */
      className="pointer-events-none absolute top-0 hidden h-full overflow-hidden lg:block lg:h-[1024px] lg:-top-[102px]"
      style={isLeft ? { left: 0, right: edge } : { right: 0, left: edge }}
    >
      {FOLDS.map((fold) => (
        <div
          key={fold}
          className="absolute inset-y-0 overflow-hidden"
          style={
            isLeft
              ? { width: FOLD, right: fold * FOLD }
              : { width: FOLD, left: fold * FOLD }
          }
        >
          <Image
            src="/page-scene.jpg"
            alt=""
            fill
            sizes={SIZES}
            className={["object-cover", fold % 2 === 0 ? "-scale-x-100" : ""].join(" ")}
            style={{ objectPosition: from }}
            loading="eager"
          />
        </div>
      ))}
    </div>
  );
}

export default function ClosingScene({ onStart }: { onStart: () => void }) {
  return (
    <section
      id="get-started"
      /* A square on a phone, where the scene already fits the width. A band on
         a desktop, so the whole thing lands inside one window. */
      className="relative h-[100vw] w-full overflow-hidden lg:h-[830px]"
      style={{ ["--u" as string]: UNIT }}
    >
      <Reflection side="left" />
      <Reflection side="right" />

      {/* The scene, centred and never past its own resolution. A full scene
          tall and pulled up by the crop for the same reason the reflections
          are: object-cover has to have the file's own height to keep 1:1. */}
      <div
        className="relative mx-auto h-full w-full lg:h-[1024px] lg:-mt-[102px]"
        style={{ maxWidth: `${SCENE_W}px` }}
      >
        <Image
          src="/page-scene.jpg"
          alt=""
          fill
          sizes={SIZES}
          className="object-cover object-center"
          /* eager rather than priority, and never lazy. priority preloads into the
             <head>, which is right for the first screen and wrong for the last thing
             on the page. Lazy would leave this blank at the moment somebody arrives
             at it. */
          loading="eager"
        />
      </div>

      {/* The words sit on the band, not inside the scene's box — the scene is
          taller than the band and pulled up by the crop, and the type must not
          be pulled up with it. Both are centred on the same middle, so they
          stay registered to each other. */}
      <div className="absolute inset-0 font-display">
        <p
          className="absolute left-1/2 -translate-x-1/2 font-bold top-[calc(58*var(--u))] lg:top-[calc(15*var(--u))]"
          style={{
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
          className="absolute left-1/2 -translate-x-1/2 text-center font-bold top-[calc(150*var(--u))] lg:top-[calc(78*var(--u))]"
          style={{
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
          className="absolute left-1/2 -translate-x-1/2 text-center top-[calc(367*var(--u))] lg:top-[calc(293*var(--u))]"
          style={{
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
          className="absolute left-1/2 -translate-x-1/2 top-[calc(438*var(--u))] lg:top-[calc(352*var(--u))] inline-flex items-center justify-center rounded-pill font-semibold transition-[box-shadow,transform] duration-300 hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/70"
          style={{
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
