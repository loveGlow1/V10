/* Forking a GitHub repository into a new project.
 *
 * POST { repo: "owner/name" | a github.com URL }. The repository is forked into
 * the caller's own GitHub account (or used as it is, when it is already
 * theirs), its files become the first build of a new project, and the project
 * is linked to the fork — so it can open in a Codespace and sync back exactly
 * like one that was saved to GitHub from here.
 *
 * Under the caller's own session and their own GitHub connection; the plan
 * check is the one that gates saving to GitHub. */

import { NextResponse } from "next/server";

import { storeTree } from "@/lib/builder/store-tree";
import { MAX_FILE_BYTES, SINGLE_PAGE, TreeError, readTree } from "@/lib/builder/tree";
import { UPGRADE_FOR_GITHUB, canPushToGitHub } from "@/lib/github/entitlement";
import { connectionFor, githubConfigured } from "@/lib/github/oauth";
import { branchHead, forkRepo, parseRepoInput, readRepoFiles } from "@/lib/github/push";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { recordMessage } from "@/lib/thread-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Sessions are unavailable." }, { status: 503 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  if (!githubConfigured()) {
    return NextResponse.json({ error: "Connect GitHub isn't set up on this deployment." }, { status: 503 });
  }
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Temporarily unavailable, please retry." }, { status: 503 });

  if (!(await canPushToGitHub(service, user.id))) {
    return NextResponse.json({ error: UPGRADE_FOR_GITHUB, upgrade: true }, { status: 402 });
  }
  const connection = await connectionFor(service, user.id);
  if (!connection) return NextResponse.json({ error: "Connect your GitHub account first.", connect: true }, { status: 409 });

  const body = (await request.json().catch(() => ({}))) as { repo?: unknown };
  const wanted = typeof body.repo === "string" ? parseRepoInput(body.repo) : null;
  if (!wanted) {
    return NextResponse.json({ error: "Paste a GitHub repository, like owner/name or its github.com link." }, { status: 400 });
  }

  const forked = await forkRepo(connection.token, wanted.owner, wanted.name);
  if (!forked.ok) {
    return NextResponse.json({ error: `GitHub couldn't fork it: ${forked.reason}.` }, { status: forked.status === 404 ? 404 : 502 });
  }
  const { repo } = forked.value;
  const head = await branchHead(connection.token, repo);
  if (!head.ok) return NextResponse.json({ error: `GitHub couldn't be read: ${head.reason}.` }, { status: 502 });
  const read = await readRepoFiles(connection.token, repo, head.value, MAX_FILE_BYTES);
  if (!read.ok) return NextResponse.json({ error: `GitHub couldn't be read: ${read.reason}.` }, { status: read.status === 413 ? 413 : 502 });
  if (read.value.files.length === 0) {
    return NextResponse.json({ error: "That repository has no source files to bring in." }, { status: 422 });
  }

  /* One index.html and nothing else that matters is a single page; anything
     else is a project of files. */
  const page = read.value.files.find((file) => file.path === SINGLE_PAGE);
  const single = Boolean(page) && read.value.files.every((file) => file.path === SINGLE_PAGE || !/\.(tsx?|jsx?|mjs)$/.test(file.path));
  let tree: { path: string; content: string }[] = [];
  if (!single) {
    try {
      tree = readTree(read.value.files);
    } catch (error) {
      if (error instanceof TreeError) return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }

  const { data: project, error: projectError } = await service
    .from("projects")
    .insert({ user_id: user.id, name: repo.name })
    .select("id")
    .single();
  if (projectError || !project) {
    console.error("[github-fork] project insert failed:", projectError?.message);
    return NextResponse.json({ error: "The project could not be made. Nothing was changed here." }, { status: 500 });
  }
  const projectId = project.id as string;
  const short = head.value.slice(0, 7);
  const html = single
    ? page!.content
    : `<!doctype html><html><body><p>${escape(repo.owner)}/${escape(repo.name)} — ${tree.length} files, from GitHub (${short}).</p></body></html>`;

  const { data: build, error: buildError } = await service
    .from("project_builds")
    .insert({ project_id: projectId, user_id: user.id, prompt: `Forked from GitHub: ${wanted.owner}/${wanted.name}`, html, model: "github-fork", files_touched: single ? 1 : tree.length })
    .select("id")
    .single();
  const undo = () => service.from("projects").delete().eq("id", projectId);
  if (buildError || !build) {
    console.error("[github-fork] build insert failed:", buildError?.message);
    await undo();
    return NextResponse.json({ error: "The project could not be made. Nothing was changed here." }, { status: 500 });
  }
  if (!single) {
    try {
      await storeTree(service, { buildId: build.id as string, projectId, userId: user.id }, tree);
    } catch (error) {
      console.error("[github-fork] storing the tree failed:", error);
      await undo();
      return NextResponse.json({ error: "The project could not be made. Nothing was changed here." }, { status: 500 });
    }
  }

  const now = new Date().toISOString();
  await service.from("projects").update({ last_build_at: now }).eq("id", projectId);
  await service.from("project_github_repos").upsert(
    {
      project_id: projectId,
      user_id: user.id,
      owner: repo.owner,
      repo: repo.name,
      branch: repo.branch,
      html_url: repo.url,
      private: repo.private,
      last_commit_sha: head.value,
      pushed_at: now,
    },
    { onConflict: "project_id" },
  );
  await recordMessage(service, {
    projectId,
    userId: user.id,
    role: "system",
    body: `${forked.value.forked ? "Forked" : "Brought in"} ${wanted.owner}/${wanted.name} from GitHub — ${single ? "a single page" : `${tree.length} files`}. Open it in VS Code, or describe a change here.`,
    kind: "chat",
    dedupeKey: `github-fork:${build.id}`,
  });

  return NextResponse.json({ projectId, name: repo.name, forked: forked.value.forked, files: single ? 1 : tree.length, skipped: read.value.skipped });
}
