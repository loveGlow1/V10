"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { placeAnchored, type PanelAlign, type PanelSide } from "./anchoredPlacement";

/* A panel hung off a control that always fits on the screen.
 *
 * ── What was wrong with `absolute` ────────────────────────────────────────
 *
 * Every menu in this app was an absolutely-positioned box: `top-full` under
 * its button, or `bottom-full` above it. CSS places those boxes without ever
 * asking whether there is room, and two bugs came straight out of that.
 *
 * The model list opens upward out of the composer. It is taller than the space
 * above the composer, so its top ran up behind the header and the first model
 * in the list could not be read — and no amount of scrolling brought it back,
 * because the page had not grown; the box was simply drawn where it did not
 * fit.
 *
 * The row menu opens downward. On the last row of the page there is nothing
 * below it, so Delete rendered past the end of the document — visible to the
 * layout engine, unreachable by a person, and the page would not scroll to it
 * because a positioned box does not extend the scroll area of an ancestor that
 * is not scrolling.
 *
 * Both are the same bug, and neither can be fixed by choosing a better fixed
 * direction: whichever one is right for a control at the top of the screen is
 * wrong for the same control at the bottom.
 *
 * ── What this does instead ────────────────────────────────────────────────
 *
 * Measures, every time it opens and whenever anything moves:
 *
 *   FLIPS   to whichever side of the control has more room, when the preferred
 *           side cannot hold the panel's natural height.
 *   CAPS    its height to the room that side actually has, and scrolls inside
 *           itself for the rest — so a list of twenty models on a short window
 *           is a scrollable panel rather than a clipped one.
 *   CLAMPS  both edges into the viewport, so a right-aligned menu near the
 *           right edge of a phone slides left instead of hanging off it.
 *
 * ── And why it is portalled ───────────────────────────────────────────────
 *
 * A panel that fits the screen is still invisible if an ancestor clips it, and
 * the composer does exactly that — which is why the model popover was already
 * hung off the whole composer rather than off the chip that opens it, as a way
 * around a box that clips what grows out of it. Rendered into the body there is
 * no ancestor left to clip it or to paint over it, and that workaround is no
 * longer load-bearing.
 *
 * The anchor is found rather than passed: a zero-size marker stays behind in
 * the original position, and its `offsetParent` is the nearest positioned
 * ancestor — precisely the box the old `absolute` rules were measured from. So
 * every existing call site keeps the anchor it already had, without threading
 * a ref through five components and getting one of them subtly wrong. */

/* useLayoutEffect measures before the browser paints, which is what keeps the
   panel from being seen in its unplaced position — but React logs a warning
   for it during server rendering, where there is nothing to measure. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function AnchoredPanel({
  open,
  onClose,
  side = "bottom",
  align = "right",
  className = "",
  children,
  ...rest
}: {
  open: boolean;
  /* Passed to close on a press outside. The control itself is excluded, so its
     own toggle is not closed and reopened by one click. Leave it out to keep a
     panel that only closes by other means. */
  onClose?: () => void;
  /** Preferred side. Overridden when the other side has more room. */
  side?: PanelSide;
  /** Which edge of the control the panel lines up with, room permitting. */
  align?: PanelAlign;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const marker = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  /* Off-screen and invisible until measured. It still lays out, so its natural
     height and width can be read; it simply cannot be seen doing it. */
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
    visibility: "hidden",
  });

  const place = useCallback(() => {
    const anchor = marker.current?.offsetParent as HTMLElement | null;
    const element = panel.current;
    if (!anchor || !element) return;

    const { top, left, maxHeight } = placeAnchored({
      anchor: anchor.getBoundingClientRect(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      /* The height the content wants, read past whatever cap is on it now —
         scrollHeight is the content, not the box. */
      natural: element.scrollHeight,
      width: element.offsetWidth,
      side,
      align,
    });

    setStyle({ position: "fixed", top, left, maxHeight, visibility: "visible" });
  }, [side, align]);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    /* Capture, so a scroll inside any pane on the way up is heard — the row
       menus live in lists that scroll independently of the window. */
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);

    /* The panel's own content changes size under it: the row menu swaps its
       items for a rename field and again for a delete confirmation, and each
       one is a different height. Without this it would keep the placement it
       was given for the items it no longer shows. */
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);

    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      observer.disconnect();
    };
  }, [open, place]);

  useEffect(() => {
    if (!open || !onClose) return;
    const close = onClose;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      /* Inside the panel is not outside it — and neither is the control, whose
         own handler is about to toggle this shut. Both matter because the panel
         is portalled: it is no longer a descendant of the control, so a
         `contains` check on the control alone would treat every press inside
         the menu as a press outside it. */
      if (panel.current?.contains(target)) return;
      const anchor = marker.current?.offsetParent as HTMLElement | null;
      if (anchor?.contains(target)) return;
      close();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onClose]);

  /* The marker renders whether the panel is open or not, so the anchor is
     already known by the time it opens. */
  return (
    <>
      <span ref={marker} aria-hidden className="absolute h-0 w-0" />
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            {...rest}
            ref={panel}
            style={style}
            className={`z-[90] overflow-y-auto overscroll-contain ${className}`}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
