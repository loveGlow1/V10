"use client";

import { useEffect, useRef, useState } from "react";
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
}: {
  scale?: number;
  className?: string;
  withBackdrop?: boolean;
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

  /* Whether this mark is anywhere near the screen.
   *
   *  A GL context is the scarcest thing on the page: Chrome caps how many live
   *  at once per process and silently drops the oldest when the cap is hit — a
   *  few tabs of anything that draws will do it — and a canvas whose context
   *  has gone is a blank box where the logo should be. That is what turned the
   *  header's mark white on a refresh.
   *
   *  So a mark holds a context only while it is worth drawing. The footer's and
   *  the hero's release theirs the moment they are well off screen and take one
   *  back before they return, which on the landing page is usually one context
   *  live instead of three. 600px of margin is roughly half a viewport: far
   *  enough ahead that the canvas has drawn its first frame before anyone can
   *  see the slot. */
  const host = useRef<HTMLDivElement>(null);
  /* Starts true, and the observer's job is only ever to turn it off. If
     IntersectionObserver is missing, or never reports — which is exactly what
     one headless build did — the mark still mounts and still spins. Failing
     towards the working logo is the whole point. */
  const [near, setNear] = useState(true);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* Whichever way the canvas goes away — scrolled out of reach, or its context
     taken — the flat mark has to be back before it does, or the slot is empty
     for a frame. */
  useEffect(() => {
    if (near) return;
    setPainted(false);
    setRetired(false);
  }, [near]);

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
    <div ref={host} className={className} style={{ display: "grid" }}>
      {/* Painted with the first paint, before a byte of three.js has run. */}
      {!retired && (
        <QMark
          scale={scale}
          className="h-full w-full"
          style={{ gridArea: STACKED, opacity: painted ? 0 : 1, transition: FADE }}
        />
      )}

      {mounted && near && (
        <Q3DCanvasScene
          scale={scale}
          withBackdrop={withBackdrop}
          spinAxisTiltDeg={spinAxisTiltDeg}
          spinDirection={spinDirection}
          className="h-full w-full"
          style={{ gridArea: STACKED, opacity: painted ? 1 : 0, transition: FADE }}
          onPainted={() => setPainted(true)}
          /* Back to the flat mark rather than a blank box. The canvas stays
             mounted — the browser may hand the context back, and if it does
             the scene redraws and fades in again on its own. */
          onContextLost={() => {
            setPainted(false);
            setRetired(false);
          }}
        />
      )}
    </div>
  );
}
