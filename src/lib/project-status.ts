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

/* ── Why `status` is not the answer ────────────────────────────────────────
 *
 * `status` is the BUILD lifecycle: Draft, Building, Built, Failed. Every build
 * writes it — /api/build in nine places, and the n8n orchestrator in two more
 * that this codebase does not control at all.
 *
 * So publication cannot live in it. A project published on Monday and edited on
 * Tuesday has `status` back at "Built" while its published snapshot is still
 * being served: the site is live and the row says otherwise. Everything reading
 * status would then quote the first-publish price to somebody who is already
 * live, show "Published: Not yet" beside a working URL, and drop the project
 * out of the Published filter — all while the site answers perfectly well.
 *
 * The authority is `published_at`, which only the publish route writes and no
 * build touches. Status is a label; this is the fact. */

/* Kept for rows written before publishing existed, and for the label. A publish
   still sets status to "Published" because a person reading the row wants to
   see it — but nothing DECIDES on it. */
export const PUBLISHED_STATUSES = ["Live", "Published"];

export function isPublishedStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && PUBLISHED_STATUSES.includes(status);
}

/** What a decision about publication is allowed to read. */
export type PublishState = {
  status?: string | null;
  /** Set by /api/publish and cleared by unpublishing. Nothing else writes it. */
  published_at?: string | null;
  /** The snapshot being served. Null means nothing of this project is public. */
  published_version_id?: string | null;
};

/**
 * Whether this project is live.
 *
 * Reads the fields a build cannot overwrite, and falls back to the status only
 * where those fields are absent — a row selected without them, or one from
 * before this column existed. The fallback is deliberately last: it is the
 * answer that goes stale.
 */
export function isPublishedProject(project: PublishState | null | undefined): boolean {
  if (!project) return false;
  if (project.published_version_id) return true;
  if (project.published_at) return true;
  /* Neither field present at all — an older row or a narrower select. The
     status is all there is, and it is better than nothing. */
  if (project.published_at === undefined && project.published_version_id === undefined) {
    return isPublishedStatus(project.status);
  }
  return false;
}
