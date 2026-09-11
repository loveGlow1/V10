"use client";

import { useEffect, useState } from "react";
import QMark from "./QMark";
import Q3DCanvasScene from "./Q3DCanvasScene";

/**
 * The scene is imported statically rather than through next/dynamic. It still cannot be
 * server-rendered — @react-three/fiber's Canvas needs a WebGL context and rAF — so it is
 * gated behind a mount flag. The difference is *when the code downloads*: a
 * `dynamic(..., { ssr: false })` chunk is only requested once hydration runs the import,
 * which measured at ~185ms before the ~240kB of three.js even started arriving, and far
 * worse on a slow connection — that gap is the mark visibly popping in after the rest of
 * the page. Importing it statically puts it in the page's bundle graph, so Next preloads
 * it alongside the main chunks and it is already parsed by the time hydration mounts it.
 */
/* Long enough to read as a material change rather than a swap, short enough
   that nobody waits for it. */
const FADE_MS = 500;
const FADE = `opacity ${FADE_MS}ms ease-out`;

/* Both marks in the same grid cell, which is what stacks them. */
const STACKED = "1 / 1";

export default function Q3DCanvas({
  scale = 1,
  className = "",
  withBackdrop = false,
  spinAxisTiltDeg,
  spinDirection,
  flat = false,
}: {
  scale?: number;
  className?: string;
  withBackdrop?: boolean;
  /** Skip WebGL entirely and paint the flat mark only.
   *
   *  For the small instances. At 40px the two are indistinguishable — the
   *  bevels the 3D one exists to show are a pixel wide there — and a canvas
   *  costs a GL context, which is the one resource on this page that is
   *  genuinely scarce: Chrome caps them per process and drops the oldest when
   *  the cap is hit, and a dropped context is a blank box where the logo was.
   *  The header's also sits inside a fixed, backdrop-blurred bar, which is the
   *  worst place to ask a canvas to composite correctly. Three contexts for one
   *  page, two of them for a 40px logo, was not a trade worth making. */
  flat?: boolean;
  /** Tilts the spin axis toward the camera so the mark never turns edge-on.
   *  For the small instances; see Q3DCanvasScene for why 60 is the number. */
  spinAxisTiltDeg?: number;
  /** 1 turns the near face left to right — the hero's turn, and the default.
   *  -1 runs the same turn the other way. */
  spinDirection?: number;
}) {
  const [mounted, setMounted] = useState(false);
  /* Three states, not two: `painted` starts the cross-fade, `retired` ends it.
     Unmounting the flat mark the moment the canvas draws would be a cut rather
     than a fade, and leaving it mounted forever would keep a second layer
     compositing behind a canvas that redraws every frame. */
  const [painted, setPainted] = useState(false);
  const [retired, setRetired] = useState(false);

  useEffect(() => {
    if (!flat) setMounted(true);
  }, [flat]);

  useEffect(() => {
    if (!painted) return;
    const timer = setTimeout(() => setRetired(true), FADE_MS);
    return () => clearTimeout(timer);
  }, [painted]);

  /* The two marks share one grid cell rather than being stacked with absolute
     positioning. Callers pass their own className — and two of them pass
     `absolute` in it — so this wrapper must not take a position of its own; a
     single-cell grid overlays its children without one. */
  return (
    <div className={className} style={{ display: "grid" }}>
      {/* Painted with the first paint, before a byte of three.js has run. */}
      {!retired && (
        <QMark
          scale={scale}
          className="h-full w-full"
          style={{ gridArea: STACKED, opacity: painted ? 0 : 1, transition: FADE }}
        />
      )}

      {mounted && (
        <Q3DCanvasScene
          scale={scale}
          withBackdrop={withBackdrop}
          spinAxisTiltDeg={spinAxisTiltDeg}
          spinDirection={spinDirection}
          className="h-full w-full"
          style={{ gridArea: STACKED, opacity: painted ? 1 : 0, transition: FADE }}
          onPainted={() => setPainted(true)}
          /* Back to the flat mark rather than a blank box. */
          onContextLost={() => {
            setPainted(false);
            setRetired(false);
          }}
        />
      )}
    </div>
  );
}
