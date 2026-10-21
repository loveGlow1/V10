"use client";

import React, { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";

/* The preview, from the session header: a chip that pulses once when a new
   preview or screenshot arrives — the only notice there is; nothing floats
   over the thread — and opens the preview when tapped. */
export default function PreviewChip({
  url,
  version,
  onOpen,
}: {
  /** Where the preview lives, when the session has one. */
  url: string | null;
  /** Goes up by one with each new preview or screenshot. */
  version: number;
  /** Without a URL: what a tap does instead (the latest screenshot). */
  onOpen?: () => void;
}) {
  const [pulse, setPulse] = useState(false);
  const seen = useRef(version);

  useEffect(() => {
    if (version <= seen.current) return;
    seen.current = version;
    setPulse(true);
    const timer = window.setTimeout(() => setPulse(false), 1200);
    return () => window.clearTimeout(timer);
  }, [version]);

  if (!url && !onOpen) return null;

  const className = `relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800`;
  const ring = pulse ? (
    <span aria-hidden className="pointer-events-none absolute inset-0 animate-ping rounded-full border-2 border-emerald-500/70 [animation-iteration-count:1]" />
  ) : null;

  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className={className}>
      {ring}
      <Eye className="h-3.5 w-3.5" /> Preview
    </a>
  ) : (
    <button type="button" onClick={onOpen} className={className}>
      {ring}
      <Eye className="h-3.5 w-3.5" /> Preview
    </button>
  );
}
