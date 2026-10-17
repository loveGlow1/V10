/* The chat's "Connect your database" button, as a link a stored message can carry.
 *
 * Stored as an ordinary address so it survives a reload and passes the same
 * http(s) filter every other chip does — and opens the right panel even when
 * followed from somewhere else. The workspace recognises it and opens the
 * Database panel in place instead of a new tab. Kept apart from page-data.ts so
 * the client can import it without pulling in the server's database code. */

import { SITE_URL } from "@/lib/site";

export const CONNECT_DATABASE_LABEL = "Connect your database";

/** Where the Database panel is, for one project. */
export function connectDatabaseHref(projectId: string): string {
  return `${SITE_URL}/dashboard/project/${encodeURIComponent(projectId)}?view=database`;
}

/** Whether a stored link is the one that opens the Database panel. */
export function isConnectDatabaseHref(href: string): boolean {
  try {
    const url = new URL(href);
    return /^\/dashboard\/project\/[^/]+$/.test(url.pathname) && url.searchParams.get("view") === "database";
  } catch {
    return false;
  }
}

/* ── Straight to Supabase ────────────────────────────────────────────────
 *
 * The chat's connect button used to open the Database panel, where a second
 * button started the sign-in. One press is simpler: this goes directly to
 * Supabase's sign-in (the authorize route), and Supabase sends the person
 * back to the panel to pick or create a project. Stored as a full address,
 * because the thread drops anything that is not http(s); the chat follows it
 * by its path, so the sign-in starts on the host the person is signed in to. */
export const CONNECT_SUPABASE_LABEL = "Connect Supabase";

export function connectSupabaseHref(projectId: string): string {
  return `${SITE_URL}/api/integrations/supabase/authorize?projectId=${encodeURIComponent(projectId)}`;
}

/** The same address as a path, to follow on whatever host this page is on. */
export function connectSupabasePath(href: string): string {
  const url = new URL(href, "https://quickstark.invalid");
  return `${url.pathname}${url.search}`;
}

/** Whether a stored link starts the Supabase sign-in. */
export function isConnectSupabaseHref(href: string): boolean {
  try {
    return new URL(href, "https://quickstark.invalid").pathname === "/api/integrations/supabase/authorize";
  } catch {
    return false;
  }
}
