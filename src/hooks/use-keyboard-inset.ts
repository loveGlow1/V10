"use client";

import { useEffect } from "react";

/* iOS Safari ignores interactiveWidget: it does not shrink the layout when the keyboard
   opens, it scrolls the visual viewport instead — which leaves anything position:fixed
   sitting behind the keyboard. The overlap between the layout viewport and the visual
   one is the height of the keyboard, published here as a CSS variable so a fixed element
   can lift by it.

   Chrome, where interactiveWidget already resizes the layout, reports no overlap and the
   variable stays 0. */
export function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    /* Written only when it changes, once a frame at most. Safari fires these
       on every step of its toolbar collapsing as the page scrolls, and setting
       a property on the root restyles the whole document each time — a
       hitch per event, for a number that had not moved. */
    let last = -1;
    let frame = 0;
    const write = () => {
      frame = 0;
      const overlap = Math.max(0, Math.round(window.innerHeight - (viewport.height + viewport.offsetTop)));
      if (overlap === last) return;
      last = overlap;
      document.documentElement.style.setProperty("--keyboard-inset", `${overlap}px`);
    };
    const sync = () => {
      if (!frame) frame = requestAnimationFrame(write);
    };

    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    write();
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, []);
}
