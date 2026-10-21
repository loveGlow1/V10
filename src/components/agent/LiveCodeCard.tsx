"use client";

import React, { useEffect, useRef } from "react";
import { ChevronRight, Loader2, X } from "lucide-react";

/* A file being written, shown as it is written.
 *
 * While the tool's input streams in, a small dark code window titled
 * "Writing {path}" fills line by line and follows the end, held to a fixed
 * height so the thread does not jump. Once written it folds to one line —
 * "Created app/page.tsx · +42 ›" or "Edited … · +3 −1 ›" — that opens the
 * whole file, or the change, in the artifact panel. */
export default function LiveCodeCard({
  name,
  state,
  input,
  output,
  error,
  onOpen,
}: {
  name: "write_file" | "edit_file";
  state: "input-streaming" | "running" | "done" | "error";
  input: { path?: string; content?: string; find?: string; replace?: string } | undefined;
  output?: { path?: string; lines?: number; created?: boolean; added?: number; removed?: number };
  error?: string;
  onOpen: () => void;
}) {
  const codeRef = useRef<HTMLPreElement>(null);
  const path = output?.path ?? input?.path ?? "";
  const body = name === "write_file" ? (input?.content ?? "") : (input?.replace ?? "");
  const live = state === "input-streaming" || state === "running";

  /* Follow the end while it streams, the way a terminal does. */
  useEffect(() => {
    const code = codeRef.current;
    if (live && code) code.scrollTop = code.scrollHeight;
  }, [body, live]);

  if (live) {
    return (
      <div className="my-1.5 min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950 dark:border-zinc-800">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5 text-[12.5px] text-zinc-300">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" />
          <span className="min-w-0 truncate">
            {name === "write_file" ? "Writing" : "Editing"} <span className="font-mono">{path || "…"}</span>
          </span>
        </div>
        <pre
          ref={codeRef}
          className="max-h-40 overflow-auto px-3 py-2 font-mono text-[12px] leading-5 text-zinc-100 [scrollbar-width:thin]"
        >
          {body || " "}
        </pre>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex min-w-0 items-center gap-2 py-1 text-[13.5px] text-red-600 dark:text-red-400">
        <X className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          Could not {name === "write_file" ? "write" : "edit"} <span className="font-mono text-[12.5px]">{path}</span>
          {error ? ` — ${error}` : ""}
        </span>
      </div>
    );
  }

  const summary =
    name === "write_file"
      ? `${output?.created === false ? "Wrote" : "Created"}`
      : "Edited";
  const counts =
    name === "write_file"
      ? `+${output?.lines ?? 0}`
      : `+${output?.added ?? 0} −${output?.removed ?? 0}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 items-center gap-2 py-1 text-left text-[13.5px] text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
    >
      <span className="min-w-0 truncate">
        {summary} <span className="font-mono text-[12.5px]">{path}</span>
        <span className="text-zinc-400 dark:text-zinc-500"> · </span>
        <span className="text-emerald-600 dark:text-emerald-400">{counts.split(" ")[0]}</span>
        {counts.includes(" ") && <span className="text-red-500 dark:text-red-400"> {counts.split(" ")[1]}</span>}
      </span>
      <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" />
    </button>
  );
}
