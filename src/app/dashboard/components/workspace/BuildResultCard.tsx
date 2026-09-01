"use client";

import React, { useEffect, useState } from "react";
import { Download, Rocket } from "lucide-react";

import PageThumbnail from "../PageThumbnail";

/* How long the download stays in the conversation.
 *
 * It is here because a build has just finished and taking the file is the thing
 * some people want to do immediately. It is not here forever, because the
 * thread is a record of what was asked and answered, and a live control sitting
 * in it a week later is neither. Two minutes is the brief: long enough to act
 * on, short enough that scrolling back never offers it.
 *
 * Nothing is lost when it goes. The same download sits beside Publish in the
 * preview header, which is its permanent home; this is the shortcut. */
const DOWNLOAD_WINDOW_MS = 2 * 60 * 1000;

export type BuildResult = {
  projectId: string;
  name: string;
  /** "Web app", "Draft" — the same line the drawer's recent tasks show. */
  kind?: string;
  /** When the build landed. The download window is measured from here, so a
      thread reopened later shows the card without it rather than for two more
      minutes. */
  at: number;
  /** Whether there is a page to draw and to take. */
  hasPage: boolean;
  /** The build that produced it, so the thumbnail redraws when a new one lands. */
  stamp: string | null;
};

/* What a finished build looks like in the thread: the page, what it is called,
   and the two things anyone would do with it next. */
export default function BuildResultCard({
  result,
  onPublish,
}: {
  result: BuildResult;
  /** Opens the publish flow the preview header already owns. */
  onPublish?: () => void;
}) {
  /* Recomputed on a timer rather than decided once, so the button goes away
     while someone is looking at it instead of only on the next render. */
  const [downloadable, setDownloadable] = useState(
    () => result.hasPage && Date.now() - result.at < DOWNLOAD_WINDOW_MS,
  );

  useEffect(() => {
    if (!downloadable) return;
    const remaining = result.at + DOWNLOAD_WINDOW_MS - Date.now();
    if (remaining <= 0) {
      setDownloadable(false);
      return;
    }
    const timer = window.setTimeout(() => setDownloadable(false), remaining);
    return () => window.clearTimeout(timer);
  }, [downloadable, result.at]);

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

        <div className="mt-3 flex items-center gap-2">
          {/* An anchor rather than a button: the route answers with
              Content-Disposition, so the browser saves it and the page it is on
              never navigates. */}
          {downloadable && (
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
      </div>
    </div>
  );
}
