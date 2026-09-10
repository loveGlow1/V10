"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  Image as ImageIcon,
  Mic,
  MoreHorizontal,
  Paperclip,
  Smile,
  X,
} from "lucide-react";

import ChatMark from "./ChatMark";
import { useSupportChatRequests } from "../supportChat";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useMediaQuery } from "@/hooks/use-media-query";

type Message = { id: number; from: "support" | "user"; text: string };

const GREETING =
  "Hi, I'm Quinn! Your AI assistant in your build journey. Chat with me for FREE!";

export default function SupportChat() {
  useKeyboardInset();
  /* Desktop only. On a phone the launcher sits on top of the composer's send
     button and the panel covers most of the screen, so the widget competes with
     the thing the visitor came to use.

     The rule lives in the component rather than at the mount site, so it holds
     wherever this is rendered. useMediaQuery's server snapshot is false, which
     means a handset never paints the widget at all — only a desktop pays for the
     second render that brings it in. */
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [open, setOpen] = useState(false);
  /* Contact Support, wherever it is pressed, lands here. The count only ever
     goes up, so the effect below runs once per request and never on mount. */
  const supportRequests = useSupportChatRequests();
  /* Starts at nothing. This was seeded at 1, so every visitor arrived to a badge
     announcing a message that did not exist — and once dismissed it could never
     come back, since nothing else set it. It now counts what it claims to count:
     support messages that arrived while the panel was shut. */
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);
  /* How much of the thread the visitor has already been shown. The thread starts
     empty, so nothing has been seen yet. */
  const seenCount = useRef(0);

  /* The greeting arrives when the panel is opened, not when the page loads, so it
     reads as a message that has just come in rather than one that was sitting
     there all along. Added once — reopening the panel does not repeat it. */
  useEffect(() => {
    if (!open) return;
    setMessages((current) =>
      current.length > 0 ? current : [{ id: 0, from: "support", text: GREETING }],
    );
  }, [open]);

  useEffect(() => {
    if (supportRequests === 0) return;
    setOpen(true);
    setUnread(0);
  }, [supportRequests]);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  /* Opening the panel is reading it; while it is shut, each support message that
     lands adds to the count. A message the visitor sent themselves never does. */
  useEffect(() => {
    if (open) {
      setUnread(0);
      seenCount.current = messages.length;
      return;
    }

    const arrived = messages.slice(seenCount.current).filter((message) => message.from === "support").length;
    seenCount.current = messages.length;
    if (arrived > 0) setUnread((count) => count + arrived);
  }, [messages, open]);

  function send(text: string) {
    const body = text.trim();
    if (!body) return;
    setMessages((current) => [...current, { id: current.length, from: "user", text: body }]);
    setDraft("");
  }

  /* After the hooks, never before: an early return above them would change the
     hook order between a phone and a desktop as the viewport crosses 768px. */
  if (!isDesktop) return null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed bottom-[calc(86px+env(safe-area-inset-bottom)+var(--keyboard-inset,0px))] right-[max(18px,env(safe-area-inset-right))] z-[60] flex h-[540px] max-h-[calc(100dvh-120px)] w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-[20px] border border-line/[0.08] bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
            role="dialog"
            aria-label="Support chat"
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-line/[0.06] px-4 py-3.5">
              <button
                onClick={() => setOpen(false)}
                aria-label="Back"
                className="text-muted transition-colors hover:text-ink"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {/* The same object as the launcher, in the size a header has room
                  for: the rim, and none of the light around it — a pool of glow
                  inside a 380px panel would be a haze rather than a source. */}
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-accent/45 bg-sunken">
                <ChatMark className="h-[18px] w-[18px] text-ink" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight text-ink">
                  QuickStark Support
                </p>
                <p className="truncate text-xs leading-tight text-muted">
                  The team can also help
                </p>
              </div>
              <button aria-label="More" className="text-muted transition-colors hover:text-ink">
                <MoreHorizontal className="h-4 w-4" />
              </button>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close support chat"
                className="text-muted transition-colors hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Thread */}
            <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
              {messages.map((message) =>
                message.from === "support" ? (
                  <div key={message.id}>
                    <div className="max-w-[85%] rounded-[16px] rounded-tl-[6px] bg-layer/[0.06] px-3.5 py-2.5">
                      <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{message.text}</p>
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted">QuickStark Support · Just now</p>
                  </div>
                ) : (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-[16px] rounded-br-[6px] bg-layer/[0.12] px-3.5 py-2.5">
                      <p className="text-sm leading-relaxed text-ink">{message.text}</p>
                    </div>
                  </div>
                ),
              )}
            </div>

            {/* Composer */}
            <div className="px-3 pb-2">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  send(draft);
                }}
                className="rounded-[16px] border border-line/[0.14] bg-layer/[0.03] px-3 pb-2 pt-2.5"
              >
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Message..."
                  aria-label="Message"
                  className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
                />
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-muted">
                    <button type="button" aria-label="Attach a file" className="transition-colors hover:text-ink">
                      <Paperclip className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="Emoji" className="transition-colors hover:text-ink">
                      <Smile className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="GIF" className="transition-colors hover:text-ink">
                      <ImageIcon className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="Voice message" className="transition-colors hover:text-ink">
                      <Mic className="h-4 w-4" />
                    </button>
                  </div>
                  <button
                    type="submit"
                    disabled={!draft.trim()}
                    aria-label="Send message"
                    className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all active:scale-[0.98] ${
                      draft.trim()
                        ? "border-line/20 bg-layer/[0.14] text-ink hover:bg-layer/[0.2]"
                        : "border-line/[0.08] bg-layer/[0.05] text-muted"
                    }`}
                  >
                    <ArrowUp className="h-3.5 w-3.5 stroke-[2.5]" />
                  </button>
                </div>
              </form>
              <p className="py-2 text-center text-[11px] text-muted">Powered by QuickStark.Ai</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* THE LAUNCHER: a lit rim, not a filled disc.
       *
       * It was a solid white circle with a dark mark cut into it — a control
       * that happened to land in the dark rather than something the dark has a
       * light in. The shape here is the one the Keep Building button on Home
       * already uses, and for the same reason: an outlined circle with a pool
       * of its own light around it reads as the source of the light, and a
       * filled one reads as a sticker on top of the page.
       *
       * Three parts, all of them deliberately under-driven — a launcher is
       * furniture, and it sits on screen for the whole session:
       *
       *   the pool, a wide soft circle behind the button, at 0.16 rather than
       *   the 0.30 the Home CTA carries, because that one is pressed once and
       *   this one is looked past a hundred times;
       *
       *   the rim, one hairline of accent at 45%, which is the whole outline —
       *   there is no second brighter ring inside it;
       *
       *   the bloom, a single soft shadow of the same colour, wide and weak, so
       *   the rim looks lit rather than drawn.
       *
       * Every colour is `var(--accent)` rather than a literal mint, so the
       * light theme gets its own deeper emerald instead of a mint haze on a
       * white page. */}
      <div className="fixed bottom-[calc(max(18px,env(safe-area-inset-bottom))+var(--keyboard-inset,0px))] right-[max(18px,env(safe-area-inset-right))] z-[60]">
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[130px] w-[130px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgb(var(--accent)/0.16),rgb(var(--accent)/0.05)_46%,transparent_72%)] blur-[12px]"
        />

        <button
          onClick={() => {
            setOpen((value) => !value);
            setUnread(0);
          }}
          aria-label={open ? "Close support chat" : "Open support chat"}
          aria-expanded={open}
          className="group relative flex h-14 w-14 items-center justify-center rounded-full border border-accent/45 bg-sunken text-ink shadow-[0_0_22px_rgb(var(--accent)/0.16),0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-sm transition-all hover:border-accent/60 hover:scale-[1.04] active:scale-[0.97]"
        >
          {open ? <ChevronDown className="h-5 w-5" /> : <ChatMark className="h-6 w-6" />}
          {!open && unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F45B5B] text-[11px] font-semibold text-white">
              {unread}
            </span>
          )}
        </button>
      </div>
    </>
  );
}
