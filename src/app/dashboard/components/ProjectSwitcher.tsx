"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, Plus, Settings, UserPlus } from "lucide-react";

import { avatarFor } from "../projectColours";
import { useProjects } from "../ProjectsContext";

export default function ProjectSwitcher({
  onSelectedChange,
  onOpenSettings,
}: {
  onSelectedChange?: (name: string | null) => void;
  /* Settings and Invite both open the same panel, on different panes — the
     switcher only says which, since the panel belongs to the page. */
  onOpenSettings?: (section: "project" | "members") => void;
}) {
  const { projects, loading, error, selectedId, selected, select, create } = useProjects();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onSelectedChange?.(selected?.name ?? null);
  }, [selected, onSelectedChange]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /* A form with no in-flight guard at all: Enter and a click on Save are two
     submits, and both created a project. Synchronous, for the same reason as
     the send button — `saving` is state and settles a tick too late. */
  const inFlight = useRef(false);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name || inFlight.current) return;

    inFlight.current = true;
    setSaving(true);
    const created = await create(name);
    inFlight.current = false;
    setSaving(false);
    if (!created) return;

    setDraft("");
    setCreating(false);
    setOpen(false);
  }

  const label = loading ? "Loading…" : selected?.name ?? "No project yet";

  return (
    <div ref={rootRef} className="relative mt-9 hidden md:block">
      {/* Sized to the name rather than to a fixed 210px: a switcher that is
          mostly empty space reads as a field waiting to be filled. */}
      <button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="mx-auto flex h-[38px] max-w-[calc(100vw-40px)] items-center gap-2 rounded-full border border-line/[0.09] bg-layer/[0.05] pl-2 pr-3 text-sm text-ink transition-colors hover:bg-layer/[0.08]"
      >
        <span
          className={`h-[22px] w-[22px] shrink-0 rounded-full bg-gradient-to-br ${
            selected ? avatarFor(selected.id) : "from-white/20 to-white/10"
          }`}
        />
        <span className="max-w-[190px] truncate font-medium">{label}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          /* The centring lives on this wrapper: motion writes its own transform
             on the element it animates, which would drop -translate-x-1/2. */
          <div className="absolute left-1/2 top-[calc(100%+8px)] z-50 w-[320px] max-w-[calc(100vw-32px)] -translate-x-1/2">
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            role="menu"
            aria-label="Projects"
            className="w-full overflow-hidden rounded-2xl border border-line/[0.09] bg-panel p-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.7)]"
          >
            {projects.map((project) => {
              const current = project.id === selectedId;
              return (
                <div key={project.id}>
                  <button
                    role="menuitem"
                    onClick={() => {
                      select(project.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-layer/[0.06]"
                  >
                    <span
                      className={`h-8 w-8 shrink-0 rounded-full bg-gradient-to-br ${avatarFor(project.id)}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {project.name}
                      </span>
                      {/* Projects are owner-scoped and there is no sharing yet, so the
                          owner is the only member — stated, not counted. */}
                      <span className="block truncate text-[13px] text-muted">
                        Owner · 1 member
                      </span>
                    </span>
                    {current && <Check className="h-4 w-4 shrink-0 text-accent" />}
                  </button>

                  {/* Under the one you are in, and only that one: settings and
                      invitations act on a project, so they belong to the row that
                      says which project is meant rather than to the menu. */}
                  {current && (
                    <div className="mb-1 flex items-center gap-2 px-2 pb-1">
                      <button
                        onClick={() => {
                          setOpen(false);
                          onOpenSettings?.("project");
                        }}
                        className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-line/[0.08] bg-layer/[0.04] text-[13px] text-ink transition-colors hover:bg-layer/[0.08]"
                      >
                        <Settings className="h-4 w-4 text-soft" />
                        Settings
                      </button>
                      <button
                        onClick={() => {
                          setOpen(false);
                          onOpenSettings?.("members");
                        }}
                        className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-line/[0.08] bg-layer/[0.04] text-[13px] text-ink transition-colors hover:bg-layer/[0.08]"
                      >
                        <UserPlus className="h-4 w-4 text-soft" />
                        Invite members
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {!loading && !error && projects.length === 0 && !creating && (
              <p className="px-3 py-2.5 text-[13px] text-muted">
                No projects yet. Create the first one below.
              </p>
            )}

            {error && <p className="px-3 py-2.5 text-[13px] text-danger">{error}</p>}

            {creating ? (
              <form onSubmit={createProject} className="p-1.5">
                <input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Project name"
                  aria-label="Project name"
                  className="h-10 w-full rounded-xl border border-line/[0.1] bg-layer/[0.04] px-3 text-sm text-ink outline-none placeholder:text-faint focus-visible:border-line/25"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={saving || !draft.trim()}
                    className="rounded-lg bg-solid px-3 py-1.5 text-[13px] font-medium text-onSolid transition-colors hover:bg-layer/90 disabled:opacity-50"
                  >
                    {saving ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setDraft("");
                    }}
                    className="rounded-lg px-3 py-1.5 text-[13px] text-soft transition-colors hover:bg-layer/[0.05]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                role="menuitem"
                onClick={() => setCreating(true)}
                className={`flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3 transition-colors hover:bg-layer/[0.06] ${
                  projects.length > 0 ? "mt-1 border-t border-line/[0.06] pt-3" : ""
                }`}
              >
                <Plus className="h-4 w-4 shrink-0 text-soft" />
                <span className="text-sm text-ink">Create new project</span>
              </button>
            )}
          </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
