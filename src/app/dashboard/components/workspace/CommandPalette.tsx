"use client";

/* The command palette and Go to File, as VS Code draws them: a box at the top
 * of the window, a list under it narrowed as you type, arrows to move, Enter
 * to run. One component for both — they differ only in what they list. */

import React, { useEffect, useMemo, useRef, useState } from "react";

export type PaletteItem = {
  id: string;
  label: string;
  /** Shown dimmed after the label: a folder, a category. */
  detail?: string;
  /** Shown on the right: the shortcut. */
  keys?: string;
  icon?: React.ReactNode;
  run: () => void;
};

/* Letters in order, anywhere — "cmpt" finds "components/Stats.tsx". Earlier
   and tighter matches rank first. */
function score(text: string, query: string): number {
  if (!query) return 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return direct;
  let at = -1;
  let gaps = 0;
  for (const char of needle) {
    const next = haystack.indexOf(char, at + 1);
    if (next < 0) return -1;
    gaps += next - at - 1;
    at = next;
  }
  return 100 + gaps;
}

export default function CommandPalette({
  open,
  placeholder,
  prefix = "",
  items,
  onClose,
}: {
  open: boolean;
  placeholder: string;
  /** Typed ahead of the query, as VS Code shows ">" for commands. */
  prefix?: string;
  items: PaletteItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim();
    if (!q) return items.slice(0, 200);
    return items
      .map((item) => ({ item, rank: score(`${item.label} ${item.detail ?? ""}`, q) }))
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 200)
      .map((entry) => entry.item);
  }, [items, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    onClose();
    window.setTimeout(item.run, 0);
  }

  return (
    <div className="fixed inset-0 z-50" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={placeholder}
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute left-1/2 top-[44px] w-[min(600px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[8px] border border-[var(--vs-border)] bg-[var(--vs-side)] shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
      >
        <div className="p-1.5">
          <div className="flex h-[28px] items-center gap-1 rounded-[4px] border border-[var(--vs-accent)] bg-[var(--vs-input)] px-2 text-[13px]">
            {prefix ? <span className="text-[var(--vs-muted)]">{prefix}</span> : null}
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onClose();
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setIndex((i) => Math.min(i + 1, shown.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setIndex((i) => Math.max(i - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  choose(shown[index]);
                }
              }}
              placeholder={placeholder}
              aria-label={placeholder}
              className="min-w-0 flex-1 bg-transparent text-[var(--vs-text)] outline-none placeholder:text-[var(--vs-faint)]"
            />
          </div>
        </div>
        <div ref={listRef} role="listbox" className="max-h-[min(420px,60vh)] overflow-y-auto pb-1.5">
          {shown.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-[var(--vs-muted)]">No matching results</p>
          ) : (
            shown.map((item, i) => (
              <button
                key={item.id}
                data-index={i}
                role="option"
                aria-selected={i === index}
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(item)}
                className={`flex h-[24px] w-full items-center gap-2 px-3 text-left text-[13px] ${
                  i === index ? "bg-[var(--vs-select)] text-[var(--vs-text)]" : "text-[var(--vs-text)]"
                }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
                {item.detail ? <span className="truncate text-[12px] text-[var(--vs-faint)]">{item.detail}</span> : null}
                {item.keys ? (
                  <span className="ml-auto shrink-0 rounded-[3px] border border-[var(--vs-border)] px-1 text-[11px] text-[var(--vs-muted)]">
                    {item.keys}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
