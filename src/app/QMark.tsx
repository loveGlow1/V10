"use client";

import { useId, type CSSProperties } from "react";

/* The mark, flat.
 *
 * The 3D one cannot exist until three.js has downloaded, parsed and hydrated,
 * and until then its slot was an empty box — which on the hero sits directly on
 * top of a bright radial halo, so what a first-time visitor actually saw was a
 * white oval with a hole in the middle where the logo should be. The mark then
 * popped into it. That is the worst possible first frame: the one element that
 * says whose site this is arrives last.
 *
 * This is the same silhouette in a few hundred bytes of inline SVG. It has no
 * network cost and no script cost — it is markup, so it paints with the first
 * paint — and Q3DCanvas cross-fades it out once the real one has drawn a frame.
 *
 * The geometry is taken from Q3DCanvasScene rather than eyeballed, so the two
 * line up through the fade: same ring radii, same tail angle and reach, and a
 * viewBox derived from the same camera. Change one and change the other. */

/* Mirrors Q3DCanvasScene. */
const RING_OUTER_RADIUS = 2.0;
const RING_INNER_RADIUS = 1.35;
const TAIL_INNER_REACH = 0.55;
const TAIL_OUTER_REACH = 2.75;
const TAIL_STROKE_WIDTH = 0.8;
const OBSIDIAN_BLACK = "#08080A";

/* Half the world-height the 3D camera sees at the origin: the camera sits at
   (2.4, 1.7, 9.5), which is 9.945 from the mark, and a 45° vertical fov covers
   2 · 9.945 · tan(22.5°) ≈ 8.238 of world at that distance. Dividing by `scale`
   gives a viewBox that frames this mark exactly as the camera frames that one,
   so the cross-fade is a change of material rather than a jump in size. */
const CAMERA_HALF_HEIGHT = 4.119;

/* The ring drawn as one stroked circle rather than two arcs: a stroke centred
   between the radii, as thick as the gap between them, is the same annulus with
   none of the path arithmetic. */
const RING_MID_RADIUS = (RING_OUTER_RADIUS + RING_INNER_RADIUS) / 2;
const RING_STROKE_WIDTH = RING_OUTER_RADIUS - RING_INNER_RADIUS;

/* The tail runs at -45°, down and to the right. SVG's y axis points down, so
   the sign that makes it descend here is the opposite of the one in the scene. */
const DIAGONAL = Math.SQRT1_2;

export default function QMark({
  scale = 1,
  className = "",
  style,
}: {
  /** The same scale passed to the 3D mark, so both are framed alike. */
  scale?: number;
  className?: string;
  style?: CSSProperties;
}) {
  /* Unique per instance: two marks on one page must not share a gradient id.
     The colons React puts in an id are legal in an attribute but not in a CSS
     selector, and url(#…) is close enough to one to be worth avoiding. */
  const gradientId = `q-mark-${useId().replace(/:/g, "")}`;

  const half = CAMERA_HALF_HEIGHT / Math.max(scale, 0.01);

  return (
    <svg
      viewBox={`${-half} ${-half} ${half * 2} ${half * 2}`}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* The key light in the scene comes from the upper right, so the bevel
            reads brightest there and falls to near-black at the lower left.
            Two stops of that is enough to stop the placeholder looking like a
            sticker next to the lit one. */}
        <linearGradient id={gradientId} x1="1" y1="0" x2="0.1" y2="1">
          <stop offset="0%" stopColor="#B9BAC6" />
          <stop offset="26%" stopColor="#33333D" />
          <stop offset="78%" stopColor={OBSIDIAN_BLACK} />
        </linearGradient>
      </defs>

      <g fill="none" stroke={`url(#${gradientId})`} strokeLinecap="butt">
        <circle cx="0" cy="0" r={RING_MID_RADIUS} strokeWidth={RING_STROKE_WIDTH} />
        <line
          x1={TAIL_INNER_REACH * DIAGONAL}
          y1={TAIL_INNER_REACH * DIAGONAL}
          x2={TAIL_OUTER_REACH * DIAGONAL}
          y2={TAIL_OUTER_REACH * DIAGONAL}
          strokeWidth={TAIL_STROKE_WIDTH}
        />
      </g>
    </svg>
  );
}
