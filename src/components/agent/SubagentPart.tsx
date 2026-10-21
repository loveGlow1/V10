"use client";

import React from "react";
import { Bot, ChevronRight } from "lucide-react";

/* Another agent's whole run, folded to one line: "Deployment agent finished —
   site is live ›". Tap to read its transcript in the artifact panel. */
export default function SubagentPart({
  name,
  summary,
  onOpen,
}: {
  name: string;
  summary: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 items-center gap-2 py-1 text-left text-[13.5px] text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
    >
      <Bot className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {name} finished{summary ? ` — ${summary}` : ""}
      </span>
      <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" />
    </button>
  );
}
