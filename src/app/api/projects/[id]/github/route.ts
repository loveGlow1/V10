/* A project's GitHub repository: which one it is linked to, and pushing to it.
 *
 * GET says what the Integrations drawer should draw: whether Connect GitHub is
 * set up here, whether this person has connected, whether their plan includes
 * pushing, and the repository this project last went to.
 *
 * POST pushes the project's current files as one commit. The first push makes
 * the repository (private unless asked otherwise) and links it; every push
 * after goes to the same one. The files are read here from the project's own
 * builds — the request names a project and, at most, a repository name, never
 * the content — so this cannot be used to have QuickStark commit anything else.
 */

import { NextResponse } from "next/server";

import { currentTree } from "@/lib/builder/store-tree";
import { UPGRADE_FOR_GITHUB, canPushToGitHub } from "@/lib/github/entitlement";
import { connectionFor, githubConfigured } from "@/lib/github/oauth";
import { createRepo, findRepo, pushTree, repoNameFor, validRepoName, type RepoRef } from "@/lib/github/push";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "../backend/owned";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type LinkRow = {
  owner: string;
  repo: string;
  branch: string;
  html_url: string;
  private: boolean;
  last_commit_sha: string | null;
  pushed_at: string | null;
};

const LINK_COLUMNS = "owner, repo, branch, html_url, private, last_commit_sha, pushed_at";

function describe(link: LinkRow | null) {
  return link
    ? {
        owner: link.owner,
        name: link.repo,
        branch: link.branch,
        url: link.html_url,
        private: link.private,
        lastCommit: link.last_commit_sha,
        pushedAt: link.pushed_at,
      }
    : null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const service = createSupabaseServiceClient();
  if (!githubConfigured() || !service) {
    return NextResponse.json({ configured: false, connected: false, login: null, canPush: false, repo: null, suggestedName: null });
  }

  const [connection, canPush, link, project] = await Promise.all([
    connectionFor(service, owned.userId),
    canPushToGitHub(service, owned.userId),
    service.from("project_github_repos").select(LINK_COLUMNS).eq("project_id", owned.projectId).maybeSingle<LinkRow>(),
    service.from("projects").select("name").eq("id", owned.projectId).maybeSingle<{ name: string | null }>(),
  ]);

  return NextResponse.json({
    configured: true,
    connected: Boolean(connection),
    login: connection?.login ?? null,
    canPush,
    repo: describe(link.data ?? null),
    suggestedName: repoNameFor(project.data?.name),
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  if (!githubConfigured()) {
    return NextResponse.json(
      { error: "Connect GitHub isn't set up on this deployment (GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET)." },
      { status: 503 },
    );
  }
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "This deployment cannot read builds." }, { status: 503 });

  /* The plan first, before GitHub is asked anything. */
  if (!(await canPushToGitHub(service, owned.userId))) {
    return NextResponse.json({ error: UPGRADE_FOR_GITHUB, upgrade: true }, { status: 402 });
  }

  const connection = await connectionFor(service, owned.userId);
  if (!connection) {
    return NextResponse.json({ error: "Connect your GitHub account first.", connect: true }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as { name?: unknown; private?: unknown };

  const { data: project } = await service
    .from("projects")
    .select("name")
    .eq("id", owned.projectId)
    .maybeSingle<{ name: string | null }>();

  const { tree, sourceMissing } = await currentTree(service, owned.projectId);
  if (sourceMissing || tree.length === 0) {
    return NextResponse.json(
      { error: "This project hasn't been built yet, so there is no code to push." },
      { status: 409 },
    );
  }

  /* ── Which repository ────────────────────────────────────────────────────
   *
   * The linked one if it still answers. One that has been deleted or moved out
   * of reach on GitHub is forgotten and a new one is made, rather than the push
   * failing forever on a repository that no longer exists. */
  const { data: link } = await service
    .from("project_github_repos")
    .select(LINK_COLUMNS)
    .eq("project_id", owned.projectId)
    .maybeSingle<LinkRow>();

  let repo: RepoRef | null = link ? await findRepo(connection.token, link.owner, link.repo) : null;

  if (!repo) {
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : repoNameFor(project?.name);
    if (!validRepoName(name)) {
      return NextResponse.json(
        { error: "Repository names can use letters, numbers, hyphens, underscores and dots." },
        { status: 400 },
      );
    }
    const made = await createRepo(connection.token, {
      name,
      private: body.private !== false,
      description: project?.name ? `${project.name} — built with QuickStark` : "Built with QuickStark",
    });
    if (!made.ok) return failure(made.status, made.reason);
    repo = made.value;
  }

  const pushed = await pushTree(
    connection.token,
    repo,
    tree,
    `Update from QuickStark${project?.name ? `: ${project.name}` : ""}`,
  );
  if (!pushed.ok) return failure(pushed.status, pushed.reason);

  const row = {
    project_id: owned.projectId,
    user_id: owned.userId,
    owner: repo.owner,
    repo: repo.name,
    branch: repo.branch,
    html_url: repo.url,
    private: repo.private,
    last_commit_sha: pushed.value.sha,
    pushed_at: new Date().toISOString(),
  };
  const { error } = await service.from("project_github_repos").upsert(row, { onConflict: "project_id" });
  if (error) {
    // eslint-disable-next-line no-console
    console.error(`github: pushed ${owned.projectId} but could not record the link:`, error.message);
  }

  return NextResponse.json({ repo: describe(row), commitUrl: pushed.value.url, files: tree.length });
}

/* GitHub's answer, put in words somebody can act on. A 401 means the grant was
   revoked on github.com: reconnecting is the fix, so the drawer is told to
   offer it. */
function failure(status: number, reason: string) {
  if (status === 401) {
    return NextResponse.json(
      { error: "GitHub no longer accepts QuickStark's access. Connect GitHub again.", connect: true },
      { status: 409 },
    );
  }
  if (status === 403 || status === 404) {
    return NextResponse.json(
      { error: `GitHub refused the push: ${reason}. Reconnect GitHub and allow repository access.`, connect: true },
      { status: 409 },
    );
  }
  return NextResponse.json({ error: `GitHub refused the push: ${reason}` }, { status: status >= 400 && status < 500 ? status : 502 });
}
