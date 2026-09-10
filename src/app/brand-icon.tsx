import { ImageResponse } from "next/og";

/* The mark, drawn for a browser tab.
 *
 * Built from the SAME numbers as QMark.tsx and Q3DCanvasScene rather than
 * traced from an exported picture: ring radii, tail reach and tail angle are
 * the constants below, so the tab icon cannot drift away from the logo on the
 * page. Change the mark and change these together.
 *
 * ImageResponse rather than a checked-in PNG, for one reason that matters at
 * this size: an icon is wanted at 32px, 180px and 512px, and a single binary
 * is wrong at two of them. This renders each one at its own size, so the ring
 * is 21px thick on the apple icon and 3px thick in the tab, both deliberately.
 *
 * Drawn with boxes, not SVG. The renderer behind ImageResponse supports a
 * subset of CSS and is dependable about borders, radii and transforms — a ring
 * is a circle with a thick border, and the tail is a rotated rectangle. Both
 * are exact here; neither needs a path. */

/* Mirrors QMark.tsx. */
const RING_OUTER_RADIUS = 2.0;
const RING_INNER_RADIUS = 1.35;
const TAIL_INNER_REACH = 0.55;
const TAIL_OUTER_REACH = 2.75;
const TAIL_STROKE_WIDTH = 0.8;
const DIAGONAL = Math.SQRT1_2;

/* Green mark on a black tile — the icon this product has always had.
 *
 * These two are lifted from the icon that shipped before this file existed
 * (public/icon-192.png, deleted in 02e2aec): its ground sampled #050505 and its
 * mark #8EF08A, and that green is exactly --brandGreen-rgb: 142 240 138 in
 * globals.css. So this is the brand's own pair rather than a new choice.
 *
 * It was briefly inverted — black mark, white ground — to solve a real problem:
 * the mark on its own dark sphere was near-black on near-black, a smudge nobody
 * could pick out of a row of tabs. But inverting solved contrast by discarding
 * the colour people actually recognise the product by, and there was a way to
 * have both: keep the dark ground and put the mark in brand green on it. Green
 * on near-black is a stronger contrast than black on white, and it is the thing
 * somebody's eye is already trained to find. */
const MARK_GREEN = "#8EF08A";
const GROUND_BLACK = "#050506";

/* The bezel: a light rim around the black tile.
 *
 * It is doing a job, not decoration. A near-black tile on a dark browser
 * chrome has no outer edge — the icon bleeds into the toolbar and loses its
 * shape, which is the whole reason a tab icon is recognisable at a glance.
 * The rim gives the tile a silhouette against a dark UI, and against a light
 * one the black does that on its own.
 *
 * Silver rather than white, and a gradient rather than a flat fill, because
 * that is what reads as a machined edge: light catching the top-left, shading
 * away to the bottom-right. Three stops sampled off the aluminium finish the
 * brief named. At 16px the gradient collapses to a single light grey, which is
 * the right thing for it to collapse to. */
const BEZEL_LIGHT = "#F6F7F8";
const BEZEL_MID = "#DADCDF";
const BEZEL_DARK = "#B4B8BE";

/* How thick the rim is, as a share of the icon. 6% is ~2px in a 32px tab —
   thin enough to stay a rim rather than a frame, thick enough to survive the
   browser halving a 64px render twice. */
const BEZEL_SHARE = 0.06;

/* A rounded tile rather than a square one, at the same proportion the old icon
   used. Square corners at 16px read as a screenshot of something; the radius is
   what makes it an object. */
const CORNER_SHARE = 0.22;

/* How much of the icon the mark's ring spans. The tail reaches further than
   the ring does — 2.75 against 2.0 — so this leaves room for it to finish
   inside the frame rather than touching the edge. */
const RING_SHARE = 0.58;

export function brandIcon(size: number) {
  /* Pixels per world unit, derived from the ring so every other measurement
     follows from the same scale. */
  const unit = (size * RING_SHARE) / (RING_OUTER_RADIUS * 2);

  const ringOuter = RING_OUTER_RADIUS * 2 * unit;
  const ringBorder = (RING_OUTER_RADIUS - RING_INNER_RADIUS) * unit;

  const tailLength = (TAIL_OUTER_REACH - TAIL_INNER_REACH) * unit;
  const tailWidth = TAIL_STROKE_WIDTH * unit;
  /* The tail's midpoint, out along the 45° diagonal from the centre. */
  const tailOffset = ((TAIL_INNER_REACH + TAIL_OUTER_REACH) / 2) * unit * DIAGONAL;

  const bezel = size * BEZEL_SHARE;
  const outerRadius = size * CORNER_SHARE;

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          position: "relative",
          /* The bezel is this element's own background, with the black tile
             laid over it inset by the rim's thickness — rather than a CSS
             border on the tile.
             
             Two reasons. A border cannot take a gradient without
             border-image, which this renderer does not do; and a border would
             shrink the padding box every absolute child below is measured
             against, silently moving the mark off centre. Painting the rim
             underneath leaves the mark's geometry addressed to the full size,
             exactly as it was. */
          background: `linear-gradient(145deg, ${BEZEL_LIGHT} 0%, ${BEZEL_MID} 48%, ${BEZEL_DARK} 100%)`,
          borderRadius: outerRadius,
        }}
      >
        {/* The tile. Flat: the stars and the vignette that surround the mark
            on the page do not come with it — at 16px the first are invisible
            and the second is a grey haze, which is dirt rather than depth.
            
            Its radius is the outer one less the rim, so the two curves stay
            concentric instead of the inner corner turning square. */}
        <div
          style={{
            position: "absolute",
            left: bezel,
            top: bezel,
            width: size - bezel * 2,
            height: size - bezel * 2,
            background: GROUND_BLACK,
            borderRadius: outerRadius - bezel,
          }}
        />

        {/* The ring: a circle whose border IS the stroke, so its inner and
            outer edges land on RING_INNER_RADIUS and RING_OUTER_RADIUS
            exactly. */}
        <div
          style={{
            position: "absolute",
            left: (size - ringOuter) / 2,
            top: (size - ringOuter) / 2,
            width: ringOuter,
            height: ringOuter,
            borderRadius: ringOuter,
            border: `${ringBorder}px solid ${MARK_GREEN}`,
            boxSizing: "border-box",
          }}
        />

        {/* The tail, down and to the right at 45°. */}
        <div
          style={{
            position: "absolute",
            left: size / 2 + tailOffset - tailLength / 2,
            top: size / 2 + tailOffset - tailWidth / 2,
            width: tailLength,
            height: tailWidth,
            background: MARK_GREEN,
            transform: "rotate(45deg)",
          }}
        />
      </div>
    ),
    { width: size, height: size },
  );
}
