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

    const sync = () => {
      const overlap = window.innerHeight - (viewport.height + viewport.offsetTop);
      document.documentElement.style.setProperty(
        "--keyboard-inset",
        `${Math.max(0, Math.round(overlap))}px`,
      );
    };

    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    sync();
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, []);
}
