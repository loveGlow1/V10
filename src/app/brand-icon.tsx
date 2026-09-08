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

/* The mark stays black — it is the brand, and it is not the thing to change.
 * What changed is what it sits on. */
const MARK_BLACK = "#08090A";

/* A white ground, which is how a dark mark survives a browser tab.
 *
 * The mark on its own dark sphere is right on the page, where it sits against
 * a lit halo. As a favicon it was black on near-black: a smudge nobody can
 * pick out of a row of tabs, which is the one job the icon has. Lightening the
 * mark would have fixed the contrast by changing the logo, which is backwards.
 *
 * So the ground carries it instead. This is the arrangement OpenAI, Vercel,
 * Linear and Notion all land on for the same reason: one flat field, the mark
 * in full contrast on top, and nothing else competing at 16 pixels. It also
 * holds up in both browser themes — a white tile reads as a deliberate object
 * on a dark tab strip, where a dark tile disappears into it. */
const GROUND_WHITE = "#FFFFFF";

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

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          position: "relative",
          /* Flat, edge to edge. The stars and the vignette went with the dark
             sphere: on white the first are invisible and the second would be a
             grey haze at 16px, which is dirt rather than depth. */
          background: GROUND_WHITE,
        }}
      >
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
            border: `${ringBorder}px solid ${MARK_BLACK}`,
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
            background: MARK_BLACK,
            transform: "rotate(45deg)",
          }}
        />
      </div>
    ),
    { width: size, height: size },
  );
}
