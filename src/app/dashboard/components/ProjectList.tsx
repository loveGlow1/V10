"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Laptop, MoreHorizontal, Radio } from "lucide-react";

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
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8F939A] transition-colors hover:bg-white/[0.06] hover:text-white"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[220px] overflow-hidden rounded-xl border border-white/[0.09] bg-[#141416] p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.7)]"
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
                className="h-9 w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-2.5 text-sm text-white outline-none focus-visible:border-white/25"
              />
              <button
                type="submit"
                className="mt-2 w-full rounded-lg bg-white px-3 py-1.5 text-[13px] font-medium text-[#0d0d0f] transition-colors hover:bg-white/90"
              >
                Save
              </button>
            </form>
          ) : confirming ? (
            <div className="p-1">
              <p className="px-1.5 pb-2 pt-1 text-[13px] text-[#C7CAD0]">
                Delete {project.name}? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => remove(project.id)}
                  className="flex-1 rounded-lg bg-[#FF6B6B] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#ff5252]"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="flex-1 rounded-lg border border-white/[0.09] px-3 py-1.5 text-[13px] text-[#C7CAD0] transition-colors hover:bg-white/[0.05]"
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
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-white transition-colors hover:bg-white/[0.06]"
              >
                Rename
              </button>
              <button
                role="menuitem"
                onClick={() => setConfirming(true)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-[#FF6B6B] transition-colors hover:bg-[#FF6B6B]/10"
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

  return (
    <section className="mt-16 w-full max-w-[720px]">
      <div className="flex justify-center">
        <div className="flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.02] p-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                aria-pressed={active}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${
                  active
                    ? "border border-white/25 bg-white/[0.06] text-white"
                    : "border border-transparent text-[#8F939A] hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-8 space-y-1">
        {loading && <p className="py-8 text-center text-sm text-[#8F939A]">Loading your projects…</p>}

        {error && <p className="py-8 text-center text-sm text-[#FF6B6B]">{error}</p>}

        {!loading &&
          !error &&
          shown.map((project) => (
            <div
              key={project.id}
              className="flex items-center gap-4 rounded-2xl px-3 py-3 transition-colors hover:bg-white/[0.03]"
            >
              <button
                onClick={() => router.push(`/dashboard/project/${project.id}`)}
                className="flex min-w-0 flex-1 items-center gap-4 text-left"
              >
                {/* Nothing screenshots a build yet, so the tile is the project's
                    own colour and initial rather than a stand-in preview. */}
                <span
                  className={`flex h-[70px] w-[110px] shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-lg font-semibold text-white/90 ${avatarFor(
                    project.id,
                  )}`}
                >
                  {project.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] text-white">{project.name}</span>
                    {isPublished(project) && (
                      <span className="shrink-0 rounded-full bg-[#34F5A0]/10 px-2 py-0.5 text-[11px] font-medium text-[#34F5A0]">
                        Published
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block truncate text-[13px] text-[#8F939A]">
                    {updatedAgo(project.updated_at)}
                  </span>
                </span>
              </button>
              <RowMenu project={project} />
            </div>
          ))}

        {!loading && !error && shown.length === 0 && (
          <p className="py-10 text-center text-sm text-[#8F939A]">
            {projects.length === 0
              ? "Nothing built yet. Describe an app above to start one."
              : filter === "published"
                ? "No project has been published yet."
                : "Everything you have built is already published."}
          </p>
        )}
      </div>
    </section>
  );
}
