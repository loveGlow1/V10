"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pin } from "lucide-react";

import { isPublished, useProjects } from "../ProjectsContext";
import PageThumbnail from "./PageThumbnail";
import ProjectLifecycleMenu from "./ProjectLifecycleMenu";
import { browserAccessToken, byRank, patchProject } from "@/lib/projects/client";
import { listContinueWorking, type ProjectListItem } from "@/lib/projects/queries";
import { safeHttpUrl } from "@/lib/safe-url";

/* Rounded to the unit a person would say out loud; anything under a minute is
   "just now" rather than a count of seconds nobody reads. */
function updatedAgo(iso: string) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Updated recently";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "Updated just now";
  const units: [number, string][] = [
    [60, "min"],
    [3600, "hr"],
    [86400, "day"],
    [604800, "week"],
    [2592000, "month"],
    [31536000, "year"],
  ];
  let unit = units[0];
  for (const candidate of units) if (seconds >= candidate[0]) unit = candidate;
  const value = Math.floor(seconds / unit[0]);
  return `Updated ${value} ${unit[1]}${value === 1 ? "" : "s"} ago`;
}

/* What is worth coming back to, at most three of them.
 *
 * Two sources, deliberately. Which projects and in what order is
 * listContinueWorking's answer — pinned first, then last opened, archived and
 * deleted rows already gone — and that ordering is the whole point of the
 * section. What each row shows is the projects list this dashboard already
 * holds: the built page for the tile, the status for the Published badge, the
 * time it was last changed. Asking the lifecycle query for those columns too
 * would give two loaders for one row and a tile that flickers when they
 * disagree, so the ranking selects and the list renders.
 *
 * The old filter menu is gone. Three rows do not need filtering, and All /
 * Apps / Published over a list capped at three was a control with nothing to
 * do; it is a link to the Projects page now, where the filters live and where
 * there is enough to filter. */
export default function ProjectList() {
  const router = useRouter();
  const { projects, rename: renameInList } = useProjects();

  const [ranked, setRanked] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Held so the row's click handler has it without awaiting: opening a project
     touches it, and that write must start before the navigation, not after a
     round trip to find out who is asking. */
  const token = useRef<string | null>(null);

  const load = useCallback(async () => {
    token.current = await browserAccessToken();
    if (!token.current) {
      setRanked([]);
      return;
    }
    try {
      const rows = await listContinueWorking(token.current);
      setError(null);
      setRanked(rows);
    } catch (loadError) {
      setRanked([]);
      setError(loadError instanceof Error ? loadError.message : "Could not read your projects.");
    }
  }, []);

  /* On mount, and again whenever a project is created or removed elsewhere on
     this page — that is what changes which three belong here. A rename is
     folded in below without a read, so it deliberately does not trigger one. */
  useEffect(() => {
    void load();
  }, [projects.length, load]);

  /* Pin and archive both move a row, so both change the list in place first and
     tell the server after. A pin that waited on a round trip to move would look
     like it had not worked. */
  const change = useCallback(
    async (id: string, next: Partial<ProjectListItem>, patch: Parameters<typeof patchProject>[1]) => {
      const before = ranked;
      setRanked((current) =>
        (current ?? [])
          .map((row) => (row.id === id ? { ...row, ...next } : row))
          .sort(byRank),
      );

      const failure = await patchProject(id, patch);
      if (failure) {
        setError(failure);
        setRanked(before);
        return;
      }
      setError(null);
      /* An archive leaves a gap, and the fourth project is the one that fills
         it. Re-read rather than reload the page — the composer above keeps
         whatever is typed in it. */
      void load();
    },
    [ranked, load],
  );

  /* Nothing at all until the first read is in — a section that appears and then
     rearranges itself is worse than a moment of quiet. After that it stays,
     empty or not, because the link in its corner is the only way to the
     Projects page from here and a route that appears once you have four
     projects is a route nobody finds. */
  if (ranked === null) return null;

  return (
    <section className="mt-10 w-full max-w-[720px] md:mt-16">
      <div className="flex items-end justify-between gap-4 px-1">
        <h2 className="text-[17px] font-semibold tracking-tight text-ink md:text-lg">
          Continue working
        </h2>

        {/* Always. It was shown only once there were more than three projects,
            on the reasoning that three rows already showed everything — which
            was true and beside the point: it made the Projects page reachable
            only from a dashboard that no longer needed it, and unreachable from
            the one that did. Archived apps, the search, and delete all live
            behind this link, and none of them are things you want only after
            your fourth project. */}
        <Link
          href="/dashboard/projects"
          className="flex h-8 shrink-0 items-center rounded-lg px-2 text-[13px] text-muted transition-colors hover:bg-layer/[0.04] hover:text-ink"
        >
          View all →
        </Link>
      </div>

      <div className="mt-3 space-y-1 md:mt-4">
        {error && <p className="py-8 text-center text-sm text-danger">{error}</p>}

        {ranked.map((row) => {
          const project = projects.find((candidate) => candidate.id === row.id);
          /* Ranked but not loaded yet. It appears on the next read rather than
             as a row with no name in it. */
          if (!project) return null;

          return (
            <div
              key={row.id}
              className="flex items-center gap-4 rounded-2xl px-3 py-3 transition-colors hover:bg-layer/[0.03]"
            >
              <button
                /* Straight to the preview. Opening an app from this list means
                   wanting to look at it, not to talk about it — the conversation
                   is one close away underneath, and the sheet is raised again
                   from there whenever it is wanted.

                   The opening itself is recorded on arrival, by the workspace,
                   rather than here — every other way into an app would need its
                   own copy of this line otherwise. See Workspace.tsx. */
                onClick={() => router.push(`/dashboard/project/${project.id}?view=preview`)}
                className="flex min-w-0 flex-1 items-center gap-4 text-left"
              >
                {/* The page itself, drawn small — not a screenshot and not a
                    stand-in. An app that has never been built has nothing to
                    draw, so it keeps the colour and initial it always had. */}
                <PageThumbnail
                  projectId={project.id}
                  hasPage={Boolean(safeHttpUrl(project.preview_url))}
                  name={project.name}
                  /* The build that drew it. Holding the tile still between
                     visits and redrawing it when a build lands are the same
                     question, and this is the answer to both. */
                  stamp={project.last_build_at}
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    {row.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-muted" />}
                    <span className="truncate text-[15px] text-ink">{project.name}</span>
                    {isPublished(project) && (
                      <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                        Published
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block truncate text-[13px] text-muted">
                    {updatedAgo(project.updated_at)}
                  </span>
                </span>
              </button>

              {/* No Delete. This row sits under the composer, close enough to a
                  thumb on the way past, and the deliberate version of that
                  action lives on the Projects page. */}
              <ProjectLifecycleMenu
                project={{
                  id: row.id,
                  name: project.name,
                  pinned: row.pinned,
                  archived: row.archived_at !== null,
                }}
                onPin={(pinned) => void change(row.id, { pinned }, { pinned })}
                onArchive={(archived) =>
                  void change(
                    row.id,
                    { archived_at: archived ? new Date().toISOString() : null },
                    { archived },
                  )
                }
                onRename={(name) => {
                  /* Through the projects list, so the tab strip and the switcher
                     are relabelled with it, then the same change on the server. */
                  void renameInList(row.id, name);
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
