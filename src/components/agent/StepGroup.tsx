"use client";

import React, { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";

/* Two or more tool calls in a row, folded to one line that says what they
   added up to — "Edited 3 files, ran 1 command ›" — and opening to the rows
   themselves. */
export default function StepGroup({
  summary,
  running,
  failed,
  children,
}: {
  summary: string;
  running: boolean;
  failed: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`flex w-full min-w-0 items-center gap-2 py-1 text-left text-[13.5px] ${
          failed ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
        } hover:text-zinc-800 dark:hover:text-zinc-200`}
      >
        <span className="min-w-0 truncate">{summary}</span>
        {running && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-label="Running" />}
        <ChevronRight className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <div className="ml-1.5 border-l border-zinc-200 pl-3 dark:border-zinc-800">{children}</div>}
    </div>
  );
}

/** "Edited 3 files, read 2 files, ran 1 command" for a run of tool calls. */
export function summarise(names: string[]): string {
  const count = (wanted: string[]) => names.filter((name) => wanted.includes(name)).length;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const bits: string[] = [];
  const edited = count(["write_file", "edit_file"]);
  const read = count(["read_file"]);
  const ran = count(["run_command"]);
  const shots = count(["take_snapshot"]);
  if (edited) bits.push(`edited ${plural(edited, "file")}`);
  if (read) bits.push(`read ${plural(read, "file")}`);
  if (ran) bits.push(`ran ${plural(ran, "command")}`);
  if (shots) bits.push(`took ${plural(shots, "screenshot")}`);
  const text = bits.join(", ") || plural(names.length, "step");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
