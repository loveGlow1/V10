"use client";

/* Undo, and every version — in the preview's header.
 *
 * Both are sent to the chat as an undo (askChat with intent "revert"), never
 * done beside it: the restore is the same one a typed "undo" or "go back to
 * version 3" makes (/api/build, lib/builder/versions.ts), so it is free, it is
 * written into the thread, the preview reloads with it, and the restore is
 * itself a new version that can be undone. Nothing is ever deleted.
 *
 * The list is read from the project's own history (/api/projects/[id]/versions)
 * each time it opens, and a pick names its exact version number. */

import { useEffect, useRef, useState } from "react";
import { History, Loader2, Undo2 } from "lucide-react";

import { askChat } from "./visual-ask";

type Row = { number: number; label: string; createdAt: string; restoredFrom: number | null };

function when(iso: string): string {
  const at = new Date(iso);
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function VersionControls({
  projectId,
  lastBuildAt,
  buttonClassName,
  iconClassName = "h-4 w-4",
}: {
  projectId: string;
  /* Re-read when a build lands, so the list is never a version behind. */
  lastBuildAt: string | null;
  buttonClassName: string;
  iconClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [showing, setShowing] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setFailed(false);
    fetch(`/api/projects/${projectId}/versions`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: { versions: Row[]; showing: number | null }) => {
        if (!live) return;
        setRows(body.versions);
        setShowing(body.showing);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, projectId, lastBuildAt]);

  /* Closed by a click anywhere else, or Escape. */
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  /* "Sent" says itself and goes; the chat shows the restore itself. */
  useEffect(() => {
    if (!sent) return;
    const timer = window.setTimeout(() => setSent(null), 2500);
    return () => window.clearTimeout(timer);
  }, [sent]);

  const restore = (text: string, note: string) => {
    askChat({ projectId, texts: [text], intent: "revert" });
    setSent(note);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => restore("Undo the last change", "Undoing…")}
        disabled={!lastBuildAt}
        title="Undo the last change — free, and it can be undone too"
        aria-label="Undo the last change"
        className={buttonClassName}
      >
        <Undo2 className={iconClassName} />
      </button>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={!lastBuildAt}
        aria-expanded={open}
        title="Versions — go back to any of them"
        aria-label="Versions"
        className={`${buttonClassName} ${open ? "bg-layer/[0.08] text-ink" : ""}`}
      >
        <History className={iconClassName} />
      </button>

      {sent && (
        <span role="status" className="pointer-events-none absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-full bg-ink px-3 py-1 text-[12px] font-medium text-canvas shadow-lg">
          {sent}
        </span>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Versions"
          className="fixed inset-x-3 top-16 z-[80] max-h-[70vh] overflow-hidden rounded-2xl border border-line/[0.12] bg-canvas shadow-[0_16px_48px_rgba(0,0,0,0.35)] md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:w-[340px]"
        >
          <div className="border-b border-line/[0.08] px-4 py-3">
            <p className="text-[14px] font-semibold text-ink">Versions</p>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">
              Pick one to go back to it. It&apos;s restored as a new version, so nothing is lost — and it&apos;s free.
            </p>
          </div>
          <div className="max-h-[52vh] overflow-y-auto py-1">
            {failed ? (
              <p className="px-4 py-3 text-[13px] text-muted">The versions couldn&apos;t be read just now. Try again.</p>
            ) : !rows ? (
              <p className="flex items-center gap-2 px-4 py-3 text-[13px] text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading your history…
              </p>
            ) : rows.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted">No versions yet.</p>
            ) : (
              rows.map((row) => {
                const current = row.number === rows[0].number;
                const looksSame = !current && (row.restoredFrom ?? row.number) === showing;
                return (
                  <button
                    key={row.number}
                    type="button"
                    disabled={current}
                    onClick={() => restore(`Go back to version ${row.number}`, `Restoring version ${row.number}…`)}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-layer/[0.06] disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className="mt-0.5 w-9 shrink-0 font-mono text-[12px] text-muted">v{row.number}</span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[13px] leading-snug text-ink">{row.label}</span>
                      <span className="mt-0.5 block text-[11.5px] text-muted">
                        {when(row.createdAt)}
                        {current ? " · showing now" : looksSame ? " · same as now" : ""}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
