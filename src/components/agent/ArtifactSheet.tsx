"use client";

import React, { useEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";

export type Artifact =
  | { kind: "file"; path: string; content: string }
  | { kind: "diff"; path: string; find: string; replace: string }
  | { kind: "subagent"; name: string; summary: string; childSessionId: string };

/* What a collapsed line opens: a whole file, an edit as its diff, or another
   agent's run. A bottom sheet on a phone — 85% of the screen, a handle to
   drag, swiped down to close — and a panel down the right from lg up, 45%
   wide, with the conversation still beside it. */
export default function ArtifactSheet({ artifact, onClose }: { artifact: Artifact | null; onClose: () => void }) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    if (!artifact) return;
    setDrag(0);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [artifact, onClose]);

  if (!artifact) return null;

  const title = artifact.kind === "subagent" ? artifact.name : artifact.path;

  const grab = {
    onPointerDown: (event: React.PointerEvent) => {
      start.current = event.clientY;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (start.current !== null) setDrag(Math.max(0, event.clientY - start.current));
    },
    onPointerUp: () => {
      if (drag > 120) onClose();
      else setDrag(0);
      start.current = null;
    },
  };

  return (
    <>
      {/* The thread stays usable beside the panel on a desktop; on a phone the
          sheet is modal and a tap above it closes it. */}
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 z-[90] bg-black/40 lg:hidden" />
      <aside
        role="dialog"
        aria-label={title}
        style={{ transform: drag ? `translateY(${drag}px)` : undefined, transition: start.current === null ? "transform 180ms ease-out" : "none" }}
        className="fixed inset-x-0 bottom-0 z-[95] flex h-[85vh] flex-col rounded-t-2xl border-t border-zinc-200 bg-white shadow-[0_-16px_48px_rgba(0,0,0,0.25)] pb-[env(safe-area-inset-bottom)] dark:border-zinc-800 dark:bg-zinc-950 lg:inset-y-0 lg:left-auto lg:right-0 lg:h-full lg:w-[45%] lg:rounded-none lg:border-l lg:border-t-0 lg:pb-0 lg:shadow-none"
      >
        <div {...grab} className="flex shrink-0 touch-none cursor-grab justify-center pb-1 pt-2.5 lg:hidden">
          <span className="h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        </div>
        <header className="flex min-w-0 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-zinc-800 dark:text-zinc-200">{title}</span>
          {artifact.kind === "diff" && <span className="shrink-0 text-[12px] text-zinc-500">Edit</span>}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          {artifact.kind === "file" && <Code text={artifact.content} />}
          {artifact.kind === "diff" && <Diff find={artifact.find} replace={artifact.replace} />}
          {artifact.kind === "subagent" && (
            <div className="space-y-3 p-4 text-[14.5px] leading-6 text-zinc-700 dark:text-zinc-300">
              <p>{artifact.summary || "This agent finished without a summary."}</p>
              <a
                href={`/session/${artifact.childSessionId}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-[13px] hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                Open its full transcript <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function Code({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <pre className="min-w-max p-3 font-mono text-[12.5px] leading-5 text-zinc-800 dark:text-zinc-200">
      {lines.map((line, index) => (
        <div key={index} className="flex">
          <span className="w-10 shrink-0 select-none pr-3 text-right text-zinc-400 dark:text-zinc-600">{index + 1}</span>
          <span>{line || " "}</span>
        </div>
      ))}
    </pre>
  );
}

function Diff({ find, replace }: { find: string; replace: string }) {
  return (
    <pre className="min-w-max p-3 font-mono text-[12.5px] leading-5">
      {find.split("\n").map((line, index) => (
        <div key={`-${index}`} className="bg-red-50 px-2 text-red-800 dark:bg-red-950/40 dark:text-red-300">
          − {line || " "}
        </div>
      ))}
      {replace.split("\n").map((line, index) => (
        <div key={`+${index}`} className="bg-emerald-50 px-2 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          + {line || " "}
        </div>
      ))}
    </pre>
  );
}
