/* Reading and writing a build's files.
 *
 * Kept out of the routes because three of them need it — the save that stores a
 * generated project, the preview that serves one, and the edit that changes one
 * file in it — and because the shape of the write matters more than it looks.
 *
 * A build's files are written in ONE statement, after the build row exists. Not
 * for speed: for the failure. A tree stored file by file can stop halfway, and
 * what is left behind is a build that exists, is pointed at by the project, and
 * is missing its layout. That is worse than no build at all, because the
 * project row says it succeeded. One insert either lands or does not.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isProjectSummary } from "./project-summary";
import { type FileTree, treeFromPage } from "./tree";

/**
 * Stores a tree against a build. Throws on failure, because the caller has to
 * treat a half-written project as a failed build rather than a stored one.
 */
export async function storeTree(
  service: SupabaseClient,
  where: { buildId: string; projectId: string; userId: string },
  tree: FileTree,
): Promise<void> {
  if (tree.length === 0) return;

  const { error } = await service.from("project_files").insert(
    tree.map((file) => ({
      build_id: where.buildId,
      project_id: where.projectId,
      user_id: where.userId,
      path: file.path,
      content: file.content,
    })),
  );

  if (error) {
    throw new Error(`the project's files could not be stored: ${error.message}`);
  }
}

/**
 * The files of a build, or an empty tree when it has none.
 *
 * An empty answer is the ORDINARY case, not an error: every build stored before
 * this existed is a single page with no rows here, and so is every build of the
 * single-page stack from now on. Callers turn that into a one-file tree with
 * treeFromPage rather than branching on which kind of build they are holding.
 */
export async function loadTree(
  service: SupabaseClient,
  buildId: string,
): Promise<FileTree> {
  const { data, error } = await service
    .from("project_files")
    .select("path, content")
    .eq("build_id", buildId)
    .order("path", { ascending: true });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("tree: could not read a build's files:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    path: row.path as string,
    content: row.content as string,
  }));
}

/**
 * The current files of a project, whichever stack it was built with.
 *
 * The one function the rest of the app should call. A file-tree build answers
 * with its files; a single-page build answers with its page as a tree of one,
 * so nothing downstream has to ask which kind it is holding — see the note on
 * treeFromPage.
 */
export async function currentTree(
  service: SupabaseClient,
  projectId: string,
): Promise<{
  tree: FileTree;
  buildId: string | null;
  html: string | null;
  /* True when this project was built as a file tree and its files are not
     there. Distinct from an empty tree, which is the ordinary answer for a
     single-page build, and it has to be: the caller's correct response to one
     is "edit the page" and to the other is "stop". See below. */
  sourceMissing: boolean;
}> {
  const { data: build } = await service
    .from("project_builds")
    .select("id, html")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!build) return { tree: [], buildId: null, html: null, sourceMissing: false };

  const buildId = build.id as string;
  const html = (build.html as string | null) ?? null;
  const stored = await loadTree(service, buildId);

  /* ── The fallback that had to learn what it was falling back to ─────────
   *
   * treeFromPage turns the html column into a tree of one file, so a
   * single-page build and a file-tree build look the same to everything
   * downstream. That is right for a page and wrong for a receipt.
   *
   * A file-tree build stores a SUMMARY in that column — the routes, the
   * tables, the files — because nothing here runs `next build`. So when such a
   * project's files are absent, this handed back a one-file tree whose single
   * file was our own description of the project, and the edit path went to
   * work on it: it picked that file (the only one), failed to match anything,
   * and told the customer "I couldn't place that change in the page — try
   * naming the section", listing "Routes 9", "Database created", "Files". Our
   * headings, read back to somebody asking us to change their dashboard. Their
   * real source was never opened, and would have stayed frozen however many
   * times they rephrased.
   *
   * Reported rather than repaired, because it cannot be repaired from here:
   * the files are gone and no amount of editing a receipt brings them back.
   * The caller's job is to say so. */
  if (stored.length === 0 && isProjectSummary(html)) {
    return { tree: [], buildId, html, sourceMissing: true };
  }

  return {
    tree: stored.length > 0 ? stored : html ? treeFromPage(html) : [],
    buildId,
    html,
    sourceMissing: false,
  };
}
