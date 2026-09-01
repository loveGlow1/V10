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
};

export type ProjectFilter = "active" | "archived" | "all";

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
    .select("id, name, pinned, last_opened_at, archived_at")
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
  }

  q = q
    .order("pinned", { ascending: false })
    .order("last_opened_at", { ascending: false });

  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw new Error(`listProjects: ${error.message}`);
  return (data ?? []) as ProjectListItem[];
}

/** Dashboard "Continue working" — hard cap of 3. */
export async function listContinueWorking(accessToken: string) {
  return listProjects({ accessToken, filter: "active", limit: 3 });
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
