"use client";

import React, { useEffect, useRef, useState } from "react";

import { avatarFor } from "../projectColours";

/* A project tile that shows the page, rather than a coloured square standing in
 * for one.
 *
 * It is the real document, rendered at a desktop width in a frame and scaled
 * down to tile size — not a screenshot. There is no screenshotting service
 * behind this and none is needed: the page is already a self-contained
 * document, so the browser can draw it small as easily as large, and a
 * thumbnail made this way is never stale.
 *
 * Rendered at THUMB_WIDTH and scaled rather than rendered small: a page laid
 * out for 110 pixels would take its mobile breakpoint and show a stack of
 * full-width blocks, which looks nothing like the app. Scaling a wide render is
 * what makes the tile recognisably the same page someone will open.
 *
 * Sandboxed without allow-same-origin, exactly as the full preview is: this is
 * a document a model wrote from someone's prompt. Scripts run — they have to,
 * since Tailwind's CDN is what applies the styling — but in an opaque origin,
 * with no reach into the session or the API routes on this domain. Pointer
 * events are off, so it is a picture rather than a page you can click into. */

/* The width the page is laid out at before scaling: a desktop viewport, so the
   tile shows the desktop design. */
const THUMB_WIDTH = 1280;

export default function PageThumbnail({
  projectId,
  hasPage,
  name,
  className = "h-[70px] w-[110px] rounded-lg",
}: {
  projectId: string;
  /** Whether a build has stored a page. False means never render a frame. */
  hasPage: boolean;
  name: string;
  /** The tile's box. Width and height are read back to size the render. */
  className?: string;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  /* Off screen until it is on screen. A list of twenty apps would otherwise
     fetch twenty documents and lay out twenty pages before anyone scrolled to
     them. */
  const [near, setNear] = useState(false);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const element = boxRef.current;
    if (!element || !hasPage) return;

    const measure = () =>
      setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      /* A little ahead of the fold, so a tile is drawn by the time it arrives
         rather than blinking in under the reader. */
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasPage]);

  useEffect(() => {
    if (!near || !hasPage) return;
    let cancelled = false;

    /* By path, not by the stored preview_url: that address is absolute and
       names the canonical site, which is not always the host being browsed.
       Same origin is what carries the session this read needs. */
    void fetch(`/preview/${projectId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.text() : null))
      .then((text) => {
        if (!cancelled) setHtml(text);
      })
      .catch(() => {
        /* A tile that cannot be drawn falls back to the coloured square, which
           is what it was before. Nothing to report. */
      });

    return () => {
      cancelled = true;
    };
  }, [near, hasPage, projectId]);

  const scale = box ? box.width / THUMB_WIDTH : 0;

  return (
    <span
      ref={boxRef}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br text-lg font-semibold text-ink/90 ${avatarFor(
        projectId,
      )} ${className}`}
    >
      {/* Under the frame, so it is what shows while the page loads and what
          remains if there is no page at all. */}
      {name.charAt(0).toUpperCase()}

      {html && box ? (
        <iframe
          srcDoc={html}
          title={`${name} preview`}
          aria-hidden
          tabIndex={-1}
          sandbox="allow-scripts"
          /* Laid out wide, then scaled into the tile. The height is the tile's
             own, divided back out, so the crop is the top of the page at the
             tile's aspect ratio rather than a squashed whole document. */
          style={{
            width: THUMB_WIDTH,
            height: box.height / scale,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
          className="pointer-events-none absolute left-0 top-0 border-0 bg-white"
        />
      ) : null}
    </span>
  );
}
