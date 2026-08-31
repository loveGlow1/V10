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
 * events are off, so it is a picture rather than a page you can click into.
 *
 * That sandbox is also why this cannot be a real screenshot. Snapshotting the
 * frame from here would mean reading into it, which needs allow-same-origin —
 * and handing a model-written document the session is not worth a thumbnail.
 * So the tile behaves like a still instead: it holds the last drawn page and
 * only redraws when a new build stamps the row.
 *
 * The frame is kept hidden until it has actually painted. It used to be shown
 * the moment its HTML arrived, over a white fill, so every tile flashed a blank
 * page while the document laid out and the CDN applied its styles — worst on
 * the dark pages, which went white and then dark. Now the tile's own colour
 * holds the space with a spinner over it, and the page is faded in once it is
 * there, so nothing white is ever on screen. */

/* The width the page is laid out at before scaling: a desktop viewport, so the
   tile shows the desktop design. */
const THUMB_WIDTH = 1280;

/* The drawn page, kept for the length of the tab.

   Keyed by the build that produced it, so it answers the two questions a
   thumbnail has: show the same thing on the way back, and show something else
   once a build has landed. A row with no stamp yet is keyed "live" and simply
   refetched — that is a page mid-build, which is the one case where holding on
   to what was there would be wrong.

   sessionStorage rather than memory so it survives a reload, and rather than
   localStorage because a page from a previous day is not worth the disk — the
   fetch behind it is one same-origin read.

   Every access is guarded: storage throws outright in some private modes, and
   a quota error on a large page must cost the tile nothing. A miss is always
   survivable, because a miss is just the fetch this had before. */
const CACHE_LIMIT = 256 * 1024;

function cacheKey(projectId: string, stamp?: string | null) {
  return `quickstark:thumb:${projectId}:${stamp ?? "live"}`;
}

function cached(projectId: string, stamp?: string | null): string | null {
  if (typeof window === "undefined") return null;
  /* A page still being built is never served from the cache: the tile should
     follow it, not freeze on the version before it. */
  if (!stamp) return null;
  try {
    return window.sessionStorage.getItem(cacheKey(projectId, stamp));
  } catch {
    return null;
  }
}

function remember(projectId: string, stamp: string | null | undefined, html: string) {
  if (typeof window === "undefined" || !stamp || html.length > CACHE_LIMIT) return;
  try {
    window.sessionStorage.setItem(cacheKey(projectId, stamp), html);
  } catch {
    /* Full, or refused. The tile is already drawn; there is nothing to fix. */
  }
}

export default function PageThumbnail({
  projectId,
  hasPage,
  name,
  stamp,
  className = "h-[70px] w-[110px] rounded-lg",
}: {
  projectId: string;
  /** Whether a build has stored a page. False means never render a frame. */
  hasPage: boolean;
  name: string;
  /** When the page was last written — `projects.last_build_at`. The cache key,
      so a tile is redrawn when a build lands and not otherwise. */
  stamp?: string | null;
  /** The tile's box. Width and height are read back to size the render. */
  className?: string;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  /* Read straight out of the cache on the first render rather than in an
     effect, so a tile that has been drawn before starts with its page already
     in hand — no fetch, and no gap between mounting and having something to
     show. Navigating back to the list is the case this is for. */
  const [html, setHtml] = useState<string | null>(() => cached(projectId, stamp));
  /* Whether the frame has painted. Until it has, the tile shows its own colour
     rather than the frame, which is the whole of the white-flash fix. */
  const [painted, setPainted] = useState(false);
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

  /* A new build means a new page, so the drawn one is dropped and the frame
     goes back behind its cover until the replacement has painted. Without this
     a tile would keep showing the previous page for the rest of the session. */
  useEffect(() => {
    setHtml(cached(projectId, stamp));
    setPainted(false);
  }, [projectId, stamp]);

  useEffect(() => {
    if (!near || !hasPage || html !== null) return;
    let cancelled = false;

    /* By path, not by the stored preview_url: that address is absolute and
       names the canonical site, which is not always the host being browsed.
       Same origin is what carries the session this read needs. */
    void fetch(`/preview/${projectId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.text() : null))
      .then((text) => {
        if (cancelled || text === null) return;
        remember(projectId, stamp, text);
        setHtml(text);
      })
      .catch(() => {
        /* A tile that cannot be drawn falls back to the coloured square, which
           is what it was before. Nothing to report. */
      });

    return () => {
      cancelled = true;
    };
  }, [near, hasPage, projectId, stamp, html]);

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

      {/* Over the initial and under the frame, for the wait only. A tile that
          is going to show a page should say it is fetching one rather than sit
          on a letter that looks like the finished answer. It is small and low
          contrast on purpose: twenty of these in a list is a list that spins. */}
      {hasPage && !painted && (
        <span
          aria-hidden
          className="absolute h-4 w-4 animate-spin rounded-full border-2 border-line/[0.25] border-t-ink/70"
        />
      )}

      {html && box ? (
        <iframe
          srcDoc={html}
          title={`${name} preview`}
          aria-hidden
          tabIndex={-1}
          sandbox="allow-scripts"
          /* `load` fires once the document and its subresources are in, the
             Tailwind CDN script among them. It is not proof that the styles
             have been applied — that happens inside an opaque origin this
             cannot see into — so a frame is given one more paint to settle
             before it is shown. Two frames of delay against a flash of white
             on every tile is a trade worth making, and it is a fade rather
             than a switch so an early reveal reads as arriving rather than
             as a jump. */
          onLoad={() => {
            requestAnimationFrame(() => requestAnimationFrame(() => setPainted(true)));
          }}
          /* Laid out wide, then scaled into the tile. The height is the tile's
             own, divided back out, so the crop is the top of the page at the
             tile's aspect ratio rather than a squashed whole document. */
          style={{
            width: THUMB_WIDTH,
            height: box.height / scale,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
          /* No white fill. An unpainted frame is transparent, so what shows
             through is the tile's own colour — which is the point. The old
             `bg-white` here is what turned every tile into a blank page for as
             long as the document took to style itself. */
          className={`pointer-events-none absolute left-0 top-0 border-0 transition-opacity duration-300 ${
            painted ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
    </span>
  );
}
