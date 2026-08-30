"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { isPublishedStatus } from "@/lib/project-status";

export type Project = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
  /* Written by the build orchestrator when a build finishes — see
     n8n/README.md. Null on a project that has not been built yet, which is
     every project the moment it is named. */
  intent: string | null;
  preview_url: string | null;
  repo_url: string | null;
  admin_url: string | null;
  last_build_at: string | null;
};

/* The orchestrator's answer to one build, as /api/build passes it on. */
export type BuildOutcome = {
  message: string;
  status: string;
  intent: string;
  links: { preview: string; repo: string; admin: string };
  configKeys: Record<string, string>;
};

/* Every read asks for the same columns. Written once so a column added to the
   type cannot be missed in one of the two queries below. */
const COLUMNS =
  "id, name, status, updated_at, intent, preview_url, repo_url, admin_url, last_build_at";

/* The projects table is the only place a project exists, so one loader serves
   the switcher and the list below it — otherwise creating a project in one
   would leave the other showing yesterday's answer. */
type ProjectsValue = {
  projects: Project[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selected: Project | null;
  select: (id: string) => void;
  create: (name: string) => Promise<Project | null>;
  rename: (id: string, name: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  /** Runs a build for a project and folds the result back into the list. */
  build: (id: string, prompt: string) => Promise<BuildOutcome>;
};

const ProjectsContext = createContext<ProjectsValue | null>(null);

export function useProjects() {
  const value = useContext(ProjectsContext);
  if (!value) throw new Error("useProjects must be used inside ProjectsProvider");
  return value;
}

function describe(error: { code?: string; message: string }) {
  if (error.code === "42P01") {
    return "The projects table does not exist yet — run supabase/schema.sql in the SQL editor.";
  }
  return error.message;
}

/* The statuses themselves live in @/lib/project-status, because /api/credits/spend
   needs the same answer and cannot import a "use client" module. Re-exported
   here so existing callers keep their import. */
export { PUBLISHED_STATUSES } from "@/lib/project-status";

export function isPublished(project: Project) {
  return isPublishedStatus(project.status);
}

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const { data, error: queryError } = await createSupabaseBrowserClient()
      .from("projects")
      .select(COLUMNS)
      .order("updated_at", { ascending: false });

    setLoading(false);
    if (queryError) {
      setError(describe(queryError));
      return;
    }
    setError(null);
    const rows = (data ?? []) as unknown as Project[];
    setProjects(rows);
    setSelectedId((current) => current ?? rows[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (name: string): Promise<Project | null> => {
      if (!isSupabaseConfigured) return null;
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Your session is still loading — try again in a moment.");
        return null;
      }

      const { data, error: insertError } = await supabase
        .from("projects")
        .insert({ user_id: user.id, name })
        .select(COLUMNS)
        .single();

      if (insertError) {
        setError(describe(insertError));
        return null;
      }
      setError(null);
      const created = data as unknown as Project | null;
      if (created?.id) {
        setProjects((current) => [created, ...current]);
        setSelectedId(created.id);
        return created;
      }
      // The row was written but not returned; re-read rather than guess.
      await load();
      return null;
    },
    [load],
  );

  const rename = useCallback(async (id: string, name: string) => {
    if (!isSupabaseConfigured) return false;
    const { error: updateError } = await createSupabaseBrowserClient()
      .from("projects")
      .update({ name })
      .eq("id", id);

    if (updateError) {
      setError(describe(updateError));
      return false;
    }
    setError(null);
    setProjects((current) =>
      current.map((project) => (project.id === id ? { ...project, name } : project)),
    );
    return true;
  }, []);

  const remove = useCallback(async (id: string) => {
    if (!isSupabaseConfigured) return false;
    const { error: deleteError } = await createSupabaseBrowserClient()
      .from("projects")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(describe(deleteError));
      return false;
    }
    setError(null);
    setProjects((current) => {
      const next = current.filter((project) => project.id !== id);
      setSelectedId((selected) => (selected === id ? next[0]?.id ?? null : selected));
      return next;
    });
    return true;
  }, []);

  /* Starting a build is a server matter: /api/build holds the orchestrator's
     address, checks the project is yours, and answers with the row it wrote.
     Folding that row back in here is what makes the preview appear in the other
     half of the workspace without a reload.

     Errors are thrown rather than swallowed into `error` — the chat panel shows
     a failed build in the conversation, next to the message that caused it,
     rather than as a banner over the whole list. */
  const build = useCallback(async (id: string, prompt: string): Promise<BuildOutcome> => {
    const response = await fetch("/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: id, prompt }),
    });

    const payload = (await response.json().catch(() => null)) as {
      build?: BuildOutcome;
      project?: Project | null;
      error?: string;
    } | null;

    if (!response.ok || !payload?.build) {
      throw new Error(payload?.error ?? "The build could not be started.");
    }

    if (payload.project) {
      const row = payload.project;
      setProjects((current) =>
        current.map((project) => (project.id === row.id ? { ...project, ...row } : project)),
      );
    }

    return payload.build;
  }, []);

  /* The open-workspace strip is a view of these rows, so it is reconciled here
     rather than in the strip itself: an app renamed anywhere gets its tab
     relabelled, and one deleted anywhere loses its tab, without the row above
     having to know where the projects list came from.

     Skipped while the first read is in flight — an empty list mid-flight would
     close every tab in the strip and lose the session's work. */
  const { sync: syncTabs } = useWorkspaceTabs();
  useEffect(() => {
    if (loading) return;
    syncTabs(projects.map((project) => ({ id: project.id, name: project.name })));
  }, [projects, loading, syncTabs]);

  const value = useMemo<ProjectsValue>(
    () => ({
      projects,
      loading,
      error,
      selectedId,
      selected: projects.find((project) => project.id === selectedId) ?? null,
      select: setSelectedId,
      create,
      rename,
      remove,
      build,
    }),
    [projects, loading, error, selectedId, create, rename, remove, build],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}
