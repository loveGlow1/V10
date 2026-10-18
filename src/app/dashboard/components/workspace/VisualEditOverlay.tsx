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
import { ArrowUp, ArrowUpLeft, ChevronDown, ChevronUp, Maximize2, Minimize2, Monitor, MousePointerClick, Smartphone, X } from "lucide-react";

import { parseSrc } from "@/lib/builder/visual-edit";

import type { Picked } from "./preview-bridge";
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

export function VisualEditPrompt(props: {
  projectId: string;
  picked: Picked;
  picks: Picked[];
  docked?: boolean;
  onSent: () => void;
  onCancel: () => void;
  onSelectParent?: () => void;
  onEditText?: () => void;
}) {
  return props.docked ? <VisualEditSheet {...props} /> : <FloatingPrompt {...props} />;
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
  saveState: null | "saving" | "saved" | "agent" | "error";
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
          : "Couldn't save — try again";
  return (
    <div
      role="status"
      style={docked ? { bottom: keyboard + 12 } : { bottom: 72 }}
      className={`pointer-events-auto ${docked ? "fixed" : "absolute"} inset-x-0 z-[75] mx-auto flex w-fit items-center gap-2 rounded-full bg-[#1c1c1f] py-1.5 pl-4 pr-1.5 text-[13.5px] text-white shadow-[0_10px_28px_rgba(0,0,0,0.45)]`}
    >
      <span className={saveState === "error" ? "text-red-300" : ""}>{said}</span>
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
}: {
  projectId: string;
  picked: Picked;
  picks: Picked[];
  onSent: () => void;
  onCancel: () => void;
  onSelectParent?: () => void;
  onEditText?: () => void;
}) {
  const [text, setText] = useState("");
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
}) {
  const [text, setText] = useState("");
  const boxRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);

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
    setPlace({ top, left, width });
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

  return (
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
