"use client";

import { useEffect } from "react";

/* Holds the page still while something is open over it.
 *
 * Without this a drag or a wheel that runs past the end of a sheet or dialog
 * scrolls the page behind it, which on a phone reads as the whole screen
 * sliding under your finger. `overflow: hidden` on the body alone is ignored by
 * iOS Safari, so the body is pinned with `position: fixed` at its current
 * offset and put back at the same scroll position when released — the pattern
 * Sidebar has always used.
 *
 * Counted, so two layers open at once (a dialog, then a sheet over it) do not
 * fight: the first to lock records the page, the last to unlock restores it. */
let holders = 0;
let saved: { scrollY: number; position: string; top: string; left: string; right: string; overflow: string } | null =
  null;

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    const { body } = document;
    if (holders === 0) {
      saved = {
        scrollY: window.scrollY,
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        overflow: body.style.overflow,
      };
      body.style.position = "fixed";
      body.style.top = `-${saved.scrollY}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.overflow = "hidden";
    }
    holders += 1;

    return () => {
      holders -= 1;
      if (holders > 0 || !saved) return;
      body.style.position = saved.position;
      body.style.top = saved.top;
      body.style.left = saved.left;
      body.style.right = saved.right;
      body.style.overflow = saved.overflow;
      window.scrollTo(0, saved.scrollY);
      saved = null;
    };
  }, [active]);
}
