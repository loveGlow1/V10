"use client";

import { useSyncExternalStore } from "react";

/* The open apps, shared by the tab bar on Home and the one inside a workspace.
   A project becomes a tab by being opened, and stops being one by being closed —
   the same way a browser treats a tab, which is the behaviour the reference has.

   sessionStorage rather than localStorage: the strip is a record of what this
   sitting is working on, so a new window starts on a clean Home instead of
   inheriting yesterday's row of apps. */
export type OpenTab = { id: string; name: string };

const KEY = "quickstark.workspace.tabs";
const EMPTY: OpenTab[] = [];

let tabs: OpenTab[] = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function persist() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(tabs));
  } catch {
    // Private mode and blocked site data both throw here. The strip still works
    // for this page; it just will not survive a reload.
  }
}

/* Deferred to the first subscribe, which runs in an effect: reading storage
   during render would return one answer on the server and another in the
   browser, which is a hydration mismatch. */
function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (!Array.isArray(parsed)) return;
    const restored = parsed.filter(
      (tab): tab is OpenTab =>
        !!tab &&
        typeof (tab as OpenTab).id === "string" &&
        typeof (tab as OpenTab).name === "string",
    );
    if (restored.length > 0) tabs = restored;
  } catch {
    // Unreadable or corrupt: start empty rather than throw on a render path.
  }
}

export function openTab(tab: OpenTab) {
  hydrate();
  const existing = tabs.find((open) => open.id === tab.id);
  if (existing) {
    // Already open — only a rename is worth a write.
    if (existing.name === tab.name) return;
    tabs = tabs.map((open) => (open.id === tab.id ? tab : open));
  } else {
    tabs = [...tabs, tab];
  }
  persist();
  emit();
}

export function closeTab(id: string) {
  hydrate();
  if (!tabs.some((tab) => tab.id === id)) return;
  tabs = tabs.filter((tab) => tab.id !== id);
  persist();
  emit();
}

function subscribe(listener: () => void) {
  const before = tabs;
  hydrate();
  listeners.add(listener);
  // React reads the snapshot again right after this returns, so a hydrate that
  // found something is picked up without a second notification.
  if (before !== tabs) emit();
  return () => {
    listeners.delete(listener);
  };
}

export function useOpenTabs(): OpenTab[] {
  return useSyncExternalStore(
    subscribe,
    () => tabs,
    () => EMPTY,
  );
}
