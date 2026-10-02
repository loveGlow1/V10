/* Pushing a project's files to a GitHub repository its owner controls.
 *
 * One commit per push, made with the Git Data API rather than file by file
 * through the Contents API: a tree carrying every file inline, a commit on top
 * of the branch's head, and the branch moved to it. That is four requests for
 * a project of any size, and the push either lands whole or not at all — a
 * repository is never left holding half an app.
 *
 * The tree is written WITHOUT a base tree, so the commit is exactly the
 * project: a file deleted in QuickStark is deleted in the repository too. The
 * history is kept, so nothing pushed earlier is ever lost.
 */

import type { FileTree } from "@/lib/builder/tree";

import { GITHUB_API } from "./oauth";

export type RepoRef = { owner: string; name: string; branch: string; url: string; private: boolean };

type Result<T> = { ok: true; value: T } | { ok: false; status: number; reason: string };

async function gh<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<Result<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${GITHUB_API}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const said = typeof body.message === "string" ? body.message : "";
      return { ok: false, status: response.status, reason: said || `GitHub answered ${response.status}` };
    }
    return { ok: true, value: body as T };
  } catch {
    return { ok: false, status: 0, reason: "GitHub did not answer" };
  } finally {
    clearTimeout(timer);
  }
}

/** The signed-in GitHub account's login, or null when the token no longer works. */
export async function viewerLogin(token: string): Promise<string | null> {
  const me = await gh<{ login?: string }>(token, "/user");
  return me.ok && typeof me.value.login === "string" ? me.value.login : null;
}

/**
 * A repository name GitHub will accept, made from a project's name.
 * GitHub allows letters, digits, "-", "_" and "."; everything else becomes a
 * hyphen, and the result is capped well under its 100-character limit.
 */
export function repoNameFor(projectName: string | null | undefined): string {
  const cleaned = (projectName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || "quickstark-app";
}

export function validRepoName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,100}$/.test(name) && name !== "." && name !== "..";
}

type RepoBody = { name: string; owner: { login: string }; default_branch: string; html_url: string; private: boolean };

const toRef = (repo: RepoBody): RepoRef => ({
  owner: repo.owner.login,
  name: repo.name,
  branch: repo.default_branch || "main",
  url: repo.html_url,
  private: repo.private,
});

/** The repository as GitHub has it now, or null when it is gone or out of reach. */
export async function findRepo(token: string, owner: string, name: string): Promise<RepoRef | null> {
  const found = await gh<RepoBody>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  return found.ok ? toRef(found.value) : null;
}

/**
 * A new repository in the signed-in account. `auto_init` because the Git Data
 * API refuses to write to a repository with no commits at all; the README it
 * makes is replaced by the first push.
 */
export async function createRepo(
  token: string,
  input: { name: string; private: boolean; description?: string },
): Promise<Result<RepoRef>> {
  const made = await gh<RepoBody>(token, "/user/repos", {
    method: "POST",
    body: {
      name: input.name,
      private: input.private,
      description: input.description?.slice(0, 300),
      auto_init: true,
      has_wiki: false,
    },
  });
  if (!made.ok) {
    if (made.status === 422 && /already exists/i.test(made.reason)) {
      return { ok: false, status: 409, reason: `You already have a repository called ${input.name}. Pick another name.` };
    }
    return made;
  }
  return { ok: true, value: toRef(made.value) };
}

/** Files GitHub would refuse or that have no place in a repository. */
function pushable(tree: FileTree): FileTree {
  return tree.filter(
    (file) =>
      file.path &&
      !file.path.startsWith("/") &&
      !file.path.split("/").some((part) => part === ".." || part === "." || part === ".git" || part === ""),
  );
}

/**
 * Commits `tree` as the whole content of the repository's branch.
 * Returns the new commit's sha.
 */
export async function pushTree(
  token: string,
  repo: RepoRef,
  tree: FileTree,
  message: string,
): Promise<Result<{ sha: string; url: string }>> {
  const files = pushable(tree);
  if (files.length === 0) return { ok: false, status: 409, reason: "This project has no files to push yet." };

  const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const branch = encodeURIComponent(repo.branch);

  /* The branch's head. A repository emptied since it was linked has none, and
     the Data API cannot write to it until something is committed — so one
     file goes in through the Contents API first, and the push replaces it. */
  let head = await gh<{ object: { sha: string } }>(token, `${base}/git/ref/heads/${branch}`);
  if (!head.ok && (head.status === 404 || head.status === 409)) {
    const seeded = await gh(token, `${base}/contents/README.md`, {
      method: "PUT",
      body: {
        message: "Initial commit",
        content: Buffer.from(`# ${repo.name}\n`).toString("base64"),
        branch: repo.branch,
      },
    });
    if (!seeded.ok) return seeded;
    head = await gh<{ object: { sha: string } }>(token, `${base}/git/ref/heads/${branch}`);
  }
  if (!head.ok) return head;
  const parent = head.value.object.sha;

  const madeTree = await gh<{ sha: string }>(token, `${base}/git/trees`, {
    method: "POST",
    body: {
      tree: files.map((file) => ({ path: file.path, mode: "100644", type: "blob", content: file.content })),
    },
  });
  if (!madeTree.ok) return madeTree;

  const commit = await gh<{ sha: string; html_url: string }>(token, `${base}/git/commits`, {
    method: "POST",
    body: { message, tree: madeTree.value.sha, parents: [parent] },
  });
  if (!commit.ok) return commit;

  const moved = await gh(token, `${base}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: { sha: commit.value.sha, force: false },
  });
  if (!moved.ok) return moved;

  return { ok: true, value: { sha: commit.value.sha, url: commit.value.html_url } };
}
