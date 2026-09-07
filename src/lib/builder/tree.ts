/* A project as a set of files, rather than as one document.
 *
 * Everything in this builder so far has had exactly one artefact: a single
 * self-contained HTML page, stored in one column, served as one string, edited
 * by search-and-replace over the whole of it. That shape is why the builder
 * works at all — no install, no build step, no server — and it is also its
 * ceiling. A page cannot have a route. It cannot have a component used twice.
 * It cannot have a typed client for a database.
 *
 * So this is the second stack: a real Next.js file tree, exported statically.
 * `stack` already exists as a field in the orchestrator, set to
 * 'standalone-html' on every build; this is what the other value means.
 *
 * WHY STATIC EXPORT AND NOT A SERVER. An exported Next.js app is a directory of
 * files. That is the whole reason it fits here: the preview route can serve it,
 * the download can zip it, and nothing has to be provisioned, kept warm or paid
 * for per project. The cost is real and worth stating plainly — no server
 * routes, no server-side secrets, so anything the app does with data it does
 * from the browser, against row-level security. See scaffold.ts, which writes
 * the client that does it.
 *
 * WHAT THIS FILE IS. The type, and the rules that make model output safe to
 * treat as a filesystem. Nothing here generates anything and nothing here talks
 * to a model. A tree arrives from the orchestrator as JSON written by Claude,
 * which means every path in it is untrusted input that is about to be used as a
 * path — and the failure modes of getting that wrong are not cosmetic.
 */

export type ProjectFile = {
  /** Relative, POSIX, no leading slash: `app/page.tsx`, not `/app/page.tsx`. */
  path: string;
  content: string;
};

export type FileTree = ProjectFile[];

/* ── Limits ────────────────────────────────────────────────────────────────
 *
 * A build is one model call, and these are sized to what one can honestly
 * produce rather than to what a disk can hold. A tree that hits any of them is
 * a generation that went wrong, not a project that got big.
 */

/** Files in a tree. A real Next.js marketing site is twenty to forty. */
const MAX_FILES = 120;

/** One file. Past this it is not source, it is something embedded by mistake. */
const MAX_FILE_BYTES = 256_000;

/** The whole tree, which is what actually gets stored per version. */
const MAX_TREE_BYTES = 3_000_000;

/** Segments in a path. Deep enough for app/(marketing)/pricing/page.tsx. */
const MAX_DEPTH = 8;

export class TreeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TreeError";
  }
}

/* ── Paths ─────────────────────────────────────────────────────────────────
 *
 * The single most important function in this file. A path here came out of a
 * model, travelled through a webhook, and is about to name a file — so it is
 * checked the way a path from a browser upload would be, and for the same
 * reasons.
 *
 * Rejected rather than sanitised, deliberately. Rewriting `../../etc/passwd`
 * into something harmless produces a file nobody asked for at a path nobody
 * chose, and hides that the generator did something wrong. A tree with a bad
 * path in it is a bad tree.
 */

/* Everything that is not an ordinary relative path. Each of these has a real
   failure behind it rather than being defensive noise:

   - absolute paths and drive letters escape the project entirely
   - `..` climbs out of it, which is the classic one
   - a leading `~` is a home directory on some of the things that will read this
   - backslashes are separators on Windows and content everywhere else, so a
     path containing one means two different files depending on who opens it
   - control characters are never a filename, and a bare `.` or `..` is not one
   - leading or trailing whitespace makes two paths that look identical

   Note what is deliberately ALLOWED, because the App Router needs it: square
   brackets for dynamic segments (app/blog/[slug]/page.tsx), parentheses for
   route groups (app/(marketing)/page.tsx), and hyphens, dots and underscores
   throughout. A rule that rejected those would reject most of a real Next.js
   project — the failure this codebase keeps having, a check that is right in
   principle and wrong about the documents it actually meets. */
const BAD_SEGMENT = /^$|^\.\.?$|[\\:*?"<>|]|[\u0000-\u001f]|^\s|\s$/;

/** Where a generated project may not write, whatever it thinks it is doing. */
const FORBIDDEN_ROOTS = ["node_modules", ".git", ".next", ".vercel", "out", "dist"];

/* Files that carry secrets or change how the project is trusted. A generated
   app has no business writing any of them — the environment is supplied by the
   platform, and a .env in a tree that gets downloaded and pushed to GitHub is
   the oldest way to leak a key there is. */
const FORBIDDEN_FILES = [".env", ".env.local", ".env.production", ".npmrc", ".git", "id_rsa"];

/**
 * The path, normalised, or throws {@link TreeError} naming what was wrong.
 *
 * Case is preserved — `app/Page.tsx` and `app/page.tsx` are different files on
 * Linux, which is what this deploys to — but collisions that differ only by
 * case are caught in readTree, because they are the same file on the laptop the
 * person downloads onto.
 */
export function normalisePath(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new TreeError("A file in that build had no path.", 422);
  }

  const path = raw.trim().replace(/^\.\//, "");

  if (path.length === 0) throw new TreeError("A file in that build had an empty path.", 422);
  if (path.length > 200) throw new TreeError(`That build had a file path longer than anything real: ${path.slice(0, 60)}…`, 422);
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path) || path.startsWith("~")) {
    throw new TreeError(`A file wanted to write outside the project: ${path}`, 422);
  }

  const segments = path.split("/");
  if (segments.length > MAX_DEPTH) {
    throw new TreeError(`A file was nested deeper than a project goes: ${path}`, 422);
  }
  for (const segment of segments) {
    if (BAD_SEGMENT.test(segment)) {
      throw new TreeError(`A file had a path this can't write: ${path}`, 422);
    }
  }

  const root = segments[0].toLowerCase();
  if (FORBIDDEN_ROOTS.includes(root)) {
    throw new TreeError(`A build tried to write into ${segments[0]}/, which is generated rather than written.`, 422);
  }

  const name = segments[segments.length - 1].toLowerCase();
  if (FORBIDDEN_FILES.includes(name) || name.startsWith(".env.")) {
    throw new TreeError(`A build tried to write ${name}, which holds secrets and is supplied by the platform.`, 422);
  }

  return path;
}

/* ── Reading a tree ────────────────────────────────────────────────────────*/

/**
 * The tree in `value`, checked, or throws {@link TreeError}.
 *
 * Accepts the two shapes the orchestrator can reasonably send: an array of
 * `{path, content}`, and an object keyed by path. The second is what a model
 * writes when left to itself, so refusing it would be refusing the common case
 * on a technicality.
 */
export function readTree(value: unknown): FileTree {
  const entries: [unknown, unknown][] = Array.isArray(value)
    ? value.map((file) => [
        (file as ProjectFile | null)?.path,
        (file as ProjectFile | null)?.content,
      ])
    : value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>)
      : [];

  if (entries.length === 0) {
    throw new TreeError("That build produced no files.", 422);
  }
  if (entries.length > MAX_FILES) {
    throw new TreeError(`That build produced ${entries.length} files, which is more than a project this size has.`, 422);
  }

  const tree: FileTree = [];
  /* Keyed lower-case, because the collision that matters is the one that
     appears on somebody's laptop rather than the one on the server: `app/Page.tsx`
     and `app/page.tsx` are two files here and one file there, and which of the
     two survives the download is a coin toss. */
  const seen = new Map<string, string>();
  let total = 0;

  for (const [rawPath, rawContent] of entries) {
    const path = normalisePath(rawPath);

    if (typeof rawContent !== "string") {
      throw new TreeError(`${path} came back with nothing in it.`, 422);
    }

    const bytes = Buffer.byteLength(rawContent, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      throw new TreeError(`${path} is larger than a source file gets — something was embedded in it by mistake.`, 413);
    }
    total += bytes;
    if (total > MAX_TREE_BYTES) {
      throw new TreeError("That project is too large to store.", 413);
    }

    const key = path.toLowerCase();
    const clash = seen.get(key);
    if (clash) {
      throw new TreeError(
        clash === path
          ? `${path} was written twice in one build.`
          : `${clash} and ${path} are the same file on most machines.`,
        422,
      );
    }
    seen.set(key, path);

    tree.push({ path, content: rawContent });
  }

  return tree;
}

/* ── The two stacks, side by side ──────────────────────────────────────────*/

/** Where a single-page build's document lives once it is a tree. */
export const SINGLE_PAGE = "index.html";

/**
 * Today's build, as a tree.
 *
 * Every stored page in the table is one HTML document, and none of them are
 * going to be regenerated. So the old shape becomes a tree of one file rather
 * than a second code path that has to be remembered everywhere — a page is a
 * project that happens to have one file in it, and everything downstream can
 * stop asking which kind it is.
 */
export function treeFromPage(html: string): FileTree {
  return [{ path: SINGLE_PAGE, content: html }];
}

/**
 * The document to show for this tree, or null if it has none.
 *
 * A single-page build answers with its page. A static export answers with the
 * index its build produced. A tree that is still source — .tsx files, no build
 * run — has no document to show, and says so rather than guessing: the preview
 * for one of those is the exported output, not the source it came from.
 */
export function previewDocument(tree: FileTree): string | null {
  for (const candidate of [SINGLE_PAGE, "out/index.html", "public/index.html"]) {
    const file = tree.find((entry) => entry.path === candidate);
    if (file) return file.content;
  }
  return null;
}

/** Whether this tree is the old single-document shape. */
export function isSinglePage(tree: FileTree): boolean {
  return tree.length === 1 && tree[0].path === SINGLE_PAGE;
}

/* ── Describing one ────────────────────────────────────────────────────────*/

/**
 * The tree as a listing, for a model that is about to edit one file in it.
 *
 * Paths and sizes only. The whole point of a file tree is that a change to one
 * component does not require reading forty others, and a prompt that pastes the
 * project in has thrown that away — so this is the map, and the file being
 * edited is the only content that travels with it.
 */
export function describeTree(tree: FileTree): string {
  const listed = [...tree]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => `  ${file.path} (${file.content.split("\n").length} lines)`)
    .join("\n");

  return `THE PROJECT, AS FILES:\n${listed}`;
}

/** Total size, for the step line that reports what a build produced. */
export function treeBytes(tree: FileTree): number {
  return tree.reduce((total, file) => total + Buffer.byteLength(file.content, "utf8"), 0);
}
