"use client";

import React from "react";
import { Check, ExternalLink, Sparkles, User } from "lucide-react";

import BuildActivity, { type ActivityStep } from "./BuildActivity";

/* The build behind one reply, as the tracker needs it. */
export type Activity = {
  steps: ActivityStep[];
  startedAt: number;
  finishedAt: number;
  failed: boolean;
  /** A measured figure to sit beside the clock, when the build reported one. */
  note?: string;
  previewHref: string | null;
};

export type Message = {
  id: number;
  from: "you" | "system";
  text: string;
  /** When it was said, for the time beside the name. Real clock, set once. */
  at: number;
  /* A build that came back with somewhere to look. Rendered as links under the
     reply rather than pasted into it, so the address stays clickable. */
  links?: { label: string; href: string }[];
  tone?: "normal" | "error";
  /* The build behind this reply. Absent on anything that was not one — an
     error thrown before the orchestrator was reached has nothing to show. */
  activity?: Activity;
};

/* The clock, as the reader's own locale writes it. */
export function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/* One turn of the conversation.

   Both sides are the same card rather than opposed bubbles: this column is
   420px beside the preview, and a thread that alternates margins spends a third
   of that on whitespace. Who is speaking is carried by the avatar and the name,
   which stay legible at any width. */
export default function MessageRow({
  message,
  avatarClass,
  onOpenPreview,
}: {
  message: Message;
  /** The project's own gradient, so the assistant is marked as this app's. */
  avatarClass: string;
  onOpenPreview?: () => void;
}) {
  const you = message.from === "you";

  return (
    <div className="rounded-xl border border-line/[0.06] bg-layer/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${
            you ? "bg-layer/[0.10] text-soft" : `bg-gradient-to-br text-onSolid ${avatarClass}`
          }`}
        >
          {you ? <User className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
        </span>
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {you ? "You" : "QuickStark AI"}
        </p>
        <time
          dateTime={new Date(message.at).toISOString()}
          className="shrink-0 text-[12px] tabular-nums text-muted"
        >
          {timeOf(message.at)}
        </time>
      </div>

      <p
        className={`mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed ${
          message.tone === "error" ? "text-danger" : "text-soft"
        }`}
      >
        {message.text}
      </p>

      {/* Said only where it is true: a build the orchestrator did not fail.
          "Applied" over a failure would be the panel disagreeing with the
          sentence directly above it. */}
      {message.activity && !message.activity.failed && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-accent">
          <Check className="h-3.5 w-3.5 stroke-[3]" />
          Applied
        </p>
      )}

      {message.links && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line/[0.1] bg-layer/[0.05] px-2.5 text-[12px] font-medium text-ink transition-colors hover:border-line/[0.18]"
            >
              {link.label}
              <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      )}

      {message.activity && (
        <div className="mt-2.5">
          <BuildActivity
            steps={message.activity.steps}
            running={false}
            startedAt={message.activity.startedAt}
            finishedAt={message.activity.finishedAt}
            failed={message.activity.failed}
            note={message.activity.note}
            previewHref={message.activity.previewHref}
            onOpenPreview={onOpenPreview}
          />
        </div>
      )}
    </div>
  );
}
