"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, Plus } from "lucide-react";

import { avatarFor } from "../projectColours";
import { useProjects } from "../ProjectsContext";

export default function ProjectSwitcher({
  onSelectedChange,
}: {
  onSelectedChange?: (name: string | null) => void;
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

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;

    setSaving(true);
    const created = await create(name);
    setSaving(false);
    if (!created) return;

    setDraft("");
    setCreating(false);
    setOpen(false);
  }

  const label = loading ? "Loading…" : selected?.name ?? "No project yet";

  return (
    <div ref={rootRef} className="relative mt-9">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-[42px] w-[210px] max-w-[calc(100vw-40px)] items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 text-sm text-white transition-colors hover:bg-white/[0.07]"
      >
        <span
          className={`h-4 w-4 shrink-0 rounded-full bg-gradient-to-br ${
            selected ? avatarFor(selected.id) : "from-white/20 to-white/10"
          }`}
        />
        <span className="truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#8F939A]" />
      </button>

      <AnimatePresence>
        {open && (
          /* The centring lives on this wrapper: motion writes its own transform
             on the element it animates, which would drop -translate-x-1/2. */
          <div className="absolute left-1/2 top-[calc(100%+8px)] z-50 w-[280px] max-w-[calc(100vw-32px)] -translate-x-1/2">
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            role="menu"
            aria-label="Projects"
            className="w-full overflow-hidden rounded-2xl border border-white/[0.09] bg-[#141416] p-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.7)]"
          >
            {projects.map((project) => (
              <button
                key={project.id}
                role="menuitem"
                onClick={() => {
                  select(project.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
              >
                <span
                  className={`h-8 w-8 shrink-0 rounded-full bg-gradient-to-br ${avatarFor(project.id)}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{project.name}</span>
                  {/* Projects are owner-scoped and there is no sharing yet, so the
                      owner is the only member — stated, not counted. */}
                  <span className="block truncate text-[13px] text-[#8F939A]">Owner · 1 member</span>
                </span>
                {project.id === selectedId && (
                  <Check className="h-4 w-4 shrink-0 text-[#34F5A0]" />
                )}
              </button>
            ))}

            {!loading && !error && projects.length === 0 && !creating && (
              <p className="px-3 py-2.5 text-[13px] text-[#8F939A]">
                No projects yet. Create the first one below.
              </p>
            )}

            {error && <p className="px-3 py-2.5 text-[13px] text-[#FF6B6B]">{error}</p>}

            {creating ? (
              <form onSubmit={createProject} className="p-1.5">
                <input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Project name"
                  aria-label="Project name"
                  className="h-10 w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 text-sm text-white outline-none placeholder:text-[#6F737A] focus:border-white/25"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={saving || !draft.trim()}
                    className="rounded-lg bg-white px-3 py-1.5 text-[13px] font-medium text-[#0d0d0f] transition-colors hover:bg-white/90 disabled:opacity-50"
                  >
                    {saving ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setDraft("");
                    }}
                    className="rounded-lg px-3 py-1.5 text-[13px] text-[#C7CAD0] transition-colors hover:bg-white/[0.05]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                role="menuitem"
                onClick={() => setCreating(true)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06] ${
                  projects.length > 0 ? "mt-1 border-t border-white/[0.06] pt-3" : ""
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                  <Plus className="h-4 w-4 text-[#C7CAD0]" />
                </span>
                <span className="text-sm text-white">Create new project</span>
              </button>
            )}
          </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
