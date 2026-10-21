"use client";

import React, { useState } from "react";
import { Camera, Check, ChevronRight, FileText, Loader2, Pencil, Terminal, X } from "lucide-react";

export type ActionState = "running" | "done" | "error";

const ICONS = {
  read: FileText,
  run: Terminal,
  write: Pencil,
  snapshot: Camera,
} as const;

/* One tool event as one quiet line: icon, verb, target. A spinner while it
   runs, a check when done, red when it failed. Tap to see what came back —
   or, when `onOpen` is given, to open it in the artifact panel instead. */
export default function ActionRow({
  kind,
  verb,
  target,
  state,
  detail,
  onOpen,
  children,
}: {
  kind: keyof typeof ICONS;
  verb: string;
  target?: string;
  state: ActionState;
  /** What the tool returned, shown when the row is expanded. */
  detail?: string;
  onOpen?: () => void;
  /** Anything drawn under the line regardless — a screenshot thumbnail. */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[kind];
  const expandable = Boolean(onOpen || detail);

  return (
    <div className="min-w-0">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => (onOpen ? onOpen() : setOpen((value) => !value))}
        aria-expanded={onOpen ? undefined : open}
        className={`flex w-full min-w-0 items-center gap-2 py-1 text-left text-[13.5px] ${
          state === "error" ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
        } ${expandable ? "hover:text-zinc-800 dark:hover:text-zinc-200" : "cursor-default"}`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {verb}
          {target ? <span className="font-mono text-[12.5px]"> {target}</span> : null}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 pl-2">
          {state === "running" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Running" />
          ) : state === "error" ? (
            <X className="h-3.5 w-3.5" aria-label="Failed" />
          ) : (
            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-label="Done" />
          )}
          {expandable && <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />}
        </span>
      </button>
      {open && detail && (
        <pre className="mb-2 mt-1 max-h-60 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-100 p-2.5 font-mono text-[12px] leading-5 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {detail}
        </pre>
      )}
      {children}
    </div>
  );
}
