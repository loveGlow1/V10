"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/* The open workspaces, the way a browser holds open tabs.

   A tab is a project someone is working in, not a message and not a build. That
   distinction is the whole rule this module exists to enforce: continuing to
   work on an app — another prompt, another build, another look at the preview —
   happens inside the tab that app already has. A second tab appears only when a
   different app does, which is the only time there are two things to switch
   between.

   The set lives in sessionStorage rather than in a table: these are the apps
   this sitting is about. A tab closed here is not a project deleted, and a
   project deleted elsewhere must not leave a tab behind — see `sync`. */

export type WorkspaceTab = {
  /** The project's id. One tab per project, which is what makes `open` idempotent. */
  id: string;
  name: string;
  /** When this workspace was first opened in this session. Orders the strip. */
  openedAt: number;
  /** Last time it was looked at. Decides which tab is dropped when the strip is full. */
  lastActiveAt: number;
};

/* A ceiling rather than an unbounded strip: past this the row is a scroll bar
   with names in it. The least recently visited tab that is not the open one
   gives way, which is the one the account has already stopped working in. */
const MAX_TABS = 10;

const STORAGE_KEY = "quickstark:workspace-tabs";

type WorkspaceTabsValue = {
  tabs: WorkspaceTab[];
  /** Project ids with a build in flight. A tab of its own is never opened for one. */
  busyIds: string[];
  /** Opens the workspace for a project, or brings its existing tab forward. */
  open: (project: { id: string; name: string }) => void;
  close: (id: string) => void;
  /** Keeps a tab's label in step with a rename. */
  rename: (id: string, name: string) => void;
  /** Drops tabs whose project no longer exists and refreshes the names of the rest. */
  sync: (projects: { id: string; name: string }[]) => void;
  /** Marks a workspace as having an active session — a build running in it. */
  setBusy: (id: string, busy: boolean) => void;
};

const WorkspaceTabsContext = createContext<WorkspaceTabsValue | null>(null);

/* Deliberately forgiving: the strip is furniture, and a surface that renders
   outside the provider should lose its tabs rather than throw the page away. */
export function useWorkspaceTabs(): WorkspaceTabsValue {
  return useContext(WorkspaceTabsContext) ?? EMPTY;
}

const NO_OP = () => {};
const EMPTY: WorkspaceTabsValue = {
  tabs: [],
  busyIds: [],
  open: NO_OP,
  close: NO_OP,
  rename: NO_OP,
  sync: NO_OP,
  setBusy: NO_OP,
};

function readStored(): WorkspaceTab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is WorkspaceTab =>
          !!entry &&
          typeof (entry as WorkspaceTab).id === "string" &&
          typeof (entry as WorkspaceTab).name === "string",
      )
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        openedAt: Number(entry.openedAt) || Date.now(),
        lastActiveAt: Number(entry.lastActiveAt) || Date.now(),
      }))
      .slice(0, MAX_TABS);
  } catch {
    // A corrupt or unreadable store is an empty strip, never a crash.
    return [];
  }
}

export function WorkspaceTabsProvider({ children }: { children: React.ReactNode }) {
  /* Empty on the first render on purpose: the server has no sessionStorage, so
     seeding from it here would hand React two different first paints. */
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const hydrated = useRef(false);

  useEffect(() => {
    const stored = readStored();
    hydrated.current = true;
    if (stored.length) setTabs(stored);
  }, []);

  /* Written back only after the read above, so an empty first render cannot
     erase the strip a reload was meant to restore. */
  useEffect(() => {
    if (!hydrated.current || typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
    } catch {
      // Private mode and a full quota both land here; the strip still works for
      // this page, it just will not survive a reload.
    }
  }, [tabs]);

  const open = useCallback((project: { id: string; name: string }) => {
    if (!project.id) return;
    setTabs((current) => {
      const now = Date.now();
      const existing = current.find((tab) => tab.id === project.id);

      /* Already open. This is the common case — every reload, every link, every
         return from Home — and it must not add a second tab for the same app. */
      if (existing) {
        return current.map((tab) =>
          tab.id === project.id
            ? { ...tab, name: project.name || tab.name, lastActiveAt: now }
            : tab,
        );
      }

      const next = [
        ...current,
        { id: project.id, name: project.name || "Untitled", openedAt: now, lastActiveAt: now },
      ];
      if (next.length <= MAX_TABS) return next;

      /* Full: the oldest visit gives way, never the one being opened. */
      const stalest = next
        .filter((tab) => tab.id !== project.id)
        .reduce((oldest, tab) => (tab.lastActiveAt < oldest.lastActiveAt ? tab : oldest));
      return next.filter((tab) => tab.id !== stalest.id);
    });
  }, []);

  const close = useCallback((id: string) => {
    setTabs((current) => current.filter((tab) => tab.id !== id));
    setBusyIds((current) => current.filter((busy) => busy !== id));
  }, []);

  const rename = useCallback((id: string, name: string) => {
    if (!name) return;
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, name } : tab)));
  }, []);

  const sync = useCallback((projects: { id: string; name: string }[]) => {
    const names = new Map(projects.map((project) => [project.id, project.name]));
    setTabs((current) => {
      const next = current
        .filter((tab) => names.has(tab.id))
        .map((tab) => {
          const name = names.get(tab.id) as string;
          return tab.name === name ? tab : { ...tab, name };
        });
      /* Same contents means same array: returning a fresh one every time the
         projects list settles would re-run every effect keyed on `tabs`. */
      const unchanged =
        next.length === current.length && next.every((tab, index) => tab === current[index]);
      return unchanged ? current : next;
    });
  }, []);

  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((current) => {
      const has = current.includes(id);
      if (busy === has) return current;
      return busy ? [...current, id] : current.filter((entry) => entry !== id);
    });
  }, []);

  const value = useMemo<WorkspaceTabsValue>(
    () => ({ tabs, busyIds, open, close, rename, sync, setBusy }),
    [tabs, busyIds, open, close, rename, sync, setBusy],
  );

  return <WorkspaceTabsContext.Provider value={value}>{children}</WorkspaceTabsContext.Provider>;
}
