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
   scale anything, so it crops: 156 rows of empty sky off the top and 92 rows of
   foreground grass off the bottom, 776 left. The bottom edge lands at row 932,
   eight rows above the rock, so nothing in the picture is cut through — the cut
   is all sky and all foreground. The words move up with the sky
   they sit on, at exactly the sizes they already were, and nothing else in the
   picture is touched: the mark still runs from row 555 to 885 and the grass
   still crests at 880.
   
   The three are one sum — 156 of sky + 776 of band + 92 of grass = 1024 — so
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

/* The sky at the crop edge, one pixel wide and the file's full height.
 *
 * The sky in the artwork is a hard left-to-right gradient — 104 levels at the
 * left edge down to 25 near the right — and a mirror turns whatever sits on its
 * axis into a local maximum. Reflecting the sky therefore put a bright column
 * down the join: measured, the axis reads +14 levels against the 170 columns
 * inside it. That is a glow the artwork does not have.
 *
 * Above the cloud line the sky has no horizontal detail worth reflecting, so
 * the margin takes the edge column itself and holds it: the same colour the
 * scene ends on, carried straight out. No maximum at the join, because nothing
 * turns around there — it simply continues. The columns are smooth enough for
 * it, 0.15 and 0.10 levels of row-to-row step, so there is no banding to see.
 *
 * The reflection still does the cloud and the grass below, where there is real
 * detail and the gradient is weak. */
const SKY_LEFT = "data:image/png;base64,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";
const SKY_RIGHT = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAQACAIAAACvZKRoAAAGB0lEQVR42qXV+U/TZxwH8He2qKAIlLMgUi45hIJyemfqnBiTyXTGKaCccigUSg+gBakttLSUlpvKjRQo4LVTo/EHky1i1MUTRWM2p9mRZfsX9nyfQjkGWOCHV57P5/N8ns+3bZ5vijUsFmwdHGBrz8JqByfMzpl4taMjzRk29vbmGrNnP9E70b9UzCzLvGk1m7XTnmuJnRbmMJ3znFbPx9FaLnNjLc6a6ZwYrkvj/CFuC7JzWSp32Lkug9tMay3Y1nFfLI8p7LnZW8NjNs/F8fwwB2rd/61bBq9JXlZznG79h6yfn/fSsTjey+MzH86H+U5xspqPmd8y+c/mSzlbI2Ax/GbaYB2X+QRO8l+8IGsEWLhOF7xMIRuWzG3jQgIXFrpUQWZhU9wXizuXYOuEz489p5CZIhbmNsF1E0HOM7HHpo2U5+ZQih1JalEbwSYxszI8o0Moj6jgqTiGiA7FupgweMVysS4ulFofFzbNRoqzNQyc7Vx4byO1HRN2hsNrB5fG3ju5FGdXODifRMzgs3sTfPdshs8Ev72R8P80itrwWQwC90cj+EA0guKjEHKQOBCJ0IPRCP88DhGHiIQoRB2OxPbEWOxOiUMCby+Oi+KRXpEAvv4kKi/y0PyNBL23FRj+UYVL99S49rAWI6PV6LhZhurBPBTWJ+NY8UHsztiBbUlbsSNxO3YmbcOupFg6L1f1JbSX8mG6ex63xvW4974Vj/7swPN/evHi3wGM/W3Cs79MeP7HEJ79Pown70149JsRj9/14/Gv/Xj4Sz8evBnAvVdGjI73YXSsF/fHjbj34iKJ+6ifnhtx94UJ918O49GbrzH29jrG39/Eq3c38PLtDxh78x2ejF/DgyeXMPpgEHfvD2D0ZxMePr2MB8+u4s59E7690wPTjXa0DOuhM+qh7KxBuUGNkqYqFOlk4GnOIU/FkOFMtYyscipfKaMKNedRpFWgtLEaZS3kbKsW5wy1kDZrIG3QQKiron3Z8nKknZMgtVyKFGkZTpZKkFQsIWsZkkukFJMza6K4lDohlpgVl+K4uIT6SlRsMVk7ITI7Liw2m903q87EzHwmnpw92cvkjMQS83OTSqU4zvQQx4TiaXtkRrEAp8qESJeJCSGSJTwy4yyO8vNwmEcU5OOLgjM4ws9FoiQfaTIezmiKwNMXIl+fh7z6HOQ3ZIPXnAX+hdMQtGcR2chvzcbZphyc1mUhU5uLzBoeMjQFyFAXIlMjIGsRlaniI0NZSDC50CJLLSJ9IqQphUhRCpBWLUA6qacq+WZVAqRUFuFUldlJGptryecLyEq+l6KIrpNSq4RIUwiodPmUDAX5/pViKk0homiN7pG6XIRU+WSP0HL+dFUJ2Tc7rZBSmXImLkWOQoLcSinyqyuoPI2M4qllNC8gd47BU8tpjV8jt2DuowXJC2oV4GnlVKFWRvFrKyCqV6C4XomSBhXEDUqSV0GoV0KgU0FYq4JIV42i2kqKT+73ZCwg95nB9DJ3W1ynQrGOzNGrLCT1ZGZdFZmtnoF5R5jnSRuVlKRJRWrmVdrMvD9qVLRqUNGixXny/qgMOtR1NqK1twWd/Qb0DV6AabgTl6704DJB16u9uEIMj3RiZKQbw8NdGBrqxMBAG/oH29BHzhkHLlAXjS3o7mtA18V6tHfrqI4ePdq6amHoVKO9R43+kXoYh2rQ2lGGulYxWrvK0dOvIr1Kut/Tr0e3sY7kdWju0KKlg8zpbYShqw5NbVo0GDTknApNBhXaumvQ1afFwJCWfI5zuGDIQUd7OlSaeIjKY5CY440TZ32QWBiIowX+OJTDQfwpdySk+yKtIArf39bg+q1q6BuPoVIZj+bmE3j9ehCPx67g6asb5Hcpw5GUGMTtd0PcAVds3ueI8H0shO1hIXSvMwJ22cNriw08Y1eCHbWS/LetgAt3BflftIFr6Cp4cFfDK8IBHmF28OSuBZtrB6eglXAOXgW3EFu4Ba6BR4g9WAE2cPRfBdYGW7BI3TvWBX7b2AjY4gp2mC0cfQF7DuDA+QiOPh/DOdAG7NC18CIzIz7x+Q/EAhJxUzt7UAAAAABJRU5ErkJggg==";

/* Where the held sky hands over to the reflection: the cloud line is row 560 of
   the file, and the panel is the file's full height. */
const SKY_MASK = "linear-gradient(180deg,#000 0 48%,transparent 58%)";

/* How the left margin settles into the same sky the right one holds.
 *
 * The light in the artwork comes from the left, so its left edge column is four
 * times the brightness of its right: 61 against 16 at the top of the band, 104
 * against 37 at the bottom. Held flat across a wide margin, the left read as a
 * milky field — dust — while the right, being near-black, read as nothing at
 * all. They are the same trick and only one of them was visible.
 *
 * So the left margin now starts on its own edge column at the join, where it
 * has to match, and resolves over 260px into the right edge column — the same
 * sky the other side holds, so both margins end the page on the same tone. Both
 * layers are real columns of the artwork; nothing between them is invented but
 * the crossfade.
 *
 * The crossfade is eased rather than linear, and measured in percent of the
 * margin rather than pixels. Both matter. A straight ramp ends in a corner, and
 * on a 2560 screen that corner showed as a soft vertical edge partway out; the
 * stops below flatten into the settled tone instead. And a ramp fixed in pixels
 * either overshoots a narrow margin or stops short of a wide one — at 410px it
 * left a 1440 screen still twelve levels brighter on the left than the right.
 * In percent it always finishes exactly at the screen edge, so both sides end
 * the page on the same tone whatever the width. */
const SKY_SETTLE =
  "linear-gradient(to left,#000 0%,rgba(0,0,0,0.93) 11%,rgba(0,0,0,0.79) 24%," +
  "rgba(0,0,0,0.57) 40%,rgba(0,0,0,0.34) 56%,rgba(0,0,0,0.15) 72%," +
  "rgba(0,0,0,0.04) 85%,transparent 100%)";

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
      className="pointer-events-none absolute top-0 hidden h-full overflow-hidden lg:block lg:h-[1024px] lg:-top-[156px]"
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

      {/* The held sky. Two layers on the left, one on the right — the right
          edge column is already the tone both sides settle on. */}
      <div
        className="absolute inset-0"
        style={{ WebkitMaskImage: SKY_MASK, maskImage: SKY_MASK }}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("${SKY_RIGHT}")`,
            backgroundRepeat: "no-repeat",
            backgroundSize: "100% 100%",
          }}
        />
        {isLeft && (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url("${SKY_LEFT}")`,
              backgroundRepeat: "no-repeat",
              backgroundSize: "100% 100%",
              WebkitMaskImage: SKY_SETTLE,
              maskImage: SKY_SETTLE,
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function ClosingScene({ onStart }: { onStart: () => void }) {
  return (
    <section
      id="get-started"
      /* A square on a phone, where the scene already fits the width. A band on
         a desktop, so the whole thing lands inside one window. */
      className="relative h-[100vw] w-full overflow-hidden lg:h-[776px]"
      style={{ ["--u" as string]: UNIT }}
    >
      <Reflection side="left" />
      <Reflection side="right" />

      {/* The scene, centred and never past its own resolution. A full scene
          tall and pulled up by the crop for the same reason the reflections
          are: object-cover has to have the file's own height to keep 1:1. */}
      <div
        className="relative mx-auto h-full w-full lg:h-[1024px] lg:-mt-[156px]"
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
        <h2
          className="absolute left-1/2 -translate-x-1/2 text-center font-bold top-[calc(150*var(--u))] lg:top-[calc(24*var(--u))]"
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
          className="absolute left-1/2 -translate-x-1/2 text-center top-[calc(367*var(--u))] lg:top-[calc(239*var(--u))]"
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
          className="absolute left-1/2 -translate-x-1/2 top-[calc(438*var(--u))] lg:top-[calc(298*var(--u))] inline-flex items-center justify-center rounded-pill font-semibold transition-[box-shadow,transform] duration-300 hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-white/70"
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
