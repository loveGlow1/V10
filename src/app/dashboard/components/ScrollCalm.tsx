"use client";

import { useEffect } from "react";

/* While the page is moving, the decoration holds still.
 *
 * The composer's edge light redraws a gradient and re-blurs its halo every
 * frame, and the wordmark's shimmer sweeps a gradient across text. Each is
 * cheap alone, and each is paint work competing with the scroll for the same
 * frames on a phone. So a scroll — of the page or of anything in it — marks
 * the root `qs-scrolling`, the CSS in globals.css pauses those animations on
 * the frame they are on, and a beat after the last scroll event they carry
 * on from there. Nothing jumps: paused, not reset. */
const SETTLE_MS = 160;

export default function ScrollCalm() {
  useEffect(() => {
    const root = document.documentElement;
    let timer = 0;
    const onScroll = () => {
      if (!timer) root.classList.add("qs-scrolling");
      else window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = 0;
        root.classList.remove("qs-scrolling");
      }, SETTLE_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.clearTimeout(timer);
      root.classList.remove("qs-scrolling");
    };
  }, []);
  return null;
}
