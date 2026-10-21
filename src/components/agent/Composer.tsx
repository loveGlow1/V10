"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

/* The reply box: sticky at the foot, growing with what is typed up to about
   eight lines, Enter to send and Shift+Enter for a new line. While the agent
   works, Send becomes Stop. Clear of the iPhone home indicator. */
export default function Composer({
  busy,
  disabled,
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const area = box.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
  }, [text]);

  const send = () => {
    const words = text.trim();
    if (!words || busy || disabled) return;
    onSend(words);
    setText("");
  };

  return (
    <div className="sticky bottom-0 z-20 border-t border-zinc-200 bg-white/95 px-3 pt-2 backdrop-blur pb-[max(10px,env(safe-area-inset-bottom))] dark:border-zinc-800 dark:bg-zinc-950/95">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-zinc-200 bg-white p-1.5 pl-3.5 shadow-sm focus-within:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:border-zinc-600"
      >
        <textarea
          ref={box}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Reply…"
          aria-label="Reply to the agent"
          enterKeyHint="send"
          disabled={disabled}
          className="max-h-[200px] min-h-[36px] min-w-0 flex-1 resize-none bg-transparent py-[7px] text-[16px] leading-snug text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-50 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim() || disabled}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition-opacity hover:bg-zinc-700 disabled:opacity-30 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <ArrowUp className="h-4 w-4 stroke-[2.5]" />
          </button>
        )}
      </form>
    </div>
  );
}
