"use client";

import React from "react";
import { Check, ExternalLink, User } from "lucide-react";

import QMark from "../../../QMark";

import BuildActivity, { type ActivityStep } from "./BuildActivity";
import BuildResultCard, { type BuildResult } from "./BuildResultCard";

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

/* What this row draws. The stored half — who said it, the words, its links and
   tone — is ThreadMessage, which lives in @/lib/project-messages because it is
   read back out of a table. Everything below it is view-only and deliberately
   optional: a thread loaded from a previous visit has no clock reading and no
   tracker, and inventing either would be this panel claiming to know when a
   message from last week was sent. */
export type Message = {
  id: number;
  from: "you" | "system";
  text: string;
  links?: { label: string; href: string }[];
  tone?: "normal" | "error";
  /** When it was said, on messages this session saw sent. */
  at?: number;
  /** Set on a reply whose work actually landed. */
  applied?: boolean;
  activity?: Activity;
  /** The finished page, on the reply that announced it. */
  result?: BuildResult;
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
  supersededAt,
  onOpenPreview,
  onPublish,
}: {
  message: Message;
  /** When the most recent run in this visit started, for a result card that the
      thread has since moved past. */
  supersededAt?: number | null;
  onOpenPreview?: () => void;
  onPublish?: () => void;
}) {
  const you = message.from === "you";

  return (
    /* A reply that reports a problem is still a reply. It gets the same
       typography as every other one and a thin rule down its edge — amber
       rather than red, because almost none of these are alarms: a change that
       could not be applied, a build still running, a file too large. Colouring
       the sentence itself made every one of them read as a crash, and made the
       three that matter indistinguishable from the ones that do not. */
    <div
      className={`rounded-xl border border-line/[0.06] bg-layer/[0.02] py-2.5 pr-3 ${
        message.tone === "error" ? "border-l-2 border-l-warn/50 pl-[10px]" : "pl-3"
      }`}
    >
      <div className="flex items-center gap-2">
        {/* The person gets a chip, the assistant gets the mark. Not symmetry for
            its own sake: a logo boxed inside a coloured square reads as an app
            icon, and this is a signature. Still rather than turning, and in the
            quiet colour rather than the brand green — it repeats down the whole
            thread, and twenty spinning green marks is a fairground. The green
            lives in the wordmark instead, once per row, exactly as the header
            above does it. */}
        {you ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-layer/[0.10] text-soft">
            <User className="h-3 w-3" />
          </span>
        ) : (
          <QMark scale={1.85} className="h-[22px] w-[22px] shrink-0" />
        )}
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {you ? (
            "You"
          ) : (
            <>
              {/* The same green the landing page gives it. Not the shimmer
                  beside it: that sweeps every seven seconds, and twenty rows
                  each catching the light on their own schedule is a thread
                  that will not sit still. */}
              QuickStark<span className="wordmark-ai">.Ai</span>
            </>
          )}
        </p>
        {typeof message.at === "number" && (
          <time
            dateTime={new Date(message.at).toISOString()}
            className="shrink-0 text-[12px] tabular-nums text-muted"
          >
            {timeOf(message.at)}
          </time>
        )}
      </div>

      <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-soft">
        {message.text}
      </p>

      {/* Said only where it is true: work that actually landed. "Applied" over
          a refusal or a failure would be the panel disagreeing with the
          sentence directly above it. */}
      {message.applied && (
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

      {message.result && (
        <BuildResultCard
          result={message.result}
          supersededAt={supersededAt}
          onPublish={onPublish}
        />
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
