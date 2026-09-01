"use client";

import React, { useEffect, useRef, useState } from "react";
import { Download, MoreHorizontal } from "lucide-react";

import { useProjects, type Project } from "../ProjectsContext";
import { safeHttpUrl } from "@/lib/safe-url";

/* The per-row actions menu: take the page, rename, and delete behind a
 * confirmation.
 *
 * Lifted out of ProjectList because the drawer's recent tasks need the same
 * behaviours, and a second copy of a menu that deletes things is how the two
 * drift — one gaining a confirmation step the other never got.
 *
 * Download is here because this is the one place an app is always listed. The
 * card in the conversation offers it for a few minutes after a build, which is
 * a shortcut and expires like one; the preview header offers it while the
 * preview is open. Neither is somewhere you can go and find it later, and "I
 * built this last week, give me the file" is a reasonable thing to want. */
export default function ProjectRowMenu({ project }: { project: Project }) {
  const { rename, remove } = useProjects();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setRenaming(false);
        setConfirming(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => {
          setOpen((value) => !value);
          setDraft(project.name);
        }}
        aria-label={`Actions for ${project.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-layer/[0.06] hover:text-ink"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[220px] overflow-hidden rounded-xl border border-line/[0.09] bg-panel p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.7)]"
        >
          {renaming ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!draft.trim()) return;
                if (await rename(project.id, draft.trim())) setOpen(false);
                setRenaming(false);
              }}
              className="p-1"
            >
              <input
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-label="Project name"
                className="h-9 w-full rounded-lg border border-line/[0.1] bg-layer/[0.04] px-2.5 text-sm text-ink outline-none focus-visible:border-line/25"
              />
              <button
                type="submit"
                className="mt-2 w-full rounded-lg bg-solid px-3 py-1.5 text-[13px] font-medium text-onSolid transition-colors hover:bg-layer/90"
              >
                Save
              </button>
            </form>
          ) : confirming ? (
            <div className="p-1">
              <p className="px-1.5 pb-2 pt-1 text-[13px] text-soft">
                Delete {project.name}? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => remove(project.id)}
                  className="flex-1 rounded-lg bg-danger px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-danger"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="flex-1 rounded-lg border border-line/[0.09] px-3 py-1.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* An anchor rather than a button: the route answers with a
                  Content-Disposition, so the browser saves the file and the
                  page this menu is on never navigates. Absent, rather than
                  disabled, on an app that has not been built — there is no file
                  to offer and saying so twice is noise. */}
              {safeHttpUrl(project.preview_url) && (
                <a
                  role="menuitem"
                  href={`/preview/${project.id}?download=1`}
                  download
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-layer/[0.06]"
                >
                  <Download className="h-4 w-4 shrink-0 text-muted" />
                  Download
                </a>
              )}
              <button
                role="menuitem"
                onClick={() => setRenaming(true)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-layer/[0.06]"
              >
                Rename
              </button>
              <button
                role="menuitem"
                onClick={() => setConfirming(true)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10"
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
