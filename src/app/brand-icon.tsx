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

/* The mark, LIGHT.
 *
 * The logo is obsidian black, and on the page it sits on a bright halo where
 * that reads beautifully. In a browser tab it does not: the icon is 16px on a
 * dark ground, and black on near-black is a smudge you cannot pick out of a
 * row of tabs — which is the one job a favicon has.
 *
 * So the tab icon inverts the relationship rather than the design. The ground
 * stays the same dark sphere; the mark is the light on it. */
const MARK_LIGHT = "#F2F3F7";

/* How much of the icon the mark's ring spans. The tail reaches further than
   the ring does — 2.75 against 2.0 — so this leaves room for it to finish
   inside the frame rather than touching the edge. */
const RING_SHARE = 0.52;

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

  /* Small enough to disappear cleanly when the icon is scaled to 16px, which
     is what they should do — at that size they would be dirt on the glass. */
  const stars = [
    { x: 0.26, y: 0.22, r: 0.9, o: 0.32 },
    { x: 0.72, y: 0.19, r: 1.2, o: 0.42 },
    { x: 0.81, y: 0.4, r: 0.8, o: 0.28 },
    { x: 0.19, y: 0.63, r: 1.0, o: 0.34 },
    { x: 0.63, y: 0.79, r: 0.9, o: 0.3 },
    { x: 0.44, y: 0.14, r: 0.7, o: 0.24 },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          position: "relative",
          /* The ground the mark sits on: lit a little above and left of centre,
             falling to near-black at the corners, so the square reads as a
             sphere rather than a tile. */
          backgroundImage: `radial-gradient(circle at 44% 40%, #23232a 0%, #121216 55%, #08080a 100%)`,
        }}
      >
        {stars.map((star, index) => (
          <div
            key={index}
            style={{
              position: "absolute",
              left: star.x * size,
              top: star.y * size,
              width: (star.r * size) / 100,
              height: (star.r * size) / 100,
              borderRadius: size,
              background: "#ffffff",
              opacity: star.o,
            }}
          />
        ))}

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
            border: `${ringBorder}px solid ${MARK_LIGHT}`,
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
            background: MARK_LIGHT,
            transform: "rotate(45deg)",
          }}
        />
      </div>
    ),
    { width: size, height: size },
  );
}
