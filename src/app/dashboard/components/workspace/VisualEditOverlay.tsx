"use client";

/* The visual editor, the way people already know it from other builders: turn
 * Edit on, click anything in the preview — or several things, like clipping
 * them — and a small "Describe a change…" box opens beside the last one. What is typed goes to the chat as one request naming the
 * element's file and line — charged, stepped and threaded like any edit (see
 * visual-ask.ts) — and the preview reloads when the build lands.
 *
 * Two pieces live here:
 *   VisualEditPrompt   the box beside the selected element (or docked at the
 *                      foot of the frame on a phone)
 *   PreviewToolbar     the floating bar at the bottom of the preview: Edit,
 *                      desktop/phone width, full screen, and tuck it away.
 *
 * The outline and the tag badge on the element itself are drawn inside the
 * frame — see preview/runtime.ts. */

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowUp, ArrowUpLeft, Bold, ChevronDown, ChevronUp, Maximize2, Minimize2, Monitor, MousePointerClick, Smartphone, Type, X } from "lucide-react";

import { parseSrc, type ClassGroup } from "@/lib/builder/visual-edit";

import type { Picked, SaveState } from "./preview-bridge";
import { askChat } from "./visual-ask";

/* Where the element was written, in words the edit path reads. */
function where(src: string): string {
  const at = parseSrc(src);
  return at ? `${at.path} line ${at.line}` : src;
}

/* The messages the chat sends, one per file — an edit changes one file — in
   the opening the build route and the intent classifier already recognise
   (VISUAL_PICK), so each is treated as an edit of exactly these elements
   rather than a fresh request. The same words go with every element. */
export function visualRequests(picks: Picked[], ask: string): string[] {
  const seen = new Set<string>();
  const byFile = new Map<string, string[]>();
  for (const picked of picks) {
    const label = picked.text ? ` ("${picked.text.trim().slice(0, 50)}")` : "";
    const line = `<${picked.tag}> in ${where(picked.src)}${label}: ${ask.trim()}`;
    if (seen.has(line)) continue;
    seen.add(line);
    const file = parseSrc(picked.src)?.path ?? "";
    byFile.set(file, [...(byFile.get(file) ?? []), line]);
  }
  return [...byFile.values()].map(
    (lines) =>
      `Change these exact elements (picked in the visual editor):\n${lines.map((line, i) => `${i + 1}. ${line}`).join("\n")}`,
  );
}

const PROMPT_WIDTH = 340;
const PROMPT_HEIGHT = 44;
const GAP = 8;
const STYLE_PANEL_HEIGHT = 150;

export function VisualEditPrompt(props: {
  projectId: string;
  picked: Picked;
  picks: Picked[];
  docked?: boolean;
  onSent: () => void;
  onCancel: () => void;
  onSelectParent?: () => void;
  onEditText?: () => void;
  onStyle?: StyleChange;
}) {
  return props.docked ? <VisualEditSheet {...props} /> : <FloatingPrompt {...props} />;
}

/* ── Quick styles ────────────────────────────────────────────────────────
   One tap, no AI: the class for that group swapped on what was picked,
   shown at once and saved by hand (preview-bridge applyStyle). Tailwind's
   own scale and palette, so the page keeps one design language. */
export type StyleChange = (group: ClassGroup, value: string, words: string) => void;

const SIZES = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl", "text-4xl", "text-5xl", "text-6xl"];
const SIZE_PX = [12, 14, 16, 18, 20, 24, 30, 36, 48, 60];
const TEXT_COLOURS: [string, string][] = [
  ["text-white", "#ffffff"], ["text-black", "#000000"], ["text-gray-500", "#6b7280"], ["text-red-500", "#ef4444"], ["text-orange-500", "#f97316"],
  ["text-amber-400", "#fbbf24"], ["text-green-600", "#16a34a"], ["text-blue-600", "#2563eb"], ["text-violet-600", "#7c3aed"], ["text-pink-500", "#ec4899"],
];
const FILL_COLOURS: [string, string][] = [
  ["bg-transparent", "transparent"], ["bg-white", "#ffffff"], ["bg-black", "#000000"], ["bg-gray-100", "#f3f4f6"], ["bg-red-500", "#ef4444"],
  ["bg-orange-500", "#f97316"], ["bg-amber-300", "#fcd34d"], ["bg-green-600", "#16a34a"], ["bg-blue-600", "#2563eb"], ["bg-violet-600", "#7c3aed"],
];

/* Where the size steps start: the size class, else the computed size. */
function sizeIndex(picked: Picked): number {
  const named = picked.className.split(/\s+/).find((name) => SIZES.includes(name));
  if (named) return SIZES.indexOf(named);
  const px = parseFloat(picked.fontSize ?? "");
  if (!Number.isFinite(px)) return 2;
  let best = 0;
  for (let i = 1; i < SIZE_PX.length; i += 1) if (Math.abs(SIZE_PX[i] - px) < Math.abs(SIZE_PX[best] - px)) best = i;
  return best;
}

export function StyleBar({ picked, onStyle, dark = true }: { picked: Picked; onStyle: StyleChange; dark?: boolean }) {
  const at = sizeIndex(picked);
  const bold = /(^|\s)font-(bold|extrabold|black|semibold)(\s|$)/.test(picked.className);
  const button = `flex h-9 min-w-9 items-center justify-center rounded-full px-2.5 text-[13px] ${dark ? "bg-white/[0.08] text-white/90 active:bg-white/[0.18] hover:bg-white/[0.14]" : ""}`;
  const dot = (colour: string, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="h-7 w-7 shrink-0 rounded-full border border-white/25 shadow-inner"
      style={colour === "transparent" ? { background: "linear-gradient(135deg,#fff 45%,#ef4444 47%,#ef4444 53%,#fff 55%)" } : { background: colour }}
    />
  );
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={button} disabled={at <= 0} onClick={() => onStyle("fontSize", SIZES[Math.max(0, at - 1)], "make it smaller")} aria-label="Smaller text">
          <Type className="h-3 w-3" />−
        </button>
        <button type="button" className={button} disabled={at >= SIZES.length - 1} onClick={() => onStyle("fontSize", SIZES[Math.min(SIZES.length - 1, at + 1)], "make it bigger")} aria-label="Bigger text">
          <Type className="h-4 w-4" />+
        </button>
        <button type="button" aria-pressed={bold} className={`${button} ${bold ? "!bg-white !text-black" : ""}`} onClick={() => onStyle("fontWeight", bold ? "font-normal" : "font-bold", bold ? "make it not bold" : "make it bold")} aria-label="Bold">
          <Bold className="h-4 w-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-white/15" />
        <button type="button" className={button} onClick={() => onStyle("align", "text-left", "align it left")} aria-label="Align left"><AlignLeft className="h-4 w-4" /></button>
        <button type="button" className={button} onClick={() => onStyle("align", "text-center", "centre it")} aria-label="Centre"><AlignCenter className="h-4 w-4" /></button>
        <button type="button" className={button} onClick={() => onStyle("align", "text-right", "align it right")} aria-label="Align right"><AlignRight className="h-4 w-4" /></button>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
        <span className="w-12 shrink-0 text-[11.5px] text-white/55">Text</span>
        {TEXT_COLOURS.map(([value, colour]) => dot(colour, `Text ${value.slice(5)}`, () => onStyle("textColor", value, `make the text ${value.slice(5).replace("-", " ")}`)))}
      </div>
      <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
        <span className="w-12 shrink-0 text-[11.5px] text-white/55">Fill</span>
        {FILL_COLOURS.map(([value, colour]) => dot(colour, value === "bg-transparent" ? "No fill" : `Fill ${value.slice(3)}`, () => onStyle("background", value, value === "bg-transparent" ? "remove its background colour" : `make its background ${value.slice(3).replace("-", " ")}`)))}
      </div>
    </div>
  );
}

/* The first time edit mode opens: the three ways to change the page, once.
   Remembered in this browser only — it is a convenience, so a blocked or
   cleared store just shows it again. */
const HINT_KEY = "qs-visual-hint-seen";

export function EditHint({ docked = false }: { docked?: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(HINT_KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  const done = () => {
    setShow(false);
    try {
      window.localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* Not stored; it shows again next time. */
    }
  };
  const verb = docked ? "Tap" : "Click";
  const steps = [
    `${verb} anything in the page to select it`,
    `${verb} the selected text again to type into it — saved as you finish`,
    docked ? "Or open Style for size and colour, or Ask AI to describe a change" : "Or press Aa for size and colour, or describe a change for the AI",
  ];
  return (
    <div
      role="dialog"
      aria-label="How visual edit works"
      className={`pointer-events-auto absolute z-30 rounded-2xl border border-white/[0.12] bg-[#1c1c1f] p-4 text-white shadow-[0_12px_32px_rgba(0,0,0,0.45)] ${
        docked ? "inset-x-3 bottom-20" : "bottom-16 left-1/2 w-[340px] -translate-x-1/2"
      }`}
    >
      <p className="text-[14px] font-semibold">Edit the page directly</p>
      <ol className="mt-2.5 space-y-2">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-2.5 text-[13px] leading-snug text-white/80">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.12] text-[11px] font-semibold text-white">{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <p className="mt-2.5 text-[11.5px] text-white/50">Your own edits and styles use no credits.</p>
      <button type="button" onClick={done} className="mt-3 h-9 w-full rounded-full bg-white text-[13.5px] font-semibold text-black hover:bg-white/90">
        Got it
      </button>
    </div>
  );
}

/* Typing in the page, and what became of it: a small pill over the preview —
   above the keyboard on a phone. */
export function TypingStatus({
  typing,
  saveState,
  onDone,
  docked = false,
}: {
  typing: boolean;
  saveState: SaveState;
  onDone: () => void;
  docked?: boolean;
}) {
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const viewport = docked && typeof window !== "undefined" ? window.visualViewport : null;
    if (!viewport) return;
    const update = () => setKeyboard(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [docked]);
  if (!typing && !saveState) return null;
  const said = typing
    ? "Typing in the page"
    : saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "✓ Saved"
        : saveState === "agent"
          ? "Sent to the agent to place"
          : saveState === "waiting"
            ? "The agent is working — your text saves when it finishes"
            : saveState === "conflict"
              ? "The agent changed that text first — yours wasn't applied"
              : "Couldn't save — try again";
  return (
    <div
      role="status"
      style={docked ? { bottom: keyboard + 12 } : { bottom: 72 }}
      className={`pointer-events-auto ${docked ? "fixed" : "absolute"} inset-x-0 z-[75] mx-auto flex w-fit items-center gap-2 rounded-full bg-[#1c1c1f] py-1.5 pl-4 pr-1.5 text-[13.5px] text-white shadow-[0_10px_28px_rgba(0,0,0,0.45)]`}
    >
      <span className={saveState === "error" || saveState === "conflict" ? "text-amber-300" : ""}>{said}</span>
      {typing ? (
        <button
          type="button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onDone}
          className="h-8 rounded-full bg-white px-3.5 text-[13px] font-semibold text-black"
        >
          Done
        </button>
      ) : (
        <span className="w-2" />
      )}
    </div>
  );
}

/* What a picked element is, in a word a person uses. */
function kindOf(picked: Picked): string {
  const tag = picked.tag.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return "Heading";
  if (tag === "img" || tag === "picture" || tag === "svg") return "Image";
  if (tag === "a") return "Link";
  if (tag === "button") return "Button";
  if (tag === "input" || tag === "textarea" || tag === "select") return "Field";
  if (tag === "li") return "List item";
  if (tag === "nav") return "Navigation";
  if (tag === "header") return "Header";
  if (tag === "footer") return "Footer";
  if (["p", "span", "strong", "em", "small", "label", "blockquote"].includes(tag)) return "Text";
  if (tag === "form") return "Form";
  return "Section";
}

/* The phone's editor: a sheet along the bottom of the screen, the way phone
 * builders do it — what was tapped, named; a way out to the block around it
 * (a finger rarely hits the exact thing); the common changes one tap away;
 * and a prompt at 16px, so iOS does not zoom, that rides above the keyboard
 * rather than under it. The tapped element is scrolled up above the sheet by
 * the frame (runtime.ts reveal). */
function VisualEditSheet({
  projectId,
  picked,
  picks,
  onSent,
  onCancel,
  onSelectParent,
  onEditText,
  onStyle,
}: {
  projectId: string;
  picked: Picked;
  picks: Picked[];
  onSent: () => void;
  onCancel: () => void;
  onSelectParent?: () => void;
  onEditText?: () => void;
  onStyle?: StyleChange;
}) {
  const [text, setText] = useState("");
  /* Ask the agent, or style it by hand. */
  const [mode, setMode] = useState<"ask" | "style">("ask");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [keyboard, setKeyboard] = useState(0);

  /* The keyboard's height, from the visual viewport: the sheet sits on top of
     it rather than behind it. */
  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : null;
    if (!viewport) return;
    const update = () => setKeyboard(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  const send = (ask: string) => {
    const words = ask.trim();
    if (!words) return;
    askChat({ projectId, texts: visualRequests(picks.length ? picks : [picked], words) });
    setText("");
    onSent();
  };
  /* A tap on a chip is a user gesture, so focusing here opens the keyboard. */
  const start = (words: string) => {
    setText(words);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(words.length, words.length);
    });
  };

  const kind = kindOf(picked);
  const image = kind === "Image" || Boolean(picked.imageSrc);
  const snippet = picked.text?.replace(/\s+/g, " ").trim().slice(0, 48);
  const chips: { label: string; run: () => void }[] = image
    ? [
        { label: "Replace image", run: () => start("Replace this image with ") },
        { label: "Bigger", run: () => send("Make it bigger") },
        { label: "Smaller", run: () => send("Make it smaller") },
        { label: "Remove", run: () => send("Remove it") },
      ]
    : [
        /* Words: typed straight into the page, saved as typed. */
        ...(snippet
          ? [{ label: "Edit text", run: () => (onEditText ? onEditText() : start(`Change the text to "${picked.text?.trim().slice(0, 120) ?? ""}"`)) }]
          : []),
        { label: "Colour", run: () => start("Change the colour to ") },
        { label: "Bigger", run: () => send("Make it bigger") },
        { label: "Smaller", run: () => send("Make it smaller") },
        { label: "Remove", run: () => send("Remove it") },
      ];

  return (
    <div
      role="dialog"
      aria-label="Change what you picked"
      style={{ bottom: keyboard }}
      className="pointer-events-auto fixed inset-x-0 z-[70] rounded-t-[22px] border-t border-white/[0.1] bg-[#161618] px-4 pt-2.5 shadow-[0_-16px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl [padding-bottom:max(14px,env(safe-area-inset-bottom))]"
    >
      <div aria-hidden className="mx-auto mb-2.5 h-1 w-9 rounded-full bg-white/20" />
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-white">
            {kind}
            {picks.length > 1 && <span className="font-normal text-white/55"> · +{picks.length - 1} more</span>}
          </p>
          {snippet && <p className="truncate text-[12.5px] text-white/55">“{snippet}” · tap it again to type</p>}
        </div>
        {onSelectParent && (
          <button
            type="button"
            onClick={onSelectParent}
            className="flex h-9 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-[13px] text-white/85 active:bg-white/[0.16]"
          >
            <ArrowUpLeft className="h-3.5 w-3.5" /> Parent
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          aria-label="Let go of what you picked"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-white/85 active:bg-white/[0.16]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {onStyle && (
        <div role="tablist" aria-label="How to change it" className="mt-3 flex rounded-full bg-white/[0.06] p-1">
          {(["ask", "style"] as const).map((one) => (
            <button
              key={one}
              type="button"
              role="tab"
              aria-selected={mode === one}
              onClick={() => setMode(one)}
              className={`h-8 flex-1 rounded-full text-[13px] font-medium ${mode === one ? "bg-white text-black" : "text-white/70"}`}
            >
              {one === "ask" ? "Ask AI" : "Style"}
            </button>
          ))}
        </div>
      )}

      {mode === "style" && onStyle ? (
        <div className="mt-3 pb-1">
          <StyleBar picked={picked} onStyle={onStyle} />
          <p className="mt-2.5 text-[11.5px] text-white/45">Applied instantly and saved as a new version — no credits.</p>
        </div>
      ) : (
      <>
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {chips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={chip.run}
            className="h-9 shrink-0 rounded-full border border-white/[0.12] px-3.5 text-[13.5px] text-white/90 active:bg-white/[0.12]"
          >
            {chip.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(text);
        }}
        className="mt-3 flex items-end gap-2 rounded-[18px] border border-white/[0.12] bg-white/[0.05] p-1.5 pl-3.5"
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={picks.length > 1 ? `Describe a change to these ${picks.length}…` : "Describe a change…"}
          aria-label="Describe a change"
          enterKeyHint="send"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(text);
            }
          }}
          className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent py-[7px] text-[16px] leading-snug text-white placeholder:text-white/45 outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Send the change"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
            text.trim() ? "bg-white text-black" : "bg-white/[0.12] text-white/45"
          }`}
        >
          <ArrowUp className="h-4 w-4 stroke-[2.5]" />
        </button>
      </form>
      </>
      )}
    </div>
  );
}

function FloatingPrompt({
  projectId,
  picked,
  picks,
  docked = false,
  onSent,
  onCancel,
  onStyle,
}: {
  projectId: string;
  /* The newest pick, which the box sits beside. */
  picked: Picked;
  /* Everything picked, the newest included; the request covers them all. */
  picks: Picked[];
  /* On a phone the box sits at the foot of the frame rather than beside the
     element, where a finger and a keyboard would cover it. */
  docked?: boolean;
  onSent: () => void;
  onCancel: () => void;
  onStyle?: StyleChange;
}) {
  const [text, setText] = useState("");
  const [styling, setStyling] = useState(false);
  const boxRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; width: number; room: number } | null>(null);

  /* Each new click puts the cursor back in the box; what was typed stays, so
     clipping one more element does not lose the request. */
  useEffect(() => {
    inputRef.current?.focus();
  }, [picked.pickId]);

  /* Beside the element: over its top-right corner when it is tall enough to
     hold the box without hiding what it says, otherwise just under it — and
     always inside the frame. Measured against the frame's own viewport, which
     is what the rect is reported in. */
  useLayoutEffect(() => {
    if (docked) return;
    const host = boxRef.current?.parentElement;
    const rect = picked.rect;
    if (!host || !rect) {
      setPlace(null);
      return;
    }
    const bounds = host.getBoundingClientRect();
    const scaleX = rect.viewportWidth > 0 ? bounds.width / rect.viewportWidth : 1;
    const scaleY = rect.viewportHeight > 0 ? bounds.height / rect.viewportHeight : 1;
    const width = Math.min(PROMPT_WIDTH, bounds.width - GAP * 2);
    const right = (rect.left + rect.width) * scaleX;
    let left = right - width - GAP;
    left = Math.max(GAP, Math.min(left, bounds.width - width - GAP));
    const roomy = rect.height * scaleY >= PROMPT_HEIGHT + GAP * 2;
    let top = roomy ? rect.top * scaleY + GAP : (rect.top + rect.height) * scaleY + GAP;
    if (top + PROMPT_HEIGHT > bounds.height - GAP) top = rect.top * scaleY - PROMPT_HEIGHT - GAP;
    top = Math.max(GAP, Math.min(top, bounds.height - PROMPT_HEIGHT - GAP));
    setPlace({ top, left, width, room: bounds.height });
  }, [picked.rect, docked]);

  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const ask = text.trim();
    if (!ask) return;
    askChat({ projectId, texts: visualRequests(picks.length ? picks : [picked], ask) });
    setText("");
    onSent();
  }

  const style: React.CSSProperties = docked
    ? { left: GAP, right: GAP, bottom: 64 }
    : place
      ? { top: place.top, left: place.left, width: place.width }
      : { visibility: "hidden" };

  /* The quick styles open under the pill — over it when the frame has no
     room below. */
  const below = place ? place.top + PROMPT_HEIGHT + STYLE_PANEL_HEIGHT + GAP * 2 <= place.room : true;
  const panel: React.CSSProperties | null =
    styling && place
      ? below
        ? { top: place.top + PROMPT_HEIGHT + GAP, left: place.left, width: Math.max(place.width, 340) }
        : { top: Math.max(GAP, place.top - STYLE_PANEL_HEIGHT - GAP), left: place.left, width: Math.max(place.width, 340) }
      : null;

  return (
    <>
    {panel && onStyle && (
      <div
        style={panel}
        className="pointer-events-auto absolute z-30 rounded-2xl border border-white/[0.12] bg-[#1c1c1f] p-3 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
      >
        <StyleBar picked={picked} onStyle={onStyle} />
        <p className="mt-2 text-[11.5px] text-white/50">Applied instantly and saved as a new version — no credits.</p>
      </div>
    )}
    <form
      ref={boxRef}
      onSubmit={submit}
      style={style}
      className="pointer-events-auto absolute z-30 flex h-11 items-center gap-2 rounded-full border border-white/[0.12] bg-[#1c1c1f]/95 pl-4 pr-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.45)] backdrop-blur-md"
    >
      <input
        ref={inputRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        placeholder={picks.length > 1 ? `Describe a change to these ${picks.length}…` : "Describe a change…"}
        aria-label={picks.length > 1 ? `Describe a change to these ${picks.length} elements` : `Describe a change to this ${picked.tag}`}
        className="min-w-0 flex-1 bg-transparent text-[14px] text-white placeholder:text-white/45 outline-none"
      />
      {onStyle && (
        <button
          type="button"
          onClick={() => setStyling((open) => !open)}
          aria-pressed={styling}
          aria-label="Quick styles — size, bold, colour"
          title="Quick styles — no AI, no credits"
          className={`flex h-8 shrink-0 items-center justify-center rounded-full px-2.5 text-[12.5px] font-semibold transition-colors ${
            styling ? "bg-white text-black" : "bg-white/[0.10] text-white/85 hover:bg-white/[0.18]"
          }`}
        >
          Aa
        </button>
      )}
      <button
        type="submit"
        disabled={!text.trim()}
        aria-label="Send the change"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
          text.trim() ? "bg-white/85 text-black hover:bg-white/95" : "bg-white/[0.12] text-white/50"
        }`}
      >
        <ArrowUp className="h-4 w-4 stroke-[2.5]" />
      </button>
    </form>
    </>
  );
}

export function PreviewToolbar({
  editMode,
  canEdit,
  onToggleEdit,
  device,
  onDevice,
  fullscreen,
  onFullscreen,
}: {
  editMode: boolean;
  canEdit: boolean;
  onToggleEdit: () => void;
  device: "desktop" | "mobile";
  onDevice: (device: "desktop" | "mobile") => void;
  fullscreen: boolean;
  onFullscreen: () => void;
}) {
  const [tucked, setTucked] = useState(false);
  const icon =
    "flex h-8 w-8 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/[0.10] hover:text-white";

  if (tucked) {
    return (
      <button
        onClick={() => setTucked(false)}
        aria-label="Show the preview toolbar"
        className="pointer-events-auto absolute bottom-3 left-1/2 z-30 flex h-7 w-12 -translate-x-1/2 items-center justify-center rounded-full border border-white/[0.12] bg-[#1c1c1f]/90 text-white/75 shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md transition-colors hover:text-white"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="pointer-events-auto absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/[0.12] bg-[#1c1c1f]/90 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md">
      <button
        onClick={onToggleEdit}
        disabled={!canEdit}
        aria-pressed={editMode}
        title={canEdit ? (editMode ? "Stop editing" : "Edit — click anything in the preview to change it") : "Nothing to edit yet"}
        className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          editMode ? "bg-[#2563eb] text-white hover:bg-[#1d4ed8]" : "text-white/85 hover:bg-white/[0.10] hover:text-white"
        }`}
      >
        <MousePointerClick className="h-4 w-4" />
        Edit
      </button>
      <button
        onClick={() => onDevice(device === "desktop" ? "mobile" : "desktop")}
        aria-label={device === "desktop" ? "Show at phone width" : "Show at desktop width"}
        title={device === "desktop" ? "Show at phone width" : "Show at desktop width"}
        className={icon}
      >
        {device === "desktop" ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
      </button>
      <button
        onClick={onFullscreen}
        aria-label={fullscreen ? "Leave full screen" : "Full screen"}
        title={fullscreen ? "Leave full screen" : "Full screen"}
        className={icon}
      >
        {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
      <button onClick={() => setTucked(true)} aria-label="Hide the toolbar" title="Hide the toolbar" className={icon}>
        <ChevronDown className="h-4 w-4" />
      </button>
    </div>
  );
}
