"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, RotateCw, X } from "lucide-react";

/* The preview, over the whole screen, on a phone.

   Side by side is a desktop idea: it needs two columns. On a handset the app
   being built deserves the whole viewport, so the preview arrives as a sheet
   over the conversation and leaves again — the chat underneath is never
   unmounted, so nothing typed is lost while the app is being looked at.

   The bar carries the three things you want while looking at a build and
   nowhere else: reload it, open it properly, put it away. */
export default function PreviewSheet({
  open,
  url,
  title,
  onClose,
}: {
  open: boolean;
  /** Already passed through safeHttpUrl by the caller. */
  url: string | null;
  title: string;
  onClose: () => void;
}) {
  /* Bumped by the reload button. It keys the frame, so a reload is a remount
     rather than a same-document navigation — the preview is cross-origin, so
     there is no reaching into it to refresh it any other way. */
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  /* A fresh open, or a reload, is a fresh wait. Without this the second visit
     would show the frame before it had painted anything. */
  useEffect(() => {
    if (open) setLoaded(false);
  }, [open, url, nonce]);

  /* The sheet covers the page, so the page must not scroll underneath it —
     otherwise dragging inside the preview scrolls the conversation behind. */
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          /* Up from the bottom edge, the way a sheet arrives. Eased rather than
             sprung: it covers the screen, and a bounce on something this large
             reads as a wobble. */
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.34 }}
          className="fixed inset-0 z-[70] flex flex-col bg-canvas md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Preview"
        >
          <header className="flex h-[60px] shrink-0 items-center gap-3 px-3 pt-[env(safe-area-inset-top)]">
            <button
              onClick={() => setNonce((value) => value + 1)}
              aria-label="Reload preview"
              disabled={!url}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-layer/[0.08] text-ink transition-colors hover:bg-layer/[0.12] disabled:opacity-30"
            >
              <RotateCw className="h-4 w-4" />
            </button>

            <p className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-ink">
              Preview
            </p>

            {/* Sized and spaced to balance the reload button, so the title sits
                on the centre line rather than near it. */}
            <div className="flex shrink-0 items-center gap-2">
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open preview in a new tab"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-layer/[0.08] text-ink transition-colors hover:bg-layer/[0.12]"
                >
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              )}
              <button
                onClick={onClose}
                aria-label="Close preview"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-layer/[0.08] text-ink transition-colors hover:bg-layer/[0.12]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="relative min-h-0 flex-1">
            {url ? (
              <>
                <iframe
                  key={`${url}:${nonce}`}
                  src={url}
                  title={`${title} preview`}
                  onLoad={() => setLoaded(true)}
                  /* Generated from someone's prompt and served from another
                     origin: scripts and forms, and no same-origin reach back
                     into the dashboard around it. */
                  sandbox="allow-scripts allow-forms allow-popups"
                  className="h-full w-full border-0 bg-white"
                />
                {/* Over the frame rather than instead of it, so the frame is
                    already loading while this is on screen. */}
                <AnimatePresence>
                  {!loaded && (
                    <motion.div
                      initial={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-canvas"
                    >
                      <span className="h-7 w-7 animate-spin rounded-full border-2 border-line/[0.15] border-t-ink" />
                      <p className="text-[14px] text-muted">Loading your app…</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
                <p className="text-[15px] text-ink">Nothing to preview yet</p>
                <p className="text-[13px] leading-relaxed text-muted">
                  Your app appears here the moment a build returns a preview.
                </p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
