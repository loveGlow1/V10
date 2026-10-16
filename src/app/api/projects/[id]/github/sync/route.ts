/* Bringing a project back from its GitHub repository — the return half of
 * "Open in VS Code", which opens the repository in a GitHub Codespace.
 *
 * GET  says whether the branch has moved past the commit QuickStark last
 *      pushed or brought back: work done in the Codespace that the project
 *      does not have yet.
 * POST reads the branch as it stands and saves it as a new build, the way the
 *      code editor saves one (../../files/route.ts): the preview shows it at
 *      once, no model, no credits. The link then records that commit, so the
 *      next push starts from it rather than over it.
 *
 * Owner-only: ownedProject settles that under the caller's own session, and
 * GitHub is asked with the caller's own connection. */

import { NextResponse } from "next/server";

import { currentTree, storeTree } from "@/lib/builder/store-tree";
import { MAX_FILE_BYTES, SINGLE_PAGE, TreeError, isSinglePage, readTree } from "@/lib/builder/tree";
import { connectionFor, githubConfigured } from "@/lib/github/oauth";
import { branchHead, findRepo, readRepoFiles, readRepoPictures } from "@/lib/github/push";
import { storeRepoPictures } from "@/lib/github/repo-assets";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { recordMessage } from "@/lib/thread-server";

import { ownedProject } from "../../backend/owned";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type LinkRow = { owner: string; repo: string; branch: string; html_url: string; private: boolean; last_commit_sha: string | null };

async function context(id: string) {
  const owned = await ownedProject(id);
  if ("error" in owned && owned.error) return { error: owned.error };
  if (!githubConfigured()) {
    return { error: NextResponse.json({ error: "Connect GitHub isn't set up on this deployment." }, { status: 503 }) };
  }
  const service = createSupabaseServiceClient();
  if (!service) return { error: NextResponse.json({ error: "Temporarily unavailable, please retry." }, { status: 503 }) };
  const connection = await connectionFor(service, owned.userId);
  if (!connection) return { error: NextResponse.json({ error: "Connect your GitHub account first.", connect: true }, { status: 409 }) };
  const { data: link, error } = await service
    .from("project_github_repos")
    .select("owner, repo, branch, html_url, private, last_commit_sha")
    .eq("project_id", owned.projectId)
    .maybeSingle<LinkRow>();
  if (error) {
    console.error("[github-sync] link lookup failed:", error.message);
    return { error: NextResponse.json({ error: "Temporarily unavailable, please retry." }, { status: 503 }) };
  }
  return { owned, service, token: connection.token, link: link ?? null };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context((await params).id);
  if (ctx.error) return ctx.error;
  if (!ctx.link) return NextResponse.json({ linked: false, ahead: false });

  const repo = await findRepo(ctx.token, ctx.link.owner, ctx.link.repo);
  if (!repo) return NextResponse.json({ linked: false, ahead: false });
  const head = await branchHead(ctx.token, repo);
  if (!head.ok) return NextResponse.json({ linked: true, ahead: false, owner: repo.owner, name: repo.name });
  return NextResponse.json({
    linked: true,
    owner: repo.owner,
    name: repo.name,
    ahead: head.value !== ctx.link.last_commit_sha,
  });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await context((await params).id);
  if (ctx.error) return ctx.error;
  const { owned, service, token, link } = ctx;
  if (!link) return NextResponse.json({ error: "This project isn't on GitHub yet." }, { status: 409 });

  const repo = await findRepo(token, link.owner, link.repo);
  if (!repo) {
    return NextResponse.json({ error: "The GitHub repository can't be reached. Reconnect GitHub and try again.", connect: true }, { status: 409 });
  }
  const head = await branchHead(token, repo);
  if (!head.ok) return NextResponse.json({ error: `GitHub refused: ${head.reason}` }, { status: 502 });
  if (head.value === link.last_commit_sha) return NextResponse.json({ upToDate: true });

  const read = await readRepoFiles(token, repo, head.value, MAX_FILE_BYTES);
  if (!read.ok) return NextResponse.json({ error: `GitHub couldn't be read: ${read.reason}.` }, { status: read.status === 413 ? 413 : 502 });

  const current = await currentTree(service, owned.projectId);
  const single = !current.sourceMissing && isSinglePage(current.tree);
  let html = current.html ?? "";
  let tree: { path: string; content: string }[] = [];
  const skipped = [...read.value.skipped];

  if (single) {
    /* A single page is its index.html; anything else in the repository has
       nowhere to go in it. */
    const page = read.value.files.find((file) => file.path === SINGLE_PAGE);
    if (!page) {
      return NextResponse.json({ error: `The repository has no ${SINGLE_PAGE}, which is all this project is.` }, { status: 422 });
    }
    html = page.content;
    for (const file of read.value.files) {
      /* The dev container is added again on every push; not worth a mention. */
      if (file.path !== SINGLE_PAGE && !file.path.startsWith(".devcontainer/")) skipped.push(file.path);
    }
  } else {
    try {
      tree = readTree(read.value.files);
    } catch (error) {
      if (error instanceof TreeError) return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }

  const short = head.value.slice(0, 7);
  const { data: build, error: buildError } = await service
    .from("project_builds")
    .insert({
      project_id: owned.projectId,
      user_id: owned.userId,
      prompt: `Synced from GitHub (${short})`,
      html,
      model: "github-sync",
      files_touched: single ? 1 : tree.length,
    })
    .select("id")
    .single();
  if (buildError || !build) {
    console.error("[github-sync] build insert failed:", buildError?.message);
    return NextResponse.json({ error: "The code could not be brought back. Nothing was changed." }, { status: 500 });
  }

  if (!single) {
    try {
      await storeTree(service, { buildId: build.id as string, projectId: owned.projectId, userId: owned.userId }, tree);
    } catch (error) {
      console.error("[github-sync] storing the tree failed:", error);
      await service.from("project_builds").delete().eq("id", build.id);
      return NextResponse.json({ error: "The code could not be brought back. Nothing was changed." }, { status: 500 });
    }
  }

  const now = new Date().toISOString();
  await service.from("projects").update({ last_build_at: now }).eq("id", owned.projectId).eq("user_id", owned.userId);
  await service
    .from("project_github_repos")
    .update({ last_commit_sha: head.value, pushed_at: now })
    .eq("project_id", owned.projectId);

  /* Pictures added or changed in the Codespace, for the preview — see
     repo-assets.ts. */
  const pictures = await readRepoPictures(token, repo, head.value);
  if (pictures.ok) await storeRepoPictures(service, owned.projectId, pictures.value);

  await recordMessage(service, {
    projectId: owned.projectId,
    userId: owned.userId,
    role: "system",
    body: `Brought back your changes from GitHub (commit ${short}) — no credits used. Publish when you want them on your live site.`,
    kind: "chat",
    dedupeKey: `github-sync:${build.id}`,
  });

  return NextResponse.json({ buildId: build.id, files: single ? 1 : tree.length, skipped });
}
