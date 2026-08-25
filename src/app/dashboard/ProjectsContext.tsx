"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

export type Project = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

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

/** "Published" is a status the app can set; everything else is still being built. */
export const PUBLISHED_STATUSES = ["Live", "Published"];

export function isPublished(project: Project) {
  return PUBLISHED_STATUSES.includes(project.status);
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
      .select("id, name, status, updated_at")
      .order("updated_at", { ascending: false });

    setLoading(false);
    if (queryError) {
      setError(describe(queryError));
      return;
    }
    setError(null);
    setProjects(data ?? []);
    setSelectedId((current) => current ?? data?.[0]?.id ?? null);
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
        .select("id, name, status, updated_at")
        .single();

      if (insertError) {
        setError(describe(insertError));
        return null;
      }
      setError(null);
      if (data?.id) {
        setProjects((current) => [data, ...current]);
        setSelectedId(data.id);
        return data;
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
    }),
    [projects, loading, error, selectedId, create, rename, remove],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}
