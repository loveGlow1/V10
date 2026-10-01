"use client";

/* The visual editor's panel: what the person clicked in the preview, the
 * controls that change it, and the list of changes waiting to be applied.
 *
 * Changes are shown in the preview as they are made (onPreview), stack up
 * with undo and redo, and are applied together. Words, colours, sizes,
 * spacing and pictures go straight into the code — see
 * /api/projects/[id]/visual-edit — with no model and no credits. A request
 * in words ("make this a carousel"), and anything the code route cannot place
 * exactly, goes to the chat as one message naming each element's file and
 * line. */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Redo2, Sparkles, Undo2, X } from "lucide-react";

import { applyClassChange, parseSrc, type ClassGroup } from "@/lib/builder/visual-edit";

import { askChat } from "./visual-ask";

export type Picked = {
  src: string;
  tag: string;
  className: string;
  text: string | null;
  imageSrc: string | null;
  repeated: number;
};

type Entry = {
  src: string;
  tag: string;
  original: { className: string; text: string | null; imageSrc: string | null };
  text?: string;
  classes: Partial<Record<ClassGroup, string>>;
  imageSrc?: string;
  ask?: string;
};

export type PreviewChange = { src: string; className?: string; text?: string; imageSrc?: string };

const COLOUR = /^(?:#|rgb|hsl|oklch|oklab|lab\(|lch\(|color\()/i;

const WEIGHTS = [
  ["font-normal", "Regular"],
  ["font-medium", "Medium"],
  ["font-semibold", "Semibold"],
  ["font-bold", "Bold"],
] as const;
const PADDING = ["p-0", "p-2", "p-4", "p-6", "p-8", "p-12"] as const;
const ALIGN = [
  ["text-left", "Left"],
  ["text-center", "Centre"],
  ["text-right", "Right"],
] as const;
const RADIUS = [
  ["rounded-none", "None"],
  ["rounded-md", "Small"],
  ["rounded-xl", "Large"],
  ["rounded-full", "Full"],
] as const;
const FALLBACK_SIZES = ["text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl"];

function previewOf(entry: Entry): PreviewChange {
  let className = entry.original.className;
  for (const [group, value] of Object.entries(entry.classes)) className = applyClassChange(className, group as ClassGroup, value ?? "");
  return {
    src: entry.src,
    className,
    ...(entry.text !== undefined ? { text: entry.text } : {}),
    ...(entry.imageSrc !== undefined ? { imageSrc: entry.imageSrc } : {}),
  };
}

function hasDirect(entry: Entry): boolean {
  return (
    (entry.text !== undefined && entry.text !== entry.original.text) ||
    Object.keys(entry.classes).length > 0 ||
    (entry.imageSrc !== undefined && entry.imageSrc !== entry.original.imageSrc)
  );
}

function where(src: string): string {
  const at = parseSrc(src);
  return at ? `${at.path} line ${at.line}` : src;
}

/* An entry as words, for the chat when it has to go to the AI. */
function asRequest(entry: Entry, direct: boolean): string {
  const parts: string[] = [];
  if (direct) {
    if (entry.text !== undefined && entry.text !== entry.original.text) parts.push(`change its text to "${entry.text}"`);
    for (const [group, value] of Object.entries(entry.classes)) parts.push(`set its ${group} to \`${value}\``);
    if (entry.imageSrc) parts.push(`use the image ${entry.imageSrc}`);
  }
  if (entry.ask) parts.push(entry.ask);
  const label = entry.original.text ? ` ("${entry.original.text.trim().slice(0, 50)}")` : "";
  return `<${entry.tag}> in ${where(entry.src)}${label}: ${parts.join("; ")}`;
}

export default function VisualEditPanel({
  projectId,
  picked,
  tokens,
  onPreview,
  onApplied,
  onClose,
}: {
  projectId: string;
  picked: Picked | null;
  tokens: Record<string, string>;
  onPreview: (change: PreviewChange) => void;
  onApplied: () => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [past, setPast] = useState<Entry[][]>([]);
  const [future, setFuture] = useState<Entry[][]>([]);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const shown = useRef<Map<string, Entry["original"]>>(new Map());

  /* What the preview shows follows the list: every entry as it would be, and
     anything undone put back as it was. */
  useEffect(() => {
    const now = new Set(entries.map((entry) => entry.src));
    for (const [src, original] of shown.current) {
      if (!now.has(src)) {
        onPreview({ src, className: original.className, ...(original.text !== null ? { text: original.text } : {}), ...(original.imageSrc !== null ? { imageSrc: original.imageSrc } : {}) });
        shown.current.delete(src);
      }
    }
    for (const entry of entries) {
      onPreview(previewOf(entry));
      shown.current.set(entry.src, entry.original);
    }
  }, [entries, onPreview]);

  const colours = useMemo(
    () => Object.entries(tokens).filter(([name, value]) => COLOUR.test(value) && !/^--text-/.test(name)),
    [tokens],
  );
  const sizes = useMemo(() => {
    const named = Object.entries(tokens)
      .filter(([name, value]) => /^--text-/.test(name) && !COLOUR.test(value))
      .map(([name]) => [`text-[length:var(${name})]`, name.replace(/^--text-/, "")] as const);
    return named.length > 0 ? named : FALLBACK_SIZES.map((size) => [size, size.replace("text-", "")] as const);
  }, [tokens]);

  const current: Entry | null = picked
    ? entries.find((entry) => entry.src === picked.src) ?? {
        src: picked.src,
        tag: picked.tag,
        original: { className: picked.className, text: picked.text, imageSrc: picked.imageSrc },
        classes: {},
      }
    : null;

  /* Typing is one step, not one per key: a run of changes with the same key
     (the text of one element) replaces its last step instead of adding one. */
  const lastStep = useRef<string | null>(null);

  function commit(next: Entry[], step: string | null = null) {
    if (step === null || step !== lastStep.current) {
      setPast((list) => [...list.slice(-49), entries]);
      setFuture([]);
    }
    lastStep.current = step;
    setEntries(next);
    setNotice(null);
  }

  function change(update: (entry: Entry) => Entry, step: string | null = null) {
    if (!current) return;
    const updated = update({ ...current, classes: { ...current.classes } });
    const rest = entries.filter((entry) => entry.src !== updated.src);
    const meaningful = hasDirect(updated) || Boolean(updated.ask);
    commit(meaningful ? [...rest, updated] : rest, step);
  }

  const setClass = (group: ClassGroup, value: string) =>
    change((entry) => {
      if (entry.classes[group] === value) delete entry.classes[group];
      else entry.classes[group] = value;
      return entry;
    });

  function undo() {
    lastStep.current = null;
    const previous = past[past.length - 1];
    if (!previous) return;
    setFuture((list) => [entries, ...list]);
    setPast((list) => list.slice(0, -1));
    setEntries(previous);
  }

  function redo() {
    lastStep.current = null;
    const next = future[0];
    if (!next) return;
    setPast((list) => [...list, entries]);
    setFuture((list) => list.slice(1));
    setEntries(next);
  }

  async function apply() {
    if (entries.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    const direct = entries.filter(hasDirect);
    const forAi: string[] = [];
    let saved = 0;
    try {
      if (direct.length > 0) {
        const response = await fetch(`/api/projects/${projectId}/visual-edit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            edits: direct.map((entry) => ({
              src: entry.src,
              tag: entry.tag,
              className: entry.original.className,
              text: entry.original.text ?? undefined,
              change: {
                text: entry.text !== entry.original.text ? entry.text : undefined,
                classes: Object.entries(entry.classes).map(([group, value]) => ({ group, value })),
                imageSrc: entry.imageSrc !== entry.original.imageSrc ? entry.imageSrc : undefined,
              },
            })),
          }),
        });
        const body = (await response.json().catch(() => null)) as
          | { applied?: number; needsAi?: { index: number; reason: string }[]; error?: string }
          | null;
        if (!response.ok) {
          /* Nothing was written, so every change goes to the AI instead. */
          forAi.push(...direct.map((entry) => asRequest(entry, true)));
        } else {
          saved = body?.applied ?? 0;
          for (const miss of body?.needsAi ?? []) {
            const entry = direct[miss.index];
            if (entry) forAi.push(asRequest(entry, true));
          }
        }
      }
      for (const entry of entries) {
        if (entry.ask && !forAi.some((line) => line.startsWith(`<${entry.tag}> in ${where(entry.src)}`))) {
          forAi.push(asRequest(entry, false));
        }
      }
      if (forAi.length > 0) {
        askChat({
          projectId,
          text: `Change these exact elements (picked in the visual editor):\n${forAi.map((line, i) => `${i + 1}. ${line}`).join("\n")}`,
        });
      }
      shown.current.clear();
      setEntries([]);
      setPast([]);
      setFuture([]);
      setNotice({
        tone: "ok",
        text: [
          saved > 0 ? `Saved ${saved} change${saved === 1 ? "" : "s"} — no credits used.` : "",
          forAi.length > 0 ? `Sent ${forAi.length} to the AI in the chat.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
      if (saved > 0) onApplied();
    } catch {
      setNotice({ tone: "error", text: "The changes could not be sent. Nothing was saved — try again." });
    } finally {
      setBusy(false);
    }
  }

  const chip = (active: boolean) =>
    `rounded-md border px-2 py-1 text-[12px] transition-colors ${
      active ? "border-accent bg-accent/10 text-ink" : "border-line/[0.1] text-muted hover:bg-layer/[0.06]"
    }`;

  return (
    <aside className="flex w-full shrink-0 flex-col overflow-hidden border-l border-line/[0.06] bg-layer/[0.02] md:w-72">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line/[0.06] px-2.5">
        <p className="flex-1 text-[12px] font-medium text-ink">Visual edit</p>
        <button onClick={undo} disabled={past.length === 0} aria-label="Undo" title="Undo" className="rounded-md p-1 text-ink hover:bg-layer/[0.06] disabled:opacity-30">
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button onClick={redo} disabled={future.length === 0} aria-label="Redo" title="Redo" className="rounded-md p-1 text-ink hover:bg-layer/[0.06] disabled:opacity-30">
          <Redo2 className="h-3.5 w-3.5" />
        </button>
        <button onClick={onClose} aria-label="Close the visual editor" title="Close" className="rounded-md p-1 text-ink hover:bg-layer/[0.06]">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {!current ? (
          <p className="text-[12px] leading-relaxed text-muted">
            Click anything in the preview to change it. Words, colours, sizes and spacing are saved straight into your
            code — no credits. Bigger changes go to the AI.
          </p>
        ) : (
          <>
            <div>
              <p className="text-[12px] font-medium text-ink">
                &lt;{current.tag}&gt; <span className="font-normal text-muted">· {where(current.src)}</span>
              </p>
              {picked && picked.repeated > 1 ? (
                <p className="mt-1 text-[11px] leading-relaxed text-amber-300">
                  Used {picked.repeated} times on this page — a change here changes every one.
                </p>
              ) : null}
            </div>

            {current.original.text !== null ? (
              <label className="block">
                <span className="text-[11px] uppercase tracking-wide text-muted">Text</span>
                <textarea
                  value={current.text ?? current.original.text}
                  onChange={(event) => {
                    const value = event.target.value;
                    change((entry) => ({ ...entry, text: value }), `text:${current.src}`);
                  }}
                  rows={3}
                  className="mt-1 w-full resize-y rounded-md border border-line/[0.1] bg-transparent px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                />
              </label>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted">
                This text comes from your code or database, so describe the change below and the AI will make it.
              </p>
            )}

            {current.tag === "img" ? (
              <label className="block">
                <span className="text-[11px] uppercase tracking-wide text-muted">Image address</span>
                <input
                  key={current.src}
                  defaultValue={current.imageSrc ?? current.original.imageSrc ?? ""}
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (value && value !== (current.imageSrc ?? current.original.imageSrc)) change((entry) => ({ ...entry, imageSrc: value }));
                  }}
                  placeholder="https://…"
                  className="mt-1 w-full rounded-md border border-line/[0.1] bg-transparent px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
                />
              </label>
            ) : null}

            {colours.length > 0 ? (
              <>
                <Swatches label="Text colour" colours={colours} active={current.classes.textColor} prefix="text" onPick={(value) => setClass("textColor", value)} />
                <Swatches label="Background" colours={colours} active={current.classes.background} prefix="bg" onPick={(value) => setClass("background", value)} />
              </>
            ) : null}

            <Group label="Size">
              {sizes.map(([value, name]) => (
                <button key={value} onClick={() => setClass("fontSize", value)} className={chip(current.classes.fontSize === value)}>
                  {name}
                </button>
              ))}
            </Group>
            <Group label="Weight">
              {WEIGHTS.map(([value, name]) => (
                <button key={value} onClick={() => setClass("fontWeight", value)} className={chip(current.classes.fontWeight === value)}>
                  {name}
                </button>
              ))}
            </Group>
            <Group label="Align">
              {ALIGN.map(([value, name]) => (
                <button key={value} onClick={() => setClass("align", value)} className={chip(current.classes.align === value)}>
                  {name}
                </button>
              ))}
            </Group>
            <Group label="Padding">
              {PADDING.map((value) => (
                <button key={value} onClick={() => setClass("padding", value)} className={chip(current.classes.padding === value)}>
                  {value.replace("p-", "")}
                </button>
              ))}
            </Group>
            <Group label="Corners">
              {RADIUS.map(([value, name]) => (
                <button key={value} onClick={() => setClass("radius", value)} className={chip(current.classes.radius === value)}>
                  {name}
                </button>
              ))}
            </Group>

            <div>
              <span className="text-[11px] uppercase tracking-wide text-muted">Ask the AI about this</span>
              <textarea
                value={ask}
                onChange={(event) => setAsk(event.target.value)}
                rows={2}
                placeholder="e.g. turn this into a carousel"
                className="mt-1 w-full resize-y rounded-md border border-line/[0.1] bg-transparent px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
              />
              <button
                onClick={() => {
                  const text = ask.trim();
                  if (!text) return;
                  change((entry) => ({ ...entry, ask: text }));
                  setAsk("");
                }}
                disabled={!ask.trim()}
                className="mt-1 inline-flex items-center gap-1 rounded-md border border-line/[0.1] px-2 py-1 text-[12px] text-ink hover:bg-layer/[0.06] disabled:opacity-40"
              >
                <Sparkles className="h-3 w-3" /> Add request
              </button>
              {current.ask ? <p className="mt-1 text-[11px] text-muted">Requested: {current.ask}</p> : null}
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-line/[0.06] p-3">
        {notice ? (
          <p className={`text-[12px] leading-relaxed ${notice.tone === "error" ? "text-red-400" : "text-muted"}`}>{notice.text}</p>
        ) : null}
        <p className="text-[11px] text-muted">
          {entries.length === 0
            ? "No changes yet."
            : `${entries.length} element${entries.length === 1 ? "" : "s"} changed${
                entries.some((entry) => entry.ask) ? " · AI requests use credits like a normal edit" : ""
              }`}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => void apply()}
            disabled={entries.length === 0 || busy}
            className="flex-1 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white transition-opacity disabled:opacity-40"
          >
            {busy ? "Applying…" : "Apply"}
          </button>
          <button
            onClick={() => commit([])}
            disabled={entries.length === 0 || busy}
            className="rounded-lg border border-line/[0.1] px-3 py-2 text-[13px] text-ink hover:bg-layer/[0.06] disabled:opacity-40"
          >
            Discard
          </button>
        </div>
      </div>
    </aside>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <div className="mt-1 flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Swatches({
  label,
  colours,
  active,
  prefix,
  onPick,
}: {
  label: string;
  colours: [string, string][];
  active?: string;
  prefix: "text" | "bg";
  onPick: (value: string) => void;
}) {
  return (
    <div>
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {colours.map(([name, value]) => {
          const cls = `${prefix}-[var(${name})]`;
          return (
            <button
              key={name}
              onClick={() => onPick(cls)}
              title={name.replace(/^--/, "")}
              aria-label={`${label}: ${name.replace(/^--/, "")}`}
              className={`h-6 w-6 rounded-full border ${active === cls ? "border-accent ring-2 ring-accent/50" : "border-line/[0.2]"}`}
              style={{ background: value }}
            />
          );
        })}
      </div>
    </div>
  );
}
