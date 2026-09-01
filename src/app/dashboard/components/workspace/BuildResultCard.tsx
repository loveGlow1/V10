"use client";

import React, { useEffect, useState } from "react";
import { Download, Rocket } from "lucide-react";

import PageThumbnail from "../PageThumbnail";

/* How long a finished build keeps its buttons in the conversation.
 *
 * They are here because a build has just landed and taking the file or putting
 * it live is the thing some people want to do immediately. They are not here
 * forever, because the thread is a record of what was asked and answered, and
 * live controls sitting in it a week later are neither. Three minutes is the
 * brief: long enough to act on, short enough that scrolling back never offers
 * them.
 *
 * Nothing is lost when they go. Download and Publish both live in the preview
 * header, which is their permanent home; this is the shortcut. */
const ACTION_WINDOW_MS = 3 * 60 * 1000;

/* And the shorter fuse: once another run starts in the same visit, this card is
 * no longer the current page, so its buttons stand down a minute later rather
 * than waiting out the full three. The minute is grace for a hand already
 * moving towards them, not a second chance. */
const SUPERSEDED_WINDOW_MS = 60 * 1000;

export type BuildResult = {
  projectId: string;
  name: string;
  /** "Web app", "Draft" — the same line the drawer's recent tasks show. */
  kind?: string;
  /** When the build landed. The window is measured from here, so a thread
      reopened later shows the card without buttons rather than for three more
      minutes. */
  at: number;
  /** Whether there is a page to draw and to take. */
  hasPage: boolean;
  /** The build that produced it, so the thumbnail redraws when a new one lands. */
  stamp: string | null;
};

/* The moment the buttons go, which is whichever comes first. A run that started
   before this card is its own — only a later one supersedes it. */
function deadlineOf(result: BuildResult, supersededAt?: number | null): number {
  const full = result.at + ACTION_WINDOW_MS;
  if (typeof supersededAt !== "number" || supersededAt <= result.at) return full;
  return Math.min(full, supersededAt + SUPERSEDED_WINDOW_MS);
}

/* What a finished build looks like in the thread: the page, what it is called,
   and — for a few minutes — the two things anyone would do with it next. */
/* Whether this card's buttons are still on offer.
 *
 * Lifted out of the card because the row above it needs the same answer: the
 * link chips are the permanent way to the same two things, and showing both at
 * once offers each of them twice. One hook, one timer, one truth — the chips
 * cannot be up while the buttons are, and cannot be missing once they have
 * gone.
 *
 * Safe to call with no result: a reply that carries chips and no card has
 * nothing to wait for, and gets its chips immediately. */
export function useResultActionsLive(
  result: BuildResult | undefined,
  supersededAt?: number | null,
): boolean {
  const deadline = result ? deadlineOf(result, supersededAt) : null;

  /* Recomputed on a timer rather than decided once, so the buttons go away
     while someone is looking at them instead of only on the next render. */
  const [live, setLive] = useState(() => deadline !== null && Date.now() < deadline);

  useEffect(() => {
    if (deadline === null) {
      setLive(false);
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      setLive(false);
      return;
    }
    /* Set true again as well as false: a new deadline can only ever be earlier
       than the last, but the card is also re-rendered with a fresh result when
       a build lands, and that one starts its own window. */
    setLive(true);
    const timer = window.setTimeout(() => setLive(false), remaining);
    return () => window.clearTimeout(timer);
  }, [deadline]);

  return live;
}

export default function BuildResultCard({
  result,
  live,
  onPublish,
}: {
  result: BuildResult;
  /** Whether the buttons are still on offer — decided by the row, which uses
      the same answer to keep its link chips out of the way until they go. */
  live: boolean;
  /** Opens the publish flow the preview header already owns. */
  onPublish?: () => void;
}) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-2xl border border-line/[0.1] bg-layer/[0.02]">
      {/* The page itself, the same component the apps list draws it with —
          cached by build stamp, so this does not refetch every render. */}
      <PageThumbnail
        projectId={result.projectId}
        hasPage={result.hasPage}
        name={result.name}
        stamp={result.stamp}
        className="h-[150px] w-full rounded-none border-b border-line/[0.07]"
      />

      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-ink">{result.name}</p>
            {result.kind && <p className="mt-0.5 truncate text-[13px] text-muted">{result.kind}</p>}
          </div>
          {result.hasPage && (
            <p className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-accent">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
              Ready
            </p>
          )}
        </div>

        {/* Both or neither. The row goes whole rather than leaving one button
            behind, which would read as the other having failed. */}
        {live && (
          <div className="mt-3 flex items-center gap-2">
            {/* An anchor rather than a button: the route answers with
                Content-Disposition, so the browser saves it and the page it is
                on never navigates. */}
            {result.hasPage && (
              <a
                href={`/preview/${result.projectId}?download=1`}
                download
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-line/[0.12] bg-layer/[0.04] text-[13px] font-medium text-ink transition-colors hover:bg-layer/[0.08]"
              >
                <Download className="h-4 w-4 shrink-0" />
                Download
              </a>
            )}
            <button
              onClick={onPublish}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-solid text-[13px] font-medium text-onSolid transition-colors hover:bg-layer/90 active:scale-[0.99]"
            >
              <Rocket className="h-4 w-4 shrink-0" />
              Publish
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
