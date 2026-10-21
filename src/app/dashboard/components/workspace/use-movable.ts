"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/* A visual editor you can put anywhere, the way a notes window is dragged by
 * its title bar: grab the grip, drop it where it suits, and it stays there —
 * through new picks and reloads — until the grip is double-clicked, which puts
 * it back where the editor would place itself.
 *
 * The place is the box's top-left corner inside `within` (the viewport by
 * default; for a box positioned absolutely, its offset parent), kept fully
 * inside it and above an open phone keyboard. While it is pinned the editor
 * no longer asks the page to move out of its way: the person chose the spot. */

export type Pin = { x: number; y: number };

const MARGIN = 8;
const STEP = 16;

function read(key: string): Pin | null {
  try {
    const raw = window.localStorage.getItem(key);
    const pin = raw ? (JSON.parse(raw) as Pin) : null;
    return pin && Number.isFinite(pin.x) && Number.isFinite(pin.y) ? pin : null;
  } catch {
    return null;
  }
}

function write(key: string, pin: Pin | null) {
  try {
    if (pin) window.localStorage.setItem(key, JSON.stringify({ x: Math.round(pin.x), y: Math.round(pin.y) }));
    else window.localStorage.removeItem(key);
  } catch {
    /* Private mode: it is still moved, just not remembered. */
  }
}

/* The area the box lives in, in viewport coordinates — the visible part of it,
   so a phone keyboard counts as the floor. */
function area(box: HTMLElement, absolute: boolean): DOMRect {
  const viewport = window.visualViewport;
  const height = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
  const screen = new DOMRect(0, 0, window.innerWidth, height);
  if (!absolute) return screen;
  const parent = (box.offsetParent as HTMLElement | null) ?? box.parentElement;
  if (!parent) return screen;
  const rect = parent.getBoundingClientRect();
  const bottom = Math.min(rect.bottom, screen.bottom);
  return new DOMRect(rect.left, rect.top, rect.width, Math.max(0, bottom - rect.top));
}

export function useMovable<T extends HTMLElement>(key: string, { absolute = false }: { absolute?: boolean } = {}) {
  const boxRef = useRef<T | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  /* A second tap soon after the first puts it back, on screens that send no
     double-click for a touch. */
  const lastTap = useRef(0);

  useEffect(() => setPin(read(key)), [key]);

  /* Inside the area, whole: a box larger than the area keeps its top-left in. */
  const clamp = useCallback(
    (next: Pin): Pin => {
      const box = boxRef.current;
      if (!box) return next;
      const bounds = area(box, absolute);
      const maxX = Math.max(MARGIN, bounds.width - box.offsetWidth - MARGIN);
      const maxY = Math.max(MARGIN, bounds.height - box.offsetHeight - MARGIN);
      return { x: Math.min(Math.max(next.x, MARGIN), maxX), y: Math.min(Math.max(next.y, MARGIN), maxY) };
    },
    [absolute],
  );

  const place = useCallback(
    (next: Pin | null, remember: boolean) => {
      const kept = next ? clamp(next) : null;
      setPin(kept);
      if (remember) write(key, kept);
    },
    [clamp, key],
  );

  /* The window, the keyboard or the box itself changing size: still whole. */
  useEffect(() => {
    if (!pin) return;
    const box = boxRef.current;
    const settle = () =>
      setPin((current) => {
        if (!current) return current;
        const kept = clamp(current);
        return kept.x === current.x && kept.y === current.y ? current : kept;
      });
    settle();
    const viewport = window.visualViewport;
    window.addEventListener("resize", settle);
    viewport?.addEventListener("resize", settle);
    const observer = box ? new ResizeObserver(settle) : null;
    if (box) observer?.observe(box);
    return () => {
      window.removeEventListener("resize", settle);
      viewport?.removeEventListener("resize", settle);
      observer?.disconnect();
    };
  }, [pin !== null, clamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const box = boxRef.current;
    if (!box || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (event.pointerType !== "mouse") {
      const now = event.timeStamp;
      if (now - lastTap.current < 350) {
        lastTap.current = 0;
        return place(null, true);
      }
      lastTap.current = now;
    }
    const bounds = area(box, absolute);
    const rect = box.getBoundingClientRect();
    drag.current = { id: event.pointerId, dx: event.clientX - (rect.left - bounds.left), dy: event.clientY - (rect.top - bounds.top) };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const now = drag.current;
    if (!now || now.id !== event.pointerId) return;
    place({ x: event.clientX - now.dx, y: event.clientY - now.dy }, false);
  };
  const end = (event: React.PointerEvent<HTMLElement>) => {
    const now = drag.current;
    if (!now || now.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    setPin((current) => {
      write(key, current);
      return current;
    });
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-STEP, 0],
      ArrowRight: [STEP, 0],
      ArrowUp: [0, -STEP],
      ArrowDown: [0, STEP],
    };
    const move = moves[event.key];
    if (event.key === "Escape" || event.key === "Home") {
      event.preventDefault();
      return place(null, true);
    }
    if (!move) return;
    event.preventDefault();
    const box = boxRef.current;
    if (!box) return;
    const bounds = area(box, absolute);
    const rect = box.getBoundingClientRect();
    const from = pin ?? { x: rect.left - bounds.left, y: rect.top - bounds.top };
    place({ x: from.x + move[0], y: from.y + move[1] }, true);
  };

  /* Pinned: the corner where it was put, at the width it had — the box keeps
     its shape; only where it sits changes. */
  const style: React.CSSProperties | undefined = pin
    ? {
        left: pin.x,
        top: pin.y,
        right: "auto",
        bottom: "auto",
        width: boxRef.current ? Math.min(boxRef.current.offsetWidth, window.innerWidth - MARGIN * 2) : undefined,
      }
    : undefined;

  const grip = {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
    onDoubleClick: () => place(null, true),
    onKeyDown,
    "aria-label": "Move the editor — drag it anywhere; double-click to put it back",
    title: "Drag to move · double-click to put back",
    style: { touchAction: "none", cursor: dragging ? "grabbing" : "grab" } as React.CSSProperties,
  };

  return { boxRef, pin, pinned: pin !== null, dragging, style, grip, reset: () => place(null, true) };
}
