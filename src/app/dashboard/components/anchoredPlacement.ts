/* Where an anchored panel goes, as arithmetic.
 *
 * Split out of AnchoredPanel so it can be checked without a browser. The React
 * side reads the DOM — a bounding box, a viewport, a scrollHeight — and this
 * decides what to do with those numbers. Nothing here touches the DOM, so
 * check:anchored runs the shipped function rather than a copy of it, which
 * matters: the two bugs this replaced were both cases of a placement that
 * looked right in the one window it was written in.
 *
 * The three rules, in the order they apply:
 *
 *   FLIP   to the other side when the preferred one cannot hold the panel and
 *          the other side is roomier. Only then — a panel that changes sides
 *          for a few pixels jumps around as the page scrolls.
 *   CAP    the height to the room that side has, and let the panel scroll the
 *          rest. This is what stops a list of twenty models being taller than
 *          the window it opens in.
 *   CLAMP  both axes into the viewport, so the panel can never be placed where
 *          it cannot be read: not above the top edge, not past the bottom, not
 *          off either side.
 */

export type PanelSide = "top" | "bottom";
export type PanelAlign = "left" | "right";

export type Box = { top: number; bottom: number; left: number; right: number };

export type Placement = {
  top: number;
  left: number;
  /** What the panel may grow to. It scrolls past this. */
  maxHeight: number;
  /** Which side it ended up on, which is not always the side asked for. */
  side: PanelSide;
};

/** Between the control and the panel. */
export const GAP = 8;
/** The closest the panel may come to any edge of the screen. */
export const MARGIN = 12;

export function placeAnchored({
  anchor,
  viewport,
  natural,
  width,
  side = "bottom",
  align = "right",
}: {
  /** The control's box, in viewport coordinates. */
  anchor: Box;
  viewport: { width: number; height: number };
  /** The height the panel's content wants, uncapped. */
  natural: number;
  /** The panel's measured width. */
  width: number;
  side?: PanelSide;
  align?: PanelAlign;
}): Placement {
  const above = Math.max(0, anchor.top - GAP - MARGIN);
  const below = Math.max(0, viewport.height - anchor.bottom - GAP - MARGIN);

  const preferred = side === "top" ? above : below;
  const other = side === "top" ? below : above;
  const flip = natural > preferred && other > preferred;
  const resolved: PanelSide = flip ? (side === "top" ? "bottom" : "top") : side;

  const room = resolved === "top" ? above : below;
  const height = Math.min(natural, room);

  /* Clamped on both ends rather than one. Opening upward, the panel must not
     start above the top margin; opening downward, it must not finish below the
     bottom one — and a window short enough that neither is satisfiable gets the
     top margin, because a panel whose head is on screen can be scrolled and one
     whose head is above it cannot. */
  const top =
    resolved === "top"
      ? Math.max(MARGIN, anchor.top - GAP - height)
      : Math.min(anchor.bottom + GAP, Math.max(MARGIN, viewport.height - MARGIN - height));

  const wanted = align === "right" ? anchor.right - width : anchor.left;
  const left = Math.min(
    Math.max(MARGIN, wanted),
    Math.max(MARGIN, viewport.width - width - MARGIN),
  );

  return { top, left, maxHeight: room, side: resolved };
}
