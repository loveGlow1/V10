"use client";

import React, { useState } from "react";
import { Check, Database, Download, ExternalLink, X } from "lucide-react";

import {
  connectSupabasePath,
  isConnectDatabaseHref,
  isConnectSupabaseHref,
} from "@/lib/builder/backend/connect-link";

import QMark from "../../../QMark";

import BuildActivity, { type ActivityStep } from "./BuildActivity";
import BuildResultCard, { useResultActionsLive, type BuildResult } from "./BuildResultCard";
import ChatMarkdown from "./ChatMarkdown";

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

/* One turn of the conversation, read like a chat: the person's message is a
   bubble on the right, and the reply is open text under the mark, set from
   Markdown so a step-by-step answer reads as steps. */
/* Chips that open the app itself — "Open it", "Preview" — are already on a
   desktop screen: the preview fills the pane beside the chat and Open app
   sits in its toolbar. So they are for phones, where the pane is a tap away,
   exactly like the download chip. */
const APP_LABELS = new Set(["Open it", "Preview", "Open preview", "Open app"]);
function isAppLink(link: { label: string; href: string }): boolean {
  return APP_LABELS.has(link.label) || /\/preview(?:\/|$|\?)/.test(link.href);
}
function inThePane(link: { label: string; href: string }): boolean {
  return isAppLink(link) || link.href.includes("download=1");
}

export default function MessageRow({
  message,
  supersededAt,
  onOpenPreview,
  onPublish,
  onConnectDatabase,
}: {
  message: Message;
  /** When the most recent run in this visit started, for a result card that the
      thread has since moved past. */
  supersededAt?: number | null;
  onOpenPreview?: () => void;
  onPublish?: () => void;
  /** Opens the Database panel in place, for a reply that asks to link one. */
  onConnectDatabase?: () => void;
}) {
  const you = message.from === "you";

  /* "Connect your database" is an action, not a place. It is stored as the
     address of the Database panel so it survives a reload, and drawn here as
     a real button that opens the panel beside the conversation — never
     buried behind the result card, and never a new tab. */
  const connectLink = onConnectDatabase
    ? message.links?.find((link) => isConnectDatabaseHref(link.href))
    : undefined;
  /* No "Open it": on a phone, where these chips show, it opened the
     published site, which keeps the last published version until the next
     publish — so after a change it showed an older app than the one just
     built. "Preview" opens the newest, so it is the one kept. */
  /* "Connect Supabase" goes straight to Supabase's sign-in — one press from
     the chat to the account, and Supabase brings the person back to the
     Database panel to pick a project. Followed in this tab by its path, so it
     starts on the host they are signed in to. */
  const supabaseLink = message.links?.find((link) => isConnectSupabaseHref(link.href));
  /* Images a reply carries — a flier's versions — drawn as pictures, not chips. */
  const images = message.links?.filter((link) => link.label.startsWith("image:"));
  const chips = message.links?.filter(
    (link) => link !== connectLink && link !== supabaseLink && link.label !== "Open it" && !link.label.startsWith("image:"),
  );

  /* The card's buttons and these chips are two ways to the same two things, so
     only one of them is ever on offer. While the buttons are up they are the
     shortcut worth taking — larger, in reach, and about the build that has just
     landed. When they expire the chips take over and stay, which is what makes
     a thread scrolled back to next week still able to open or save the page.
     A reply with chips and no card has nothing to wait for. */
  const actionsLive = useResultActionsLive(message.result, supersededAt);

  /* A conversation, not a log: what you said sits on the right in a bubble,
     and the reply answers it in the open below, the way a chat reads. */
  if (you) {
    return (
      <div className="flex min-w-0 flex-col items-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-[20px] [overflow-wrap:anywhere] rounded-br-md bg-layer/[0.09] px-4 py-2.5 text-[15px] leading-relaxed text-ink md:text-[13.5px]">
          {message.text}
        </div>
        {typeof message.at === "number" && (
          <time dateTime={new Date(message.at).toISOString()} className="mt-1 pr-1 text-[11px] tabular-nums text-muted">
            {timeOf(message.at)}
          </time>
        )}
      </div>
    );
  }

  return (
    /* A reply that reports a problem is still a reply. It gets the same
       typography as every other one and a thin rule down its edge — amber
       rather than red, because almost none of these are alarms: a change that
       could not be applied, a build still running, a file too large. Colouring
       the sentence itself made every one of them read as a crash, and made the
       three that matter indistinguishable from the ones that do not. */
    <div className="group flex min-w-0 max-w-full gap-3 py-5 sm:gap-4">
      {/* The assistant signs with the mark, in a quiet tile down the left so
          the reply itself reads as a document beside it. */}
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line/[0.1] bg-layer/[0.06] sm:h-8 sm:w-8">
        <QMark scale={1.85} className="h-[18px] w-[18px]" />
      </div>

      <div
        className={`min-w-0 max-w-[720px] flex-1 ${
          message.tone === "error" ? "border-l-2 border-l-warn/50 pl-3" : ""
        }`}
      >
        {typeof message.at === "number" && (
          <time
            dateTime={new Date(message.at).toISOString()}
            className="block h-0 -translate-y-5 text-xs tabular-nums text-muted opacity-0 transition-opacity group-hover:opacity-100"
          >
            {timeOf(message.at)}
          </time>
        )}

        {/* The reading type is set on the reply itself, not the column, so the
            chips, card and tracker below keep exactly the type they had. */}
        <ChatMarkdown text={message.text} className="text-[15px] leading-7 text-soft" />

        {images && images.length > 0 && <ReplyImages images={images} />}

        {/* Said only where it is true: work that actually landed. "Applied" over
            a refusal or a failure would be the panel disagreeing with the
            sentence directly above it. */}
        {message.applied && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-accent">
            <Check className="h-3.5 w-3.5 stroke-[3]" />
            Applied
          </p>
        )}

        {/* Hidden per chip rather than as a row, because the two kinds are not
         * the same thing.
         *
         * A DOWNLOAD chip is a duplicate on desktop: the pane beside the
         * conversation has its own, permanently. Two buttons for one file only
         * makes a reader decide which is the real one.
         *
         * An OPEN chip is not a duplicate. The pane shows the page in a framed
         * panel; this opens it in a real browser tab, at full width, where links
         * and scrolling and the address bar behave normally. That is a different
         * thing to want, and it is worth a chip of its own at every size.
         *
         * Below `md` nothing hides at all: there is no pane on screen — chat and
         * preview are one at a time behind a toggle — so every chip here is the
         * only route from the thread to the page. */}
        {supabaseLink && (
          <a
            href={connectSupabasePath(supabaseLink.href)}
            className="mt-2.5 mr-2 inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90"
          >
            <Database className="h-4 w-4" />
            {supabaseLink.label}
          </a>
        )}
        {connectLink && (
          <button
            type="button"
            onClick={onConnectDatabase}
            className="mt-2.5 inline-flex h-8 items-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-semibold text-black transition-opacity hover:opacity-90"
          >
            <Database className="h-3.5 w-3.5" />
            {connectLink.label}
          </button>
        )}

        {chips && chips.length > 0 && !actionsLive && (
          <div className={`mt-2 flex flex-wrap gap-1.5 ${chips.every(inThePane) ? "md:hidden" : ""}`}>
            {chips.map((link) => {
              /* A chip that saves a file rather than opening a place.
                 Both the arrow and the new tab would be wrong for it: the route
                 answers with a Content-Disposition, so the browser saves it and
                 the tab it opened would sit there empty. */
              const saves = link.href.includes("download=1");
              const opensApp = isAppLink(link);
              return (
                <a
                  key={link.href}
                  href={link.href}
                  {...(saves ? { download: "" } : { target: "_blank", rel: "noreferrer" })}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-full border border-line/[0.1] bg-layer/[0.05] px-2.5 text-[12px] font-medium text-ink transition-colors hover:border-line/[0.18] ${
                    saves || opensApp ? "md:hidden" : ""
                  }`}
                >
                  {link.label}
                  {saves ? <Download className="h-3 w-3" /> : <ExternalLink className="h-3 w-3" />}
                </a>
              );
            })}
          </div>
        )}

        {/* Same rule, same reason: the card's thumbnail, Download and Publish
            are all in the pane on desktop. The thumbnail is the most redundant
            thing on the screen there — a small picture of the page, directly
            beside the actual page, at size and live. */}
        {message.result && (
          <div className="md:hidden">
            <BuildResultCard result={message.result} live={actionsLive} onPublish={onPublish} />
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
    </div>
  );
}

/* A reply's images, in the conversation: tap one to see it full size, and
   Download saves exactly that image — the file route answers with it as an
   attachment, so the browser saves a clean PNG and nothing else. */
function ReplyImages({ images }: { images: { label: string; href: string }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const download = (href: string) => `${href}${href.includes("?") ? "&" : "?"}download=1`;
  return (
    <>
      <div className="mt-3 grid max-w-[520px] grid-cols-2 gap-2">
        {images.map((image, index) => (
          <div key={image.href} className="group/img relative overflow-hidden rounded-xl border border-line/[0.08] bg-layer/[0.04]">
            <button type="button" onClick={() => setOpen(image.href)} aria-label={`See version ${index + 1} full size`} className="block w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.href} alt={`Version ${index + 1}`} loading="lazy" className="block h-auto w-full" />
            </button>
            <a
              href={download(image.href)}
              download
              aria-label={`Download version ${index + 1}`}
              className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition-opacity hover:bg-black/80"
            >
              <Download className="h-4 w-4" />
            </a>
          </div>
        ))}
      </div>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image, full size"
          onClick={() => setOpen(null)}
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-black/90 p-4"
        >
          <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20">
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={open} alt="Full size" onClick={(event) => event.stopPropagation()} className="max-h-[78vh] w-auto max-w-full rounded-2xl" />
          <a
            href={download(open)}
            download
            onClick={(event) => event.stopPropagation()}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-onSolid"
          >
            <Download className="h-4 w-4" /> Download
          </a>
        </div>
      )}
    </>
  );
}
