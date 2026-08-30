/* Whether a project is live.
 *
 * Lives here rather than beside the React context that used to own it because
 * the server needs the same answer. Pricing a publish depends on whether the
 * project is already published — a first publish provisions a repo, a
 * subdomain and hosting; a redeploy pushes a commit — and that decision has to
 * be made on the server from the stored row, never from what a caller claims.
 *
 * A plain module with no React and no Supabase client, so an API route can
 * import it without pulling a browser bundle in behind it. */

/** "Published" is a status the app can set; everything else is still being built. */
export const PUBLISHED_STATUSES = ["Live", "Published"];

export function isPublishedStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && PUBLISHED_STATUSES.includes(status);
}
