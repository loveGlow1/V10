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
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";

type Message = { id: number; from: "support" | "user"; text: string };

const GREETING =
  "Hi, I'm Quinn! Your AI assistant in your build journey. Chat with me for FREE!";

const QUICK_REPLIES = [
  "I have an issue with my current app.",
  "Help me build a great app!!",
  "Help in adding features to my current app",
];

export default function SupportChat() {
  useKeyboardInset();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(1);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, from: "support", text: GREETING },
  ]);
  const threadRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  function send(text: string) {
    const body = text.trim();
    if (!body) return;
    setMessages((current) => [...current, { id: current.length, from: "user", text: body }]);
    setDraft("");
  }

  // Only the first three carry the canned openers; once the conversation has
  // started they would be noise.
  const showQuickReplies = messages.every((message) => message.from === "support");

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed bottom-[calc(86px+env(safe-area-inset-bottom)+var(--keyboard-inset,0px))] right-[max(18px,env(safe-area-inset-right))] z-[60] flex h-[540px] max-h-[calc(100dvh-120px)] w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#111114] shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
            role="dialog"
            aria-label="Support chat"
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3.5">
              <button
                onClick={() => setOpen(false)}
                aria-label="Back"
                className="text-[#8F939A] transition-colors hover:text-white"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white">
                <ChatMark className="h-[18px] w-[18px] text-black" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight text-white">
                  QuickStart Support
                </p>
                <p className="truncate text-xs leading-tight text-[#8F939A]">
                  The team can also help
                </p>
              </div>
              <button aria-label="More" className="text-[#8F939A] transition-colors hover:text-white">
                <MoreHorizontal className="h-4 w-4" />
              </button>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close support chat"
                className="text-[#8F939A] transition-colors hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Thread */}
            <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
              {messages.map((message) =>
                message.from === "support" ? (
                  <div key={message.id}>
                    <div className="max-w-[85%] rounded-[16px] rounded-tl-[6px] bg-white/[0.06] px-3.5 py-2.5">
                      <p className="whitespace-pre-line text-sm leading-relaxed text-white">{message.text}</p>
                    </div>
                    <p className="mt-1.5 text-[11px] text-[#8F939A]">QuickStart Support · Just now</p>
                  </div>
                ) : (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-[16px] rounded-br-[6px] bg-white/[0.12] px-3.5 py-2.5">
                      <p className="text-sm leading-relaxed text-white">{message.text}</p>
                    </div>
                  </div>
                ),
              )}

              {showQuickReplies && (
                <div className="flex flex-col items-end gap-2 pt-1">
                  {QUICK_REPLIES.map((reply) => (
                    <button
                      key={reply}
                      onClick={() => send(reply)}
                      className="max-w-[85%] rounded-[16px] border border-white/[0.1] bg-white/[0.06] px-3.5 py-2.5 text-right text-sm text-white transition-colors hover:bg-white/[0.1]"
                    >
                      {reply}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="px-3 pb-2">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  send(draft);
                }}
                className="rounded-[16px] border border-white/[0.14] bg-white/[0.03] px-3 pb-2 pt-2.5"
              >
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Message..."
                  aria-label="Message"
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-[#8F939A]"
                />
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[#8F939A]">
                    <button type="button" aria-label="Attach a file" className="transition-colors hover:text-white">
                      <Paperclip className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="Emoji" className="transition-colors hover:text-white">
                      <Smile className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="GIF" className="transition-colors hover:text-white">
                      <ImageIcon className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="Voice message" className="transition-colors hover:text-white">
                      <Mic className="h-4 w-4" />
                    </button>
                  </div>
                  <button
                    type="submit"
                    disabled={!draft.trim()}
                    aria-label="Send message"
                    className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all active:scale-[0.98] ${
                      draft.trim()
                        ? "border-white/20 bg-white/[0.14] text-white hover:bg-white/[0.2]"
                        : "border-white/[0.08] bg-white/[0.05] text-[#6C7078]"
                    }`}
                  >
                    <ArrowUp className="h-3.5 w-3.5 stroke-[2.5]" />
                  </button>
                </div>
              </form>
              <p className="py-2 text-center text-[11px] text-[#8F939A]">Powered by QuickStart.Ai</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Launcher */}
      <button
        onClick={() => {
          setOpen((value) => !value);
          setUnread(0);
        }}
        aria-label={open ? "Close support chat" : "Open support chat"}
        aria-expanded={open}
        className="fixed bottom-[calc(max(18px,env(safe-area-inset-bottom))+var(--keyboard-inset,0px))] right-[max(18px,env(safe-area-inset-right))] z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-white text-black shadow-[0_8px_30px_rgba(0,0,0,0.5)] transition-transform hover:scale-[1.04] active:scale-[0.97]"
      >
        {open ? <ChevronDown className="h-5 w-5" /> : <ChatMark className="h-6 w-6" />}
        {!open && unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F45B5B] text-[11px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>
    </>
  );
}
