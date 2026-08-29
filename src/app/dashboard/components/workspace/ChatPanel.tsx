"use client";

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Mic, MicOff, Paperclip } from "lucide-react";

import { avatarFor } from "../../projectColours";
import { MicMark, SendArrow } from "../marks";
import type { Project } from "../../ProjectsContext";

type Message = { id: number; from: "you" | "system"; text: string };

/* The left half of a workspace: what you have asked for, and the box you ask in.

   The box is the composer Home already uses — the same orbiting highlight, the
   same graphite glass, the same send button — at the width this column gives it.
   Asking for a change should feel like asking for the app in the first place.

   Nothing generates yet, so nothing here pretends to. A message you send is
   shown as sent, and the panel says plainly that the builder is not connected —
   an invented reply would read as a working product that is not there. */
export default function ChatPanel({ project }: { project: Project | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const nextId = useRef(0);

  // A new project is a new conversation; keeping the old one would attribute
  // messages to the wrong app.
  useEffect(() => {
    setMessages([]);
    setDraft("");
    nextId.current = 0;
  }, [project?.id]);

  useEffect(() => {
    const stream = streamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [messages]);

  function send() {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { id: nextId.current++, from: "you", text },
      {
        id: nextId.current++,
        from: "system",
        text: "Saved to this session. Building is not connected yet, so nothing runs on this message.",
      },
    ]);
    setDraft("");
  }

  // The same recorder Home uses: the audio is captured and the browser's own
  // recogniser, where there is one, types into the box while it runs.
  async function toggleRecording() {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.onstop = () => stream.getTracks().forEach((track) => track.stop());
      recorder.start();
      setIsRecording(true);

      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event: any) => {
          let heard = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            heard += event.results[i][0].transcript;
          }
          setDraft(heard);
        };
        recognition.start();
      }
    } catch {
      // Permission refused or unsupported: leave the button where it was rather
      // than showing a recording that is not happening.
      setIsRecording(false);
    }
  }

  const control =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(255,255,255,0.08)] bg-white/[0.06] text-white transition-all hover:border-white/[0.12] active:scale-[0.98]";

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col border-white/[0.06] md:border-r">
      {/* h-[53px] on both halves so the two headers rule off at the same line. */}
      <header className="flex h-[53px] shrink-0 items-center gap-2.5 border-b border-white/[0.06] px-4">
        <span
          className={`h-6 w-6 shrink-0 rounded-lg bg-gradient-to-br ${avatarFor(project?.id)}`}
        />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">
          {project?.name ?? "Loading…"}
        </p>
      </header>

      <div
        ref={streamRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {messages.length === 0 ? (
          <p className="pt-8 text-center text-sm text-[#8F939A]">
            Describe a change and it will appear here.
          </p>
        ) : (
          messages.map((message) =>
            message.from === "you" ? (
              <p
                key={message.id}
                className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-white/[0.08] px-3.5 py-2.5 text-[14px] leading-relaxed text-white"
              >
                {message.text}
              </p>
            ) : (
              <p key={message.id} className="max-w-[88%] text-[13px] leading-relaxed text-[#8F939A]">
                {message.text}
              </p>
            ),
          )
        )}
      </div>

      <div className="shrink-0 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {/* Home's composer, brought over whole: the orbiting highlight outside,
            the graphite glass inside. */}
        <div className="group relative w-full overflow-visible rounded-[26px] p-0 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
          <div className="pointer-events-none absolute inset-0 z-25 overflow-hidden rounded-[26px]">
            <div className="absolute -inset-[150%] animate-orbit-border bg-[conic-gradient(from_0deg_at_50%_50%,rgba(236,243,255,0.40)_0deg,rgba(236,243,255,0.12)_78deg,rgba(236,243,255,0.04)_128deg,rgba(236,243,255,0.34)_196deg,rgba(236,243,255,0.10)_268deg,rgba(236,243,255,0.04)_310deg,rgba(236,243,255,0.40)_360deg)]" />
          </div>

          <div className="relative z-30 flex min-h-[128px] w-full flex-col justify-between overflow-hidden rounded-[26px] border-[1.5px] border-white/[0.11] bg-[#0e0f12] bg-clip-padding p-3.5">
            <div className="relative">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends, Shift+Enter breaks the line — the convention
                  // every chat composer already trained people on.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                aria-label="Describe a change"
                rows={2}
                className="relative z-10 h-[52px] w-full resize-none bg-transparent text-base text-white outline-none"
              />
              <AnimatePresence>
                {!draft && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, ease: "easeInOut" }}
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 select-none text-base text-[#9A9A9F]"
                  >
                    Describe a change…
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            <div className="relative mt-3 flex items-center justify-between gap-2">
              <div className="flex shrink-0 items-center gap-[3px]">
                <input
                  type="file"
                  ref={fileInputRef}
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    console.log(event.target.files);
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Add photos or files"
                  className={control}
                >
                  <Paperclip className="h-4 w-4 -rotate-45" />
                </button>
              </div>

              <div className="flex shrink-0 items-center gap-[3px]">
                <button
                  onClick={toggleRecording}
                  title={isRecording ? "Stop Recording" : "Start Recording"}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all active:scale-[0.98] ${
                    isRecording
                      ? "animate-pulse border-red-500 bg-red-500/20 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.4)]"
                      : "border-[rgba(255,255,255,0.08)] bg-white/[0.06] text-white hover:border-white/[0.12]"
                  }`}
                >
                  {isRecording ? <MicOff className="h-4 w-4" /> : <MicMark className="h-4 w-4" />}
                </button>

                {/* Send sits in the bar's own material rather than shouting over
                    it, and only lifts once there is something to send. */}
                <button
                  onClick={send}
                  disabled={!draft.trim()}
                  aria-label="Send"
                  className={`flex h-[34px] w-[38px] shrink-0 items-center justify-center rounded-[15px] border transition-all active:scale-[0.98] ${
                    draft.trim()
                      ? "border-transparent bg-[#4A4A54] text-white hover:bg-[#565662]"
                      : "border-transparent bg-[#28292a] text-white/40"
                  }`}
                >
                  <SendArrow className="h-4 w-4 md:hidden" />
                  <ArrowUp className="hidden h-4 w-4 stroke-[2.5] md:block" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
