"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, MoreHorizontal, Pin, PinOff } from "lucide-react";

import AnchoredPanel from "./AnchoredPanel";
import { ManageMark } from "./workspace/panelMarks";

/* The per-row lifecycle menu, shared by the dashboard's "Continue working" list
 * and the Projects page.
 *
 * One component for both because the two menus differ by exactly one item and a
 * second copy is how they would drift — the surface with the confirmation step
 * gaining one the other never got. Which items appear is a prop, not a fork:
 * Delete is present only where `onDelete` is passed, and it is deliberately not
 * passed on the dashboard. That row sits directly under the composer, close
 * enough to a thumb to be hit on the way past, and a destructive action does not
 * belong there.
 *
 * Duplicate is absent from both. There is no duplicate handler anywhere in the
 * app to call, and an item that invents what "a copy" means — the prompt, the
 * thread, the built page, all three — would be a new feature rather than a menu
 * entry. See the report on Update 02.
 *
 * ProjectRowMenu is left alone rather than extended: it carries Download and a
 * hard delete, the sidebar's recent-tasks drawer depends on both, and widening
 * it into a menu that sometimes hard-deletes and sometimes soft-deletes is the
 * drift this component exists to avoid. */

export type LifecycleProject = {
  id: string;
  name: string;
  pinned: boolean;
  /** Manually archived, or aged out. Drives the Archive/Unarchive wording. */
  archived: boolean;
};

export default function ProjectLifecycleMenu({
  project,
  onPin,
  onRename,
  onArchive,
  onDelete,
}: {
  project: LifecycleProject;
  onPin: (pinned: boolean) => void;
  onRename: (name: string) => void;
  onArchive: (archived: boolean) => void;
  /** Omit to leave Delete out of the menu entirely. */
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const rootRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    setRenaming(false);
    setConfirming(false);
  }

  const item =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-layer/[0.06]";

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

      {/* Anchored rather than absolutely placed. On the last row of a page
          there is nothing below the button, so `top-full` put Delete past the
          end of the document — on screen as far as the layout was concerned,
          and unreachable by anyone, because a positioned box does not extend
          the scroll area of an ancestor that is not scrolling. This flips above
          the button when the room is up there, caps itself to what room there
          is and scrolls the rest, and closes on a press outside — which it has
          to own itself now, since the panel is portalled out of this component
          and a `contains` check here would read every press inside the menu as
          a press outside it. */}
      <AnchoredPanel
        open={open}
        onClose={close}
        side="bottom"
        align="right"
        role="menu"
        className="w-[240px] rounded-xl border border-line/[0.09] bg-panel p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.7)]"
      >
        <>
          {renaming ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const name = draft.trim();
                if (!name) return;
                onRename(name);
                close();
              }}
              className="p-1"
            >
              <input
                autoFocus
                value={draft}
                maxLength={80}
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
          ) : confirming && onDelete ? (
            /* The confirmation, in the menu rather than over the page. It is
               where ProjectRowMenu already asks the same question, and a modal
               for a step that is undoable for a month would overstate it. */
            <div className="p-1">
              <p className="px-1.5 pb-2 pt-1 text-[13px] text-soft">
                Delete {project.name}? You can undo this for 30 days.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onDelete();
                    close();
                  }}
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
              {/* Manage, first, and the only entry here that opens something
                  rather than doing something to the row.

                  It exists for the phone. The drawer's Manage row only appears
                  inside an app, because Home has no one app to mean — so from
                  Home the only thing called Manage was the billing row, and
                  that is what somebody looking for their database pressed.
                  ?view=manage is read once on arrival by Workspace, which keeps
                  this an ordinary link rather than a reach into that
                  component's state. */}
              <Link
                role="menuitem"
                href={`/dashboard/project/${project.id}?view=manage`}
                onClick={close}
                className={item}
              >
                <ManageMark className="h-4 w-4 shrink-0 text-muted" />
                Manage
              </Link>

              <button
                role="menuitem"
                onClick={() => {
                  onPin(!project.pinned);
                  close();
                }}
                className={item}
              >
                {project.pinned ? (
                  <PinOff className="h-4 w-4 shrink-0 text-muted" />
                ) : (
                  <Pin className="h-4 w-4 shrink-0 text-muted" />
                )}
                {project.pinned ? "Unpin" : "Pin"}
              </button>

              <button role="menuitem" onClick={() => setRenaming(true)} className={item}>
                Rename
              </button>

              <button
                role="menuitem"
                onClick={() => {
                  onArchive(!project.archived);
                  close();
                }}
                className={item}
              >
                {project.archived ? (
                  <ArchiveRestore className="h-4 w-4 shrink-0 text-muted" />
                ) : (
                  <Archive className="h-4 w-4 shrink-0 text-muted" />
                )}
                {project.archived ? "Unarchive" : "Archive"}
              </button>

              {onDelete && (
                <button
                  role="menuitem"
                  onClick={() => setConfirming(true)}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10"
                >
                  Delete
                </button>
              )}
            </>
          )}
        </>
      </AnchoredPanel>
    </div>
  );
}
