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

/* How far back to look for a project's source. Twenty-five builds is more
   than any project here has between one real generation and the next, and it
   is a bounded query rather than a scan of a project's whole history. */
const LOOK_BACK = 25;

/**
 * The newest build of this project that actually has files, and its files.
 *
 * ── Why a project's source is not always on its newest build ──────────────
 *
 * Because a build row can be written without its files. The insert in
 * storeTree throws and the caller is supposed to treat that as a failed build,
 * but a build stored by a path that never reached storeTree at all — an older
 * save route, an orchestrator step that wrote the summary and stopped — leaves
 * a row whose html column holds the RECEIPT and whose file rows do not exist.
 *
 * What that did to the customer is the whole reason this exists. currentTree
 * reported `sourceMissing`, the preview could not route an empty tree, and the
 * pane showed the receipt: a list of "Routes 9, Database created, Files" where
 * their application should have been. Three projects in production are in
 * exactly that state right now, and two of them have a complete tree sitting
 * on the build immediately before.
 *
 * "The files are gone" was the wrong reading. The files are gone from that
 * ROW. The project still has source, and showing it is better than showing an
 * inventory of it by every measure that matters.
 *
 * Two cheap queries rather than one expensive one: the build ids first, then
 * which of them have any file rows at all, and only then the tree itself. A
 * single join would carry twenty-five builds' worth of file CONTENT across the
 * wire to answer a question about existence.
 */
async function newestStoredTree(
  service: SupabaseClient,
  projectId: string,
): Promise<{ tree: FileTree; buildId: string } | null> {
  const { data: recent } = await service
    .from("project_builds")
    .select("id")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(LOOK_BACK);

  const ids = (recent ?? []).map((row) => row.id as string);
  if (ids.length === 0) return null;

  const { data: holding } = await service
    .from("project_files")
    .select("build_id")
    .in("build_id", ids);

  const withFiles = new Set((holding ?? []).map((row) => row.build_id as string));
  /* `ids` is already newest-first, so the first match is the newest build that
     has source — not merely any build that does. */
  const found = ids.find((id) => withFiles.has(id));
  if (!found) return null;

  return { tree: await loadTree(service, found), buildId: found };
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
  /* The build these files came from, when it is not the newest one — so a
     caller that wants to mention it can, and one that does not, need not. */
  recoveredFrom: string | null;
}> {
  const { data: build } = await service
    .from("project_builds")
    .select("id, html")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!build) return { tree: [], buildId: null, html: null, sourceMissing: false, recoveredFrom: null };

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
    /* ── Before giving up, ask the PROJECT rather than the row ───────────
     *
     * A build row without its files does not mean the project has no source.
     * It means this row does not have it, and the build before very often
     * does — which is true of two of the three projects in production that
     * are in this state today.
     *
     * So the receipt is the answer of last resort rather than the first one.
     * When there is real source anywhere in this project's recent history it
     * is what the preview renders and what an edit changes, because showing
     * somebody their application is better than showing them an inventory of
     * it by every measure that matters. See newestStoredTree. */
    const recovered = await newestStoredTree(service, projectId);
    if (recovered) {
      return {
        tree: recovered.tree,
        /* The build the FILES came from, so anything that writes against this
           tree writes against the build it actually read. */
        buildId: recovered.buildId,
        html,
        sourceMissing: false,
        recoveredFrom: recovered.buildId === buildId ? null : recovered.buildId,
      };
    }

    /* Nothing anywhere. Now it is true, and it is reported rather than
       repaired: no amount of editing a receipt brings a project's source
       back, and the caller's job is to say so. */
    return { tree: [], buildId, html, sourceMissing: true, recoveredFrom: null };
  }

  return {
    tree: stored.length > 0 ? stored : html ? treeFromPage(html) : [],
    buildId,
    html,
    sourceMissing: false,
    recoveredFrom: null,
  };
}
