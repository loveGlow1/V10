/* Which photographs a project has already been given.
 *
 * Nothing recorded this. A page's pictures existed only as base64 inside the
 * stored document, so there was no way to ask whether two builds of the same
 * project — or two different projects — had been handed the same photograph.
 * They frequently had: the slot filler asked its provider for a single result
 * and took it, and stock search is deterministic, so the same query produced
 * the same picture every time it was ever asked.
 *
 * The ids live in project_assets, which the planned-asset pipeline already
 * uses. A remembered photograph is a row with `source: "stock"` and the
 * namespaced provider id as its `content_key` — the column that exists to
 * answer exactly this question.
 *
 * Best effort throughout. A read that fails costs variety on the next build; a
 * write that fails costs the same. Neither is worth failing a build over, and
 * both log rather than throw.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/* Enough to keep a long-running project from repeating itself, and bounded so
   a project with hundreds of builds does not send its whole history into an
   exclusion set on every save. The newest are the ones worth avoiding. */
const REMEMBERED = 200;

/** The photo ids this project has used before, newest first. */
export async function previouslyUsedPhotos(
  service: SupabaseClient,
  projectId: string,
): Promise<string[]> {
  const { data, error } = await service
    .from("project_assets")
    .select("content_key")
    .eq("project_id", projectId)
    .eq("source", "stock")
    .not("content_key", "is", null)
    .order("created_at", { ascending: false })
    .limit(REMEMBERED);

  if (error) {
    // eslint-disable-next-line no-console
    console.error("photos: could not read what this project has used:", error.message);
    return [];
  }

  return ((data ?? []) as { content_key: string | null }[])
    .map((row) => row.content_key)
    .filter((key): key is string => Boolean(key));
}

/**
 * Records the photographs a build used.
 *
 * Reads first and inserts only what is new, rather than upserting on a
 * conflict target. project_assets_content_key_idx is NOT unique — it exists to
 * answer "does anybody hold this picture", which is a question about many rows
 * — and adding a unique index over (project_id, content_key) would fail on any
 * instance whose existing rows already repeat one. Selecting first costs one
 * round trip and needs no migration against live data.
 *
 * A rebuild that legitimately reuses a picture — the hero somebody liked —
 * therefore records it once rather than accumulating a row per build.
 */
export async function rememberPhotos(
  service: SupabaseClient,
  input: { projectId: string; userId: string; ids: string[] },
): Promise<void> {
  if (input.ids.length === 0) return;

  const { data: known, error: readError } = await service
    .from("project_assets")
    .select("content_key")
    .eq("project_id", input.projectId)
    .in("content_key", input.ids);

  if (readError) {
    // eslint-disable-next-line no-console
    console.error("photos: could not check what is already recorded:", readError.message);
    return;
  }

  const already = new Set(
    ((known ?? []) as { content_key: string | null }[])
      .map((row) => row.content_key)
      .filter((key): key is string => Boolean(key)),
  );

  const fresh = input.ids.filter((id) => !already.has(id));
  if (fresh.length === 0) return;

  const { error } = await service.from("project_assets").insert(
    fresh.map((id) => ({
      project_id: input.projectId,
      user_id: input.userId,
      source: "stock",
      content_key: id,
      status: "ready",
      /* The id IS the address as far as this is concerned — the bytes are in
         the document. This row exists to answer "has this project had this
         picture before", not to serve it. */
      url: id,
      type: "photograph",
    })),
  );

  if (error) {
    // eslint-disable-next-line no-console
    console.error("photos: could not record what this build used:", error.message);
  }
}
