import { createClient } from "@supabase/supabase-js";

/* public.projects has no thumbnail_url column — see supabase/schema.sql. The
   dashboard draws its tiles with PageThumbnail, from preview_url, rather than
   from a stored image, so there is nothing here to select. */
export type ProjectListItem = {
  id: string;
  name: string;
  pinned: boolean;
  last_opened_at: string;
  archived_at: string | null;
  /* Where a published project lives, and when it went up.
   *
   * Selected for every filter rather than only the published one, so a row can
   * say it is live wherever it appears. A list that shows a project as ordinary
   * in one view and live in another is describing two different things. */
  slug: string | null;
  published_at: string | null;
};

/* "published" is a view of the same table rather than a state a project is in.
   A published project is also active, and asking for it is asking a different
   question — where can I find the things that are live — not a fourth mutually
   exclusive bucket beside active and archived. */
export type ProjectFilter = "active" | "archived" | "all" | "published";

const INACTIVE_DAYS = 30;

function client(accessToken: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    }
  );
}

function cutoffIso() {
  return new Date(Date.now() - INACTIVE_DAYS * 86400_000).toISOString();
}

/**
 * A project is ARCHIVED if archived_at is set, OR it is unpinned and has not
 * been opened within INACTIVE_DAYS. Computed at read time — no cron job.
 */
export async function listProjects(opts: {
  accessToken: string;
  filter?: ProjectFilter;
  limit?: number;
  search?: string;
}): Promise<ProjectListItem[]> {
  const filter = opts.filter ?? "active";

  let q = client(opts.accessToken)
    .from("projects")
    .select("id, name, pinned, last_opened_at, archived_at, slug, published_at")
    .is("deleted_at", null);

  if (opts.search?.trim()) {
    q = q.ilike("name", `%${opts.search.trim()}%`);
  }

  if (filter === "active") {
    // pinned OR (not manually archived AND opened recently)
    q = q.or(
      `pinned.eq.true,and(archived_at.is.null,last_opened_at.gte.${cutoffIso()})`
    );
  } else if (filter === "archived") {
    q = q.eq("pinned", false).or(
      `archived_at.not.is.null,last_opened_at.lt.${cutoffIso()}`
    );
  } else if (filter === "published") {
    /* Live means it has an address and a moment it went up. Both, not either:
       published_at is stamped and cleared together with published_version_id
       (see /api/publish), and a row with one and not the other is a project
       mid-flight rather than one somebody can visit. */
    q = q.not("published_at", "is", null).not("slug", "is", null);
  }

  /* Published sorts by when it went live rather than by when it was last
     opened. The question being asked is "what have I put out", and the answer
     to that is chronological — a project published in March does not become
     less published by being opened yesterday. */
  q =
    filter === "published"
      ? q.order("published_at", { ascending: false })
      : q
          .order("pinned", { ascending: false })
          .order("last_opened_at", { ascending: false });

  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw new Error(`listProjects: ${error.message}`);
  return (data ?? []) as ProjectListItem[];
}

/* Dashboard "Continue working" — the whole ranked list, uncapped.
 *
 * It used to ask for `active` with a limit of 3, which is what that section
 * shows. But the section now offers All / Apps / Published over these rows, and
 * a filter applied to three pre-chosen rows answers the wrong question: press
 * Published on an account whose three most recently opened apps happen to be
 * unpublished and you get an empty list, while the sidebar says you have
 * published apps. The cap belongs on the far side of the filter, so it lives in
 * the component and this returns everything to filter.
 *
 * Uncapped, and `all` rather than `active`, for the same reason: `active`
 * excludes a project that has not been opened in thirty days, and a live site
 * nobody has edited since spring is exactly that — still published, still
 * something its owner wants to find. Ordering is unchanged, so Apps and All
 * both still lead with pinned and then most recently opened.
 *
 * The Projects page already reads this table unbounded for its own list, so
 * this adds no shape of query that page does not already make. */
export async function listContinueWorking(accessToken: string) {
  return listProjects({ accessToken, filter: "all" });
}

export async function countActiveProjects(accessToken: string) {
  const { count, error } = await client(accessToken)
    .from("projects")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);
  if (error) throw new Error(`countActiveProjects: ${error.message}`);
  return count ?? 0;
}

export async function touchProject(accessToken: string, projectId: string) {
  const { error } = await client(accessToken).rpc("touch_project", {
    p_project_id: projectId,
  });
  if (error) throw new Error(`touchProject: ${error.message}`);
}

export async function setPinned(
  accessToken: string,
  projectId: string,
  pinned: boolean
) {
  const { error } = await client(accessToken)
    .from("projects")
    .update({ pinned })
    .eq("id", projectId);
  if (error) throw new Error(`setPinned: ${error.message}`);
}

export async function setArchived(
  accessToken: string,
  projectId: string,
  archived: boolean
) {
  const { error } = await client(accessToken)
    .from("projects")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", projectId);
  if (error) throw new Error(`setArchived: ${error.message}`);
}

export async function renameProject(
  accessToken: string,
  projectId: string,
  name: string
) {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) throw new Error("renameProject: name cannot be empty");
  const { error } = await client(accessToken)
    .from("projects")
    .update({ name: trimmed })
    .eq("id", projectId);
  if (error) throw new Error(`renameProject: ${error.message}`);
}

export async function softDeleteProject(
  accessToken: string,
  projectId: string
) {
  const { error } = await client(accessToken).rpc("soft_delete_project", {
    p_project_id: projectId,
  });
  if (error) throw new Error(`softDeleteProject: ${error.message}`);
}

export async function restoreProject(accessToken: string, projectId: string) {
  const { error } = await client(accessToken).rpc("restore_project", {
    p_project_id: projectId,
  });
  if (error) throw new Error(`restoreProject: ${error.message}`);
}
