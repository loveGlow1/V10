"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, Laptop, Pin, Radio } from "lucide-react";

import { isPublished, useProjects } from "../ProjectsContext";
import PageThumbnail from "./PageThumbnail";
import ProjectLifecycleMenu from "./ProjectLifecycleMenu";
import { browserAccessToken, byRank, isArchived, patchProject } from "@/lib/projects/client";
import { listContinueWorking, type ProjectListItem } from "@/lib/projects/queries";
import { isPublishedProject } from "@/lib/project-status";
import { publishedLabel, publishedShortLabel, publishedUrl } from "@/lib/publish/naming";
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
 * listContinueWorking's answer — pinned first, then last opened, deleted rows
 * already gone — and that ordering is the whole point of the section. What each
 * row shows is the projects list this dashboard already holds: the built page
 * for the tile, the status for the Published badge, the time it was last
 * changed. Asking the lifecycle query for those columns too would give two
 * loaders for one row and a tile that flickers when they disagree, so the
 * ranking selects and the list renders.
 *
 * ── The three views ────────────────────────────────────────────────────────
 *
 * All / Apps / Published was here once and was taken out, on the reasoning that
 * a control filtering a list capped at three rows had nothing to do. That
 * reasoning was right about the old shape and wrong about the idea: the fault
 * was that the query fetched three rows and the filter then narrowed THOSE, so
 * pressing Published on an account whose three most recent apps happened to be
 * unpublished showed nothing at all — while the sidebar insisted there were
 * published apps. A filter that can show an empty list to somebody who owns the
 * thing they asked for is worse than no filter.
 *
 * So the cap moved to the other side of the filter. The query returns the whole
 * ranked list, each view takes its own rows out of it, and the three that show
 * are the top three OF THAT VIEW. Published now always shows published apps if
 * there are any, and the counts on the chips are counts of what you own rather
 * than of what happened to survive a slice. One read serves all three, so
 * switching between them is instant and costs nothing. */

type View = "all" | "apps" | "published";

/* Which tab of the Projects page each view continues into, so "View all" lands
   on the same set of projects the section is showing rather than always on
   Active. `published` is that page's Live tab — the same rows, unabridged. */
const VIEWS: { id: View; label: string; heading: string; icon: typeof LayoutGrid; filter: string }[] = [
  { id: "all", label: "All", heading: "Your apps", icon: LayoutGrid, filter: "all" },
  { id: "apps", label: "Apps", heading: "Continue working", icon: Laptop, filter: "active" },
  { id: "published", label: "Published", heading: "Live apps", icon: Radio, filter: "published" },
];

/* Says what to do rather than what is absent — an empty state that only reports
   the emptiness leaves the question it raised unanswered. The published line is
   word for word the Projects page's, because they answer the same question. */
const EMPTY: Record<View, string> = {
  all: "No projects yet.",
  apps: "No active apps.",
  published: "Nothing published yet. Open an app and press Publish to put it online.",
};

/** The dashboard shows three of whatever is being looked at. */
const SHOWN = 3;

export default function ProjectList() {
  const router = useRouter();
  const { projects, rename: renameInList } = useProjects();

  const [ranked, setRanked] = useState<ProjectListItem[] | null>(null);
  const [view, setView] = useState<View>("all");
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

  /* The three views, cut from the one ranked list.
   *
   * `isArchived` and `isPublishedProject` rather than a second query: they are
   * the same tests the Projects page and the workspace use, so a project cannot
   * read as live or as archived on one screen and not on another.
   *
   * Published re-sorts by when it went up. The question that view answers is
   * "what have I put out", and the answer to that is chronological — an app
   * published in March does not become less published by being opened
   * yesterday. It is the rule the Projects page's Live tab already sorts by. */
  const buckets = useMemo(() => {
    const rows = ranked ?? [];
    return {
      all: rows,
      apps: rows.filter((row) => !isArchived(row)),
      published: rows
        .filter((row) => isPublishedProject(row))
        .sort((a, b) => Date.parse(b.published_at ?? "") - Date.parse(a.published_at ?? "")),
    } satisfies Record<View, ProjectListItem[]>;
  }, [ranked]);

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

  const current = VIEWS.find((option) => option.id === view) ?? VIEWS[0];
  const shown = buckets[view].slice(0, SHOWN);

  return (
    <section className="mt-10 w-full max-w-[720px] md:mt-16">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-1">
        {/* The heading names the rows under it, so it follows the view rather
            than standing over all three: "Continue working" above a list of
            live apps is naming something else. */}
        <h2 className="text-[17px] font-semibold tracking-tight text-ink md:text-lg">
          {current.heading}
        </h2>

        <div className="flex items-center gap-2">
          {/* The count rides on the selected chip only. Three counts side by
              side is a readout; one is an answer to the question the press just
              asked — how many of these do I have. */}
          {/* aria-pressed rather than a tablist, and the same control the
              Projects page draws. role="tab" owes the reader a tabpanel to
              point at, and there is none here — the rows below are the section
              they were always in, filtered. A pressed toggle is what this
              actually is. */}
          <div
            role="group"
            aria-label="Which apps to show"
            className="flex items-center gap-1 rounded-full border border-line/[0.07] bg-layer/[0.03] p-1"
          >
            {VIEWS.map((option) => {
              const Icon = option.icon;
              const selected = option.id === view;
              return (
                <button
                  key={option.id}
                  aria-pressed={selected}
                  onClick={() => setView(option.id)}
                  className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] transition-colors ${
                    selected
                      ? "bg-layer/[0.08] text-ink"
                      : "text-muted hover:bg-layer/[0.04] hover:text-ink"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {option.label}
                  {selected && <span className="text-muted">({buckets[option.id].length})</span>}
                </button>
              );
            })}
          </div>

          {/* Always, and pointed at the tab of the Projects page that continues
              whatever is on screen. It was shown only once there were more than
              three projects, on the reasoning that three rows already showed
              everything — which was true and beside the point: it made the
              Projects page reachable only from a dashboard that no longer
              needed it, and unreachable from the one that did. Archived apps,
              the search, and delete all live behind this link. */}
          <Link
            href={`/dashboard/projects?filter=${current.filter}`}
            className="flex h-8 shrink-0 items-center rounded-lg px-2 text-[13px] text-muted transition-colors hover:bg-layer/[0.04] hover:text-ink"
          >
            View all →
          </Link>
        </div>
      </div>

      <div className="mt-3 space-y-1 md:mt-4">
        {error && <p className="py-8 text-center text-sm text-danger">{error}</p>}

        {!error && shown.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-muted">{EMPTY[view]}</p>
        )}

        {shown.map((row) => {
          const project = projects.find((candidate) => candidate.id === row.id);
          /* Ranked but not loaded yet. It appears on the next read rather than
             as a row with no name in it. */
          if (!project) return null;

          const live = isPublished(project) || isPublishedProject(row);
          /* The badge states a fact and the link needs an address, which are
             not the same question: a live row whose slug has not come back
             should still say it is live rather than quietly look unpublished.
             Same split as the Projects page. */
          const address = live ? row.slug : null;
          /* Published is a list of sites, so a row in it opens the site. Every
             other view is a list of work, and work opens in the workspace.
             That is the whole difference between the two, and it is why this is
             an anchor there and a button everywhere else — the row goes where
             the view says it goes. */
          const toLive = view === "published" && address !== null;

          const inside = (
            <>
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
                  {live && (
                    <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                      Published
                    </span>
                  )}
                </span>
                {/* Where it went, on the view that is about where things went.
                    Somebody looking at Live apps wants the address, and
                    "updated 3 days ago" is not it. The other views keep the
                    timestamp. */}
                <span className="mt-1 block truncate text-[13px] text-muted">
                  {toLive && address ? (
                    <>
                      {/* The path alone on a phone. The host is the same on
                          every row, so at this width it is what survives the
                          truncation while the slug — the only half that says
                          which site this is — gets cut. */}
                      <span className="sm:hidden">{publishedShortLabel(address)}</span>
                      <span className="hidden sm:inline">{publishedLabel(address)}</span>
                    </>
                  ) : (
                    updatedAgo(project.updated_at)
                  )}
                </span>
              </span>
            </>
          );

          const rowClass = "flex min-w-0 flex-1 items-center gap-4 text-left";

          return (
            <div
              key={row.id}
              className="flex items-center gap-4 rounded-2xl px-3 py-3 transition-colors hover:bg-layer/[0.03]"
            >
              {toLive && address ? (
                <a
                  href={publishedUrl(address)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${project.name}, ${publishedLabel(address)}`}
                  className={rowClass}
                >
                  {inside}
                </a>
              ) : (
                <button
                  /* Straight to the preview. Opening an app from this list means
                     wanting to look at it, not to talk about it — the conversation
                     is one close away underneath, and the sheet is raised again
                     from there whenever it is wanted.

                     The opening itself is recorded on arrival, by the workspace,
                     rather than here — every other way into an app would need its
                     own copy of this line otherwise. See Workspace.tsx. */
                  onClick={() => router.push(`/dashboard/project/${project.id}?view=preview`)}
                  className={rowClass}
                >
                  {inside}
                </button>
              )}

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
