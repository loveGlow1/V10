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
