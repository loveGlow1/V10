import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* The builder's memory: the files it has generated, the snapshots it can go
   back to, and what has been said about them.
 *
 * These run with the service-role key, which bypasses RLS. That is deliberate —
 * the route needs to read and write a project's files in one request without a
 * user session on each query — and it is also why every caller must have proved
 * the project belongs to the person asking before it gets here. Nothing in this
 * file checks that; /api/builder does, under the caller's own session, before
 * calling any of it. */

export type ProjectFile = { path: string; content: string };

let client: SupabaseClient | null = null;

/* One client for the lifetime of the lambda rather than one per query: a single
   request loads files, reads messages, snapshots and saves, and building four
   clients to do it is four sets of connection state for no gain. */
function admin(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  /* Named, rather than a non-null assertion that fails later as an opaque
     "Invalid URL" from deep inside the client. A missing service key is a
     deployment mistake, and the message should say which one. */
  if (!url || !key) {
    throw new Error(
      "The builder store needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export async function loadFiles(projectId: string): Promise<ProjectFile[]> {
  const { data, error } = await admin()
    .from("project_files")
    .select("path, content")
    .eq("project_id", projectId)
    .order("path", { ascending: true });
  if (error) throw new Error(`loadFiles: ${error.message}`);
  return data ?? [];
}

export async function saveFiles(projectId: string, files: ProjectFile[]) {
  if (!files.length) return;
  const rows = files.map((file) => ({
    project_id: projectId,
    path: file.path,
    content: file.content,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await admin()
    .from("project_files")
    .upsert(rows, { onConflict: "project_id,path" });
  if (error) throw new Error(`saveFiles: ${error.message}`);
}

/* Taken before a change, not after: what is worth going back to is the state
   that existed before the edit that is about to run. */
export async function snapshot(projectId: string, label: string) {
  const files = await loadFiles(projectId);
  const { error } = await admin().from("project_revisions").insert({
    project_id: projectId,
    label,
    snapshot: files,
  });
  if (error) throw new Error(`snapshot: ${error.message}`);
}

export async function restoreLatest(projectId: string): Promise<ProjectFile[] | null> {
  const { data, error } = await admin()
    .from("project_revisions")
    .select("id, snapshot")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`restoreLatest: ${error.message}`);
  if (!data) return null;

  const files = data.snapshot as ProjectFile[];
  await saveFiles(projectId, files);
  return files;
}

/* Newest first from the database because that is what the index is ordered for,
   then reversed: the model reads a conversation forwards. */
export async function recentMessages(projectId: string, limit = 8) {
  const { data, error } = await admin()
    .from("builder_messages")
    .select("role, content")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`recentMessages: ${error.message}`);
  return (data ?? []).reverse();
}

export async function addMessage(
  projectId: string,
  role: "user" | "assistant",
  content: string,
  intent?: string,
) {
  const { error } = await admin().from("builder_messages").insert({
    project_id: projectId,
    role,
    content,
    intent: intent ?? null,
  });
  /* Losing a transcript row must not lose the build that produced it, so this
     is logged rather than thrown. */
  if (error) {
    // eslint-disable-next-line no-console
    console.error("builder: could not record a message:", error.message);
  }
}
