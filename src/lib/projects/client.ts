"use client";

import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

/* The access token the helpers in ./queries.ts take.
 *
 * They accept a token rather than a client so the same functions serve a route
 * handler and a browser: the token is the only thing that differs. This is the
 * browser half of that — the session already lives in a cookie, put there by
 * createSupabaseBrowserClient, so nothing here fetches or stores anything.
 *
 * Null when Supabase is not configured or nobody is signed in. Callers render
 * nothing rather than an error: the dashboard layout has already redirected a
 * signed-out visitor, so a null here is a session still settling. */
export async function browserAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  return data.session?.access_token ?? null;
}

/** What a row shows for a project's last-opened time. */
export function openedAgo(iso: string) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Opened recently";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "Opened just now";
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
  return `Opened ${value} ${unit[1]}${value === 1 ? "" : "s"} ago`;
}

/* pinned first, then most recently opened. The same order the index and the
   query use, applied to a list that has just been changed in place — a pin is
   not worth a round trip to see move. */
export function byRank<T extends { pinned: boolean; last_opened_at: string }>(a: T, b: T) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return Date.parse(b.last_opened_at) - Date.parse(a.last_opened_at);
}

/* Mutations go through /api/projects/[id] rather than straight to PostgREST.
   The reads above do go straight there — a read is a read and RLS answers it —
   but a write wants one place that decides what a change means, and the route
   is that place. Both surfaces call these, so pin means the same thing on the
   dashboard as it does on the Projects page.

   Errors are returned rather than thrown: every caller here has already changed
   its own list optimistically, and what it needs is a reason to put back what
   was there, not an exception to catch. */
async function send(projectId: string, init: RequestInit): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, init);
  } catch {
    return "That did not reach the server. Check your connection and try again.";
  }
  if (response.ok) return null;

  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? "That change did not go through.";
}

export type ProjectPatch = {
  pinned?: boolean;
  archived?: boolean;
  name?: string;
  restore?: boolean;
};

export function patchProject(projectId: string, patch: ProjectPatch) {
  return send(projectId, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function deleteProject(projectId: string) {
  return send(projectId, { method: "DELETE" });
}

/* The same rule listProjects filters on, applied to a row already in hand: a
   project is archived if it was archived by hand, or if it is unpinned and has
   not been opened in thirty days. Mirrors INACTIVE_DAYS in ./queries.ts — the
   query decides which rows arrive, this decides what the menu on one of them
   should offer, and both have to say the same thing about the same row. */
const INACTIVE_MS = 30 * 86400_000;

export function isArchived(row: { pinned: boolean; last_opened_at: string; archived_at: string | null }) {
  if (row.archived_at !== null) return true;
  if (row.pinned) return false;
  return Date.parse(row.last_opened_at) < Date.now() - INACTIVE_MS;
}
