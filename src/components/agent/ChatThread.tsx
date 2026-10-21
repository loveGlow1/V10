"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowDown, ArrowLeft } from "lucide-react";

import ArtifactSheet, { type Artifact } from "./ArtifactSheet";
import Composer from "./Composer";
import MessageParts from "./MessageParts";
import PreviewChip from "./PreviewChip";

/* An agent session: the header, the conversation, the reply box, and the
 * panel things open in.
 *
 * Only the newest message is sent; the server reads everything before it from
 * the session (see /api/agent), so what the model sees is what was saved. Ids
 * are uuids because that is what they are stored under.
 *
 * Scrolling follows the conversation only while somebody is already at the
 * bottom of it. Scrolled up to read, they are left where they are and a
 * "↓ New activity" pill says something arrived below. */

const NEAR_BOTTOM = 120;

type AnyPart = { type: string; output?: unknown; data?: unknown };

export default function ChatThread({
  sessionId,
  title,
  previewUrl,
  initialMessages,
  backHref,
}: {
  sessionId: string;
  title: string;
  previewUrl: string | null;
  initialMessages: UIMessage[];
  backHref: string;
}) {
  const { messages, sendMessage, stop, status, error } = useChat({
    id: sessionId,
    messages: initialMessages,
    generateId: () => crypto.randomUUID(),
    transport: new DefaultChatTransport({
      api: "/api/agent",
      prepareSendMessagesRequest: ({ id, messages: all }) => ({ body: { id, message: all[all.length - 1] } }),
    }),
  });

  const busy = status === "submitted" || status === "streaming";
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const closeArtifact = useCallback(() => setArtifact(null), []);

  /* ── Following the conversation ─────────────────────────────────────── */
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    setAtBottom(near);
    if (near) setUnseen(false);
  }, []);
  const toBottom = useCallback((smooth: boolean) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setUnseen(false);
  }, []);

  /* A rough fingerprint of the thread's length, so streaming text — which
     changes no message count — still counts as new activity. */
  const size = useMemo(
    () =>
      messages.reduce(
        (total, message) =>
          total +
          message.parts.reduce((sum, part) => {
            const one = part as AnyPart & { text?: unknown; input?: unknown };
            return sum + 1 + (typeof one.text === "string" ? one.text.length : 0) + (one.input ? JSON.stringify(one.input).length : 0);
          }, 0),
        0,
      ),
    [messages],
  );
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      toBottom(false);
      return;
    }
    if (atBottom) toBottom(false);
    else setUnseen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  /* ── The header chip: one pulse per new preview or screenshot ───────── */
  const shots = useMemo(() => {
    const found: string[] = [];
    for (const message of messages) {
      for (const part of message.parts as AnyPart[]) {
        const output = part.output as { url?: unknown } | undefined;
        if (part.type === "tool-take_snapshot" && typeof output?.url === "string") found.push(output.url);
        const data = part.data as { url?: unknown } | undefined;
        if (part.type === "data-preview" && typeof data?.url === "string") found.push(data.url);
      }
    }
    return found;
  }, [messages]);
  const latestShot = shots.at(-1) ?? null;

  const last = messages.at(-1);

  return (
    <div className="flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className={`flex min-h-0 flex-1 flex-col ${artifact ? "lg:mr-[45%]" : ""}`}>
        <header className="flex min-w-0 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 pt-[max(8px,env(safe-area-inset-top))] dark:border-zinc-800">
          <a
            href={backHref}
            aria-label="Back"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
          </a>
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h1>
          <PreviewChip
            url={previewUrl}
            version={shots.length}
            onOpen={latestShot ? () => window.open(latestShot, "_blank", "noopener,noreferrer") : undefined}
          />
        </header>

        <div ref={scroller} onScroll={measure} className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
            {messages.length === 0 && (
              <p className="py-16 text-center text-[14.5px] text-zinc-500 dark:text-zinc-400">
                Tell the agent what to build or change. It writes the code, runs it, and checks the result with a screenshot.
              </p>
            )}
            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-zinc-100 px-3.5 py-2 text-[15px] leading-6 dark:bg-zinc-800">
                    {message.parts.map((part, index) => (part.type === "text" ? <span key={index}>{part.text}</span> : null))}
                  </div>
                </div>
              ) : (
                <MessageParts key={message.id} message={message} streaming={busy && message.id === last?.id} onOpen={setArtifact} />
              ),
            )}
            {status === "submitted" && (
              <p className="text-[13.5px] text-zinc-500 dark:text-zinc-400" aria-live="polite">
                Starting…
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[13.5px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {readableError(error)}
              </p>
            )}
          </div>
        </div>

        <div className="relative">
          {unseen && (
            <button
              type="button"
              onClick={() => toBottom(true)}
              className="absolute -top-12 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[13px] text-zinc-700 shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              <ArrowDown className="h-3.5 w-3.5" /> New activity
            </button>
          )}
          <Composer
            busy={busy}
            onSend={(text) => {
              void sendMessage({ text });
              /* Sending is a decision to watch what comes back. */
              requestAnimationFrame(() => toBottom(true));
            }}
            onStop={() => void stop()}
          />
        </div>
      </div>

      <ArtifactSheet artifact={artifact} onClose={closeArtifact} />
    </div>
  );
}

function readableError(error: Error): string {
  const text = error.message || "";
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    /* Not JSON: the message as it came. */
  }
  return text || "Something went wrong. Try again.";
}
