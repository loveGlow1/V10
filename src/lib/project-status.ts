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

/* The statuses that mean an app is live.
 *
 * Nothing writes either of them yet. The row's default is "Draft", /api/build
 * writes "Building" and "Failed", the orchestrator writes "Building" or
 * "Failed", and a finished build writes "Built" — a page that exists but has
 * not been put anywhere. So isPublishedStatus is false for every row that
 * exists today, and the publish step that would set one of these has not been
 * built (see the credit model's REDEPLOY_COST, which is waiting on it).
 *
 * Kept as the contract that step will satisfy rather than quietly removed: the
 * dashboard's "Published" filter, the Manage pane's Published row and the
 * redeploy price all already read it. */
export const PUBLISHED_STATUSES = ["Live", "Published"];

export function isPublishedStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && PUBLISHED_STATUSES.includes(status);
}
