"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LayoutGrid, Laptop, MoreHorizontal, Radio } from "lucide-react";

import { avatarFor } from "../projectColours";
import { isPublished, useProjects, type Project } from "../ProjectsContext";

type Filter = "all" | "apps" | "published";

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

function RowMenu({ project }: { project: Project }) {
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

export default function ProjectList() {
  const router = useRouter();
  const { projects, loading, error } = useProjects();
  const [filter, setFilter] = useState<Filter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filterOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [filterOpen]);

  const shown = projects.filter((project) => {
    if (filter === "published") return isPublished(project);
    if (filter === "apps") return !isPublished(project);
    return true;
  });

  const tabs: { id: Filter; label: string; icon: typeof LayoutGrid }[] = [
    { id: "all", label: `All (${projects.length})`, icon: LayoutGrid },
    { id: "apps", label: "Apps", icon: Laptop },
    { id: "published", label: "Published", icon: Radio },
  ];
  const current = tabs.find((tab) => tab.id === filter) ?? tabs[0];

  return (
    /* Everything built so far, on both sizes. It used to be desktop-only: three
       filter pills above a short list cost more room than they saved on a phone.
       They are a menu now rather than a row, which is one control instead of
       three, so the filter comes to the phone with the list. */
    <section className="mt-10 w-full max-w-[720px] md:mt-16">
      <div className="flex items-end justify-between gap-4 px-1">
        <h2 className="text-[17px] font-semibold tracking-tight text-ink md:text-lg">
          Continue working
        </h2>

        <div className="relative shrink-0" ref={filterRef}>
          <button
            onClick={() => setFilterOpen((open) => !open)}
            aria-expanded={filterOpen}
            aria-haspopup="menu"
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted transition-colors hover:bg-layer/[0.04] hover:text-ink"
          >
            <current.icon className="h-3.5 w-3.5" />
            {current.label}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${filterOpen ? "rotate-180" : ""}`}
            />
          </button>

          {filterOpen && (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+6px)] z-50 w-[190px] overflow-hidden rounded-xl border border-line/[0.09] bg-panel p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.7)]"
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = filter === tab.id;
                return (
                  <button
                    key={tab.id}
                    role="menuitem"
                    onClick={() => {
                      setFilter(tab.id);
                      setFilterOpen(false);
                    }}
                    className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors ${
                      active ? "bg-layer/[0.06] text-ink" : "text-muted hover:bg-layer/[0.04] hover:text-ink"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1 md:mt-4">
        {loading && <p className="py-8 text-center text-sm text-muted">Loading your projects…</p>}

        {error && <p className="py-8 text-center text-sm text-danger">{error}</p>}

        {!loading &&
          !error &&
          shown.map((project) => (
            <div
              key={project.id}
              className="flex items-center gap-4 rounded-2xl px-3 py-3 transition-colors hover:bg-layer/[0.03]"
            >
              <button
                onClick={() => router.push(`/dashboard/project/${project.id}`)}
                className="flex min-w-0 flex-1 items-center gap-4 text-left"
              >
                {/* Nothing screenshots a build yet, so the tile is the project's
                    own colour and initial rather than a stand-in preview. */}
                <span
                  className={`flex h-[70px] w-[110px] shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-lg font-semibold text-ink/90 ${avatarFor(
                    project.id,
                  )}`}
                >
                  {project.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
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
              <RowMenu project={project} />
            </div>
          ))}

        {!loading && !error && shown.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-muted">
              {projects.length === 0
                ? "No apps yet"
                : filter === "published"
                  ? "Nothing published yet"
                  : "Everything you have built is published"}
            </p>
            <p className="mx-auto mt-1.5 max-w-[320px] text-[13px] leading-relaxed text-muted/70">
              {projects.length === 0
                ? "Describe what you want in the box above to start your first one."
                : filter === "published"
                  ? "An app appears here once you publish it."
                  : "There is nothing left in progress."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
