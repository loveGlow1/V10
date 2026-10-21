"use client";

import React, { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

/* The model's thinking, kept out of the way: one collapsed row that shimmers
   "Thinking…" while it streams and settles to "Thought for 4s ›". Tap to read
   it. The time is measured here while live, and read back from the stored
   part (ms) after a reload. */
export default function ReasoningPart({
  text,
  streaming,
  storedMs,
}: {
  text: string;
  streaming: boolean;
  storedMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const started = useRef<number | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);

  useEffect(() => {
    if (streaming && started.current === null) started.current = Date.now();
    if (!streaming && started.current !== null && measured === null) setMeasured(Date.now() - started.current);
  }, [streaming, measured]);

  const ms = storedMs ?? measured;
  const seconds = ms ? Math.max(1, Math.round(ms / 1000)) : null;

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group flex items-center gap-1 py-1 text-[13.5px] text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {streaming ? (
          <>
            {/* Scoped here rather than in the global stylesheet: this row is
                the only thing that shimmers. Reduced motion holds it still. */}
            <style>{`@keyframes qs-agent-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}@media (prefers-reduced-motion: reduce){.qs-agent-shimmer{animation:none!important}}`}</style>
            <span
              className="qs-agent-shimmer bg-gradient-to-r from-zinc-400 via-zinc-800 to-zinc-400 bg-[length:200%_100%] bg-clip-text text-transparent dark:from-zinc-500 dark:via-zinc-100 dark:to-zinc-500"
              style={{ animation: "qs-agent-shimmer 1.8s linear infinite" }}
            >
              Thinking…
            </span>
          </>
        ) : (
          <span>{seconds ? `Thought for ${seconds}s` : "Thought"}</span>
        )}
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && text && (
        <div className="mb-2 ml-1 max-w-prose whitespace-pre-wrap break-words border-l-2 border-zinc-200 pl-3 text-[13.5px] leading-6 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {text}
        </div>
      )}
    </div>
  );
}
