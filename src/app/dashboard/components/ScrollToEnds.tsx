"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

/* Both ends of a long scroll, one press away.
 *
 * The dashboard runs composer → chips → projects → footer, the Projects page is
 * however many projects there are, and a build conversation is as long as the
 * build was. All three are surfaces you read down and then want to leave from
 * the other end, and a flick of the wheel is a poor way to cross a page.
 *
 * One component for the window and for a scroll container both, because the
 * chat thread scrolls inside its own box while the pages scroll the window, and
 * the arithmetic is the same either way — only where you read it from differs.
 *
 * It shows only what is useful: nothing at all until there is real distance to
 * cover, the up arrow only once you have left the top, the down arrow only
 * while there is further to go. A control that is always there in both
 * directions is a control that is wrong half the time.
 *
 * Deliberately not in the corner on its own: SupportChat already holds the
 * bottom right, so callers place this above it, and it is one pill of two
 * halves rather than two more circles stacked in the same corner. */

/* Below this much overflow the page is a flick away from either end and a
   control to do it for you is furniture. Roughly a third of a phone screen. */
const MIN_OVERFLOW = 320;

/* A list can settle a pixel or two off an edge on its own, and that still
   counts as being at it. */
const EDGE = 24;

export default function ScrollToEnds({
  target,
  className = "",
  downLabel = "Jump to bottom",
}: {
  /** The element that scrolls. Omit for the window. */
  target?: React.RefObject<HTMLElement | null>;
  /** Where the pill sits. Each surface has a different corner to keep clear. */
  className?: string;
  /** "Jump to latest" reads better on a conversation than "bottom". */
  downLabel?: string;
}) {
  const [up, setUp] = useState(false);
  const [down, setDown] = useState(false);
  /* Held so the handlers below do not need `target` in their dependencies and
     re-subscribe on every render the parent happens to do. */
  const scroller = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = target?.current ?? null;
    scroller.current = el;

    const read = () => {
      const top = el ? el.scrollTop : window.scrollY;
      const full = el ? el.scrollHeight : document.documentElement.scrollHeight;
      const view = el ? el.clientHeight : window.innerHeight;
      const room = full - view;

      if (room < MIN_OVERFLOW) {
        setUp(false);
        setDown(false);
        return;
      }
      setUp(top > EDGE);
      setDown(room - top > EDGE);
    };

    read();

    const source: HTMLElement | Window = el ?? window;
    source.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);

    /* Scrolling is not the only thing that changes the answer. A reply landing
       in the thread or a filter emptying the list changes how far there is to
       go without anybody scrolling, and the arrows have to follow. */
    const resize = new ResizeObserver(read);
    resize.observe(el ?? document.documentElement);

    const mutate = new MutationObserver(read);
    if (el) mutate.observe(el, { childList: true, subtree: true });

    return () => {
      source.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
      resize.disconnect();
      mutate.disconnect();
    };
  }, [target]);

  const go = useCallback((to: "top" | "bottom") => {
    const el = scroller.current;
    /* Someone who has asked for less motion has asked for this too: crossing a
       long page under a smooth scroll is the largest movement on it. */
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";

    if (el) {
      el.scrollTo({ top: to === "top" ? 0 : el.scrollHeight, behavior });
      return;
    }
    window.scrollTo({
      top: to === "top" ? 0 : document.documentElement.scrollHeight,
      behavior,
    });
  }, []);

  if (!up && !down) return null;

  const half =
    "flex h-9 w-9 items-center justify-center text-muted transition-colors hover:bg-layer/[0.08] hover:text-ink";

  return (
    <div
      className={`z-[55] flex w-9 flex-col overflow-hidden rounded-full border border-line/[0.09] bg-panel/[0.92] shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-xl ${className}`}
    >
      {up && (
        <button type="button" onClick={() => go("top")} aria-label="Back to top" className={half}>
          <ArrowUp className="h-4 w-4" />
        </button>
      )}
      {/* Only between two arrows. A rule under a lone button is a line to
          nowhere. */}
      {up && down && <span className="mx-auto h-px w-5 bg-line/[0.09]" />}
      {down && (
        <button type="button" onClick={() => go("bottom")} aria-label={downLabel} className={half}>
          <ArrowDown className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
