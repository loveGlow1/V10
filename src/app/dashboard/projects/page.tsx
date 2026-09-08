"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Pin, Search } from "lucide-react";

import PageThumbnail from "../components/PageThumbnail";
import ProjectLifecycleMenu from "../components/ProjectLifecycleMenu";
import ScrollToEnds from "../components/ScrollToEnds";
import { ProjectsProvider, useProjects } from "../ProjectsContext";
import {
  browserAccessToken,
  deleteProject,
  isArchived,
  openedAgo,
  patchProject,
} from "@/lib/projects/client";
import {
  listProjects,
  touchProject,
  type ProjectFilter,
  type ProjectListItem,
} from "@/lib/projects/queries";
import { isPublishedProject } from "@/lib/project-status";
import { publishedLabel, publishedShortLabel, publishedUrl } from "@/lib/publish/naming";
import { safeHttpUrl } from "@/lib/safe-url";

/* Everything, with the filters the dashboard's three rows do not need.
 *
 * The dashboard shows what is worth resuming and stops at three. Past that a
 * person is browsing rather than resuming, and browsing wants somewhere to
 * browse: one page, one noun, with Active / Archived / All as a filter on it
 * rather than as three destinations. Archived is a state of a project, not a
 * place projects go.
 *
 * Delete lives here and only here. It is the one action on a project that a
 * mis-tap should not be able to reach from under the composer. It is still soft
 * — a deleted_at stamp, a row filtered out of every query, ten seconds of undo
 * in the corner and thirty days of it in the database. */

const FILTERS: { id: ProjectFilter; label: string }[] = [
  { id: "active", label: "Active" },
  /* Live sits between Active and Archived rather than at the end: it is the
     one people arrive at this page looking for by name, from Published Apps in
     the sidebar, and a tab you have to read past three others to find is a tab
     that gets missed. */
  { id: "published", label: "Live" },
  { id: "archived", label: "Archived" },
  { id: "all", label: "All" },
];

/* Long enough that typing a name does not fire a query per letter, short enough
   that the list has caught up by the time you stop to look at it. */
const SEARCH_DEBOUNCE_MS = 250;

/** How long the undo stays reachable in the corner. The database keeps it far longer. */
const UNDO_MS = 10_000;

const EMPTY: Record<ProjectFilter, string> = {
  active: "No active projects.",
  /* Says what to do rather than what is absent. Somebody who followed
     "Published Apps" here and found nothing has a question — how do I publish
     one — and an empty state that only reports the emptiness leaves them with
     it. */
  published: "Nothing published yet. Open a project and press Publish to put it online.",
  archived: "Nothing archived.",
  all: "No projects yet.",
};

export default function ProjectsPage() {
  /* The same provider the dashboard mounts, for the same reason: the lifecycle
     query answers which projects and in what order, and this answers what each
     row looks like — the built page behind the tile, and a rename that reaches
     the tab strip as well as the row. */
  return (
    <ProjectsProvider>
      <ProjectsScreen />
    </ProjectsProvider>
  );
}

function ProjectsScreen() {
  const router = useRouter();
  const { projects, rename: renameInList } = useProjects();

  /* Which view this page opened on, from the address.
   *
   * So "Published Apps" in the sidebar can be a link to a page rather than a
   * button that opens a page and then reaches into it. It also makes the view
   * shareable and survivable: a reload, a back button and a pasted link all
   * land where they were.
   *
   * Read once as the initial state rather than watched. The tab strip below
   * sets the filter directly, and a param that kept overriding it would fight
   * every press. */
  const params = useSearchParams();
  const requested = params.get("filter");
  const initial: ProjectFilter =
    requested === "published" || requested === "archived" || requested === "all"
      ? requested
      : "active";

  const [filter, setFilter] = useState<ProjectFilter>(initial);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);

  const token = useRef<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setSearch(typed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [typed]);

  const load = useCallback(async () => {
    token.current = await browserAccessToken();
    if (!token.current) {
      setRows([]);
      return;
    }
    try {
      const found = await listProjects({ accessToken: token.current, filter, search });
      setError(null);
      setRows(found);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "Could not read your projects.");
    }
  }, [filter, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  /* Changed in place first, told to the server after, and put back if the
     server disagrees. Pinning something and watching it sit still for a round
     trip is how a control gets pressed twice. */
  const change = useCallback(
    async (id: string, next: Partial<ProjectListItem>, patch: Parameters<typeof patchProject>[1]) => {
      const before = rows;
      setRows((current) => (current ?? []).map((row) => (row.id === id ? { ...row, ...next } : row)));

      const failure = await patchProject(id, patch);
      if (failure) {
        setError(failure);
        setRows(before);
        return;
      }
      setError(null);
      /* A pin or an archive can move a row out of the filter it is being shown
         under, so the list is re-read rather than re-sorted. */
      void load();
    },
    [rows, load],
  );

  /* Unarchiving, which is the same act as opening minus the navigation.
     touch_project clears archived_at and bumps last_opened_at in one statement,
     and only the second half brings back a project that aged out rather than one
     archived by hand: clearing the stamp alone would leave it thirty days old
     and archived again on the very next read. */
  const open = useCallback(async (id: string) => {
    if (!token.current) return;
    await touchProject(token.current, id).catch(() => {});
  }, []);

  const remove = useCallback(
    async (id: string, name: string) => {
      const before = rows;
      setRows((current) => (current ?? []).filter((row) => row.id !== id));

      const failure = await deleteProject(id);
      if (failure) {
        setError(failure);
        setRows(before);
        return;
      }
      setError(null);
      setUndo({ id, name });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
    },
    [rows],
  );

  const restore = useCallback(async () => {
    if (!undo) return;
    const id = undo.id;
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);

    const failure = await patchProject(id, { restore: true });
    if (failure) {
      setError(failure);
      return;
    }
    setError(null);
    void load();
  }, [undo, load]);

  const byId = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col px-4 pb-24 pt-8 md:pt-12">
      <Link
        href="/dashboard"
        className="inline-flex h-8 w-fit items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted transition-colors hover:bg-layer/[0.04] hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Dashboard
      </Link>

      <h1 className="mt-4 px-1 text-2xl font-semibold tracking-tight text-ink md:text-[28px]">
        Projects
      </h1>

      <div className="mt-5 flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-xl border border-line/[0.07] bg-layer/[0.03] p-1">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              onClick={() => setFilter(option.id)}
              aria-pressed={filter === option.id}
              className={`h-8 rounded-lg px-3 text-[13px] transition-colors ${
                filter === option.id
                  ? "bg-layer/[0.08] text-ink"
                  : "text-muted hover:bg-layer/[0.04] hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="relative sm:w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
            className="h-10 w-full rounded-xl border border-line/[0.07] bg-layer/[0.03] pl-9 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-muted focus-visible:border-line/25"
          />
        </div>
      </div>

      <div className="mt-4 space-y-1">
        {error && <p className="py-8 text-center text-sm text-danger">{error}</p>}

        {rows !== null &&
          rows.map((row) => {
            const project = byId.get(row.id);
            const archived = isArchived(row);
            /* The same test the dashboard and the workspace use, so a row
               cannot read as live in one place and not in another. `slug` is
               separate from it because the badge states a fact and the link
               needs an address: a published row missing its slug should still
               say it is live rather than quietly look unpublished. */
            const live = isPublishedProject(row);
            const address = live ? row.slug : null;

            return (
              <div
                key={row.id}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-layer/[0.03] sm:gap-4"
              >
                <button
                  /* The open is recorded by the workspace on arrival, not
                     here — see Workspace.tsx. */
                  onClick={() => router.push(`/dashboard/project/${row.id}?view=preview`)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-4"
                >
                  <PageThumbnail
                    projectId={row.id}
                    hasPage={Boolean(safeHttpUrl(project?.preview_url ?? null))}
                    name={row.name}
                    stamp={project?.last_build_at ?? null}
                    /* Smaller than the dashboard's tile below 640px, because
                       this row carries a control the dashboard's does not and
                       the 24px comes off the name and the address otherwise.
                       Same aspect, so the crop is the same page. */
                    className="h-[54px] w-[86px] rounded-lg sm:h-[70px] sm:w-[110px]"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      {row.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-muted" />}
                      <span className="truncate text-[15px] text-ink">{row.name}</span>
                      {live && (
                        <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                          Live
                        </span>
                      )}
                      {archived && (
                        <span className="shrink-0 rounded-full bg-layer/[0.08] px-2 py-0.5 text-[11px] font-medium text-muted">
                          Archived
                        </span>
                      )}
                    </span>
                    {/* Where it went, on the rows that went somewhere.
                        Somebody who came here from Published Apps is looking
                        for the address, and "opened 3 days ago" is not it. The
                        rest of the list keeps the timestamp. */}
                    <span className="mt-1 block truncate text-[13px] text-muted">
                      {address ? (
                        <>
                          {/* The path alone on a phone. The host is the same on
                              every row, so at this width it is what survives
                              the truncation while the slug — the only half that
                              says which site this is — gets cut. */}
                          <span className="sm:hidden">{publishedShortLabel(address)}</span>
                          <span className="hidden sm:inline">{publishedLabel(address)}</span>
                        </>
                      ) : (
                        openedAgo(row.last_opened_at)
                      )}
                    </span>
                  </span>
                </button>

                {/* A sibling of the row button rather than inside it: an
                    anchor nested in a button is invalid, and the two go to
                    different places — the row opens the workspace, this opens
                    the site itself. 36px square, so it is reachable with a
                    thumb. */}
                {address && (
                  <a
                    href={publishedUrl(address)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${row.name}, ${publishedLabel(address)}`}
                    className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-layer/[0.06] hover:text-ink sm:w-9"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}

                <ProjectLifecycleMenu
                  project={{ id: row.id, name: row.name, pinned: row.pinned, archived }}
                  onPin={(pinned) => void change(row.id, { pinned }, { pinned })}
                  onRename={(name) => {
                    setRows((current) =>
                      (current ?? []).map((item) => (item.id === row.id ? { ...item, name } : item)),
                    );
                    void renameInList(row.id, name);
                  }}
                  onArchive={(next) => {
                    if (next) {
                      void change(
                        row.id,
                        { archived_at: new Date().toISOString() },
                        { archived: true },
                      );
                      return;
                    }
                    /* Unarchiving is the same act as opening, minus the
                       navigation: only a touch brings back a project that aged
                       out rather than one archived by hand. */
                    void open(row.id).then(load);
                  }}
                  onDelete={() => void remove(row.id, row.name)}
                />
              </div>
            );
          })}

        {rows !== null && rows.length === 0 && !error && (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-muted">
              {search.trim() ? "Nothing matches that." : EMPTY[filter]}
            </p>
            {!search.trim() && filter === "active" && (
              <Link
                href="/dashboard"
                className="mx-auto mt-2 inline-block text-[13px] text-accent transition-opacity hover:opacity-80"
              >
                Start one from the dashboard →
              </Link>
            )}
          </div>
        )}
      </div>

      {/* No support button on this page, so the corner is free. The toast is
          centred, so the two never meet. */}
      <ScrollToEnds className="fixed bottom-[max(18px,env(safe-area-inset-bottom))] right-[max(18px,env(safe-area-inset-right))]" />

      {/* Ten seconds in the corner; thirty days in the database. The toast is
          the reachable half of the same undo. */}
      {undo && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 items-center gap-3 rounded-xl border border-line/[0.09] bg-panel px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.7)]"
        >
          <span className="min-w-0 flex-1 truncate text-[13px] text-soft">
            Deleted {undo.name}.
          </span>
          <button
            onClick={() => void restore()}
            className="shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-medium text-accent transition-colors hover:bg-layer/[0.06]"
          >
            Undo
          </button>
        </div>
      )}
    </main>
  );
}
