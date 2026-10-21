/* Bringing a GitHub repository in as a new project — forked, or imported as is.
 *
 * POST { repo: "owner/name" | a github.com URL, mode?: "fork" | "import" }.
 *
 *   fork    (the default) The repository is forked into the caller's own
 *           GitHub account (or used as it is, when it is already theirs), and
 *           the project is linked to the fork — so it can open in a Codespace
 *           and sync back exactly like one saved to GitHub from here. Making
 *           the fork writes to GitHub, so it takes the plan that pushing does.
 *   import  Nothing is made on GitHub. The files are read from the repository
 *           as it stands and saved here, and the project lives in the
 *           workspace until it is published or pushed. A repository the caller
 *           can write to is linked, so Push puts the work right back in it;
 *           anyone else's is not, and the first push makes a repository of
 *           their own. Only reads, so every plan can import.
 *
 * Either way the files become the first build of a new project, under the
 * caller's own session and their own GitHub connection. */

import { NextResponse } from "next/server";

import { storeTree } from "@/lib/builder/store-tree";
import { MAX_FILE_BYTES, SINGLE_PAGE, TreeError, readTree } from "@/lib/builder/tree";
import { UPGRADE_FOR_GITHUB, canPushToGitHub } from "@/lib/github/entitlement";
import { connectionFor, githubConfigured } from "@/lib/github/oauth";
import { branchHead, forkRepo, parseRepoInput, readRepoFiles, readRepoPictures, readSource } from "@/lib/github/push";
import { storeRepoPictures } from "@/lib/github/repo-assets";
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

  const body = (await request.json().catch(() => ({}))) as { repo?: unknown; mode?: unknown };
  const importing = body.mode === "import";
  if (!importing && !(await canPushToGitHub(service, user.id))) {
    return NextResponse.json({ error: UPGRADE_FOR_GITHUB, upgrade: true }, { status: 402 });
  }
  const connection = await connectionFor(service, user.id);
  if (!connection) return NextResponse.json({ error: "Connect your GitHub account first.", connect: true }, { status: 409 });

  const wanted = typeof body.repo === "string" ? parseRepoInput(body.repo) : null;
  if (!wanted) {
    return NextResponse.json({ error: "Paste a GitHub repository, like owner/name or its github.com link." }, { status: 400 });
  }

  /* Where the files come from, whether it was forked, and whether the project
     is linked to it — pushed back to, synced from. */
  let repo;
  let forked = false;
  let linked = true;
  if (importing) {
    const source = await readSource(connection.token, wanted.owner, wanted.name);
    if (!source.ok) {
      return NextResponse.json({ error: `GitHub couldn't open it: ${source.reason}.` }, { status: source.status === 404 ? 404 : 502 });
    }
    repo = source.value.repo;
    linked = source.value.canPush;
  } else {
    const made = await forkRepo(connection.token, wanted.owner, wanted.name);
    if (!made.ok) {
      return NextResponse.json({ error: `GitHub couldn't fork it: ${made.reason}.` }, { status: made.status === 404 ? 404 : 502 });
    }
    repo = made.value.repo;
    forked = made.value.forked;
  }
  const head = await branchHead(connection.token, repo);
  if (!head.ok) return NextResponse.json({ error: `GitHub couldn't be read: ${head.reason}.` }, { status: 502 });
  const read = await readRepoFiles(connection.token, repo, head.value, MAX_FILE_BYTES);
  if (!read.ok) return NextResponse.json({ error: `GitHub couldn't be read: ${read.reason}.` }, { status: read.status === 413 ? 413 : 502 });
  if (read.value.files.length === 0) {
    return NextResponse.json({ error: "That repository has no source files to bring in." }, { status: 422 });
  }

  /* One index.html and nothing else a page is made of (no stylesheet, script,
     second page or package.json beside it) is a single page; anything else is
     a project of files, so its stylesheets and scripts come with it. */
  const page = read.value.files.find((file) => file.path === SINGLE_PAGE);
  const single =
    Boolean(page) &&
    read.value.files.every((file) => file.path === SINGLE_PAGE || !/\.(html?|css|m?jsx?|tsx?|json|svg)$/i.test(file.path));
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
    .insert({
      project_id: projectId,
      user_id: user.id,
      prompt: `${importing ? "Imported" : "Forked"} from GitHub: ${wanted.owner}/${wanted.name}`,
      html,
      model: importing ? "github-import" : "github-fork",
      files_touched: single ? 1 : tree.length,
    })
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
  if (linked) await service.from("project_github_repos").upsert(
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
  /* The repository's pictures, so the preview shows its logo and photos —
     see repo-assets.ts. Best effort: a page without them is still the page. */
  const pictures = await readRepoPictures(connection.token, repo, head.value);
  if (pictures.ok) await storeRepoPictures(service, projectId, pictures.value);

  await recordMessage(service, {
    projectId,
    userId: user.id,
    role: "system",
    body: importing
      ? `Imported ${wanted.owner}/${wanted.name} from GitHub — ${single ? "a single page" : `${tree.length} files`}, saved here. Nothing was changed on GitHub. ${
          linked
            ? `Push from Integrations → GitHub puts your work right back in ${repo.owner}/${repo.name}.`
            : "Publish it, or push it to a repository of your own from Integrations → GitHub."
        } Describe a change here to start.`
      : `${forked ? "Forked" : "Brought in"} ${wanted.owner}/${wanted.name} from GitHub — ${single ? "a single page" : `${tree.length} files`}. Open it in VS Code, or describe a change here.`,
    kind: "chat",
    dedupeKey: `github-fork:${build.id}`,
  });

  return NextResponse.json({ projectId, name: repo.name, forked, linked, files: single ? 1 : tree.length, skipped: read.value.skipped });
}
