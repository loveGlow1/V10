/* A project's files, as a .zip — what Download gives for an app, and the
 * "code" half of a page's download.
 *
 * Exactly the project, with nothing added and nothing rewritten:
 *
 *   - every source file at its own path, byte for byte as stored;
 *   - its pictures, fetched into the paths they came from;
 *   - for a project linked to a GitHub repository, everything else the
 *     repository holds at its last known commit — lockfiles, fonts, binaries,
 *     config this platform never reads — with the project's own files on top.
 *     The same rule a push uses (lib/github/push.ts): a source file that the
 *     project has since deleted is left out, and anything that is not project
 *     source is kept as the repository has it.
 *
 * So the folder is what GitHub would give, with the work done here applied —
 * and it runs with the project's own `npm install && npm run dev`.
 *
 * Server-only. */

import { zipSync, strToU8 } from "fflate";

import { isProjectSource } from "@/lib/github/push";

import type { FileTree } from "./tree";

/* Pictures are fetched from their stored public addresses, a few at a time,
   and a slow or missing one is left out rather than failing the download. */
const MOST_PICTURES = 80;
const PICTURE_TIMEOUT_MS = 8_000;

export async function sourceZip(
  tree: FileTree,
  pictures: Record<string, string>,
  repository?: Record<string, Uint8Array> | null,
  extra?: Record<string, string>,
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const own = new Set(tree.map((file) => file.path));

  if (repository) {
    for (const [path, content] of Object.entries(repository)) {
      /* Deleted here since: source the project no longer has stays out. */
      if (!own.has(path) && isProjectSource(path, content.length)) continue;
      files[path] = content;
    }
  }
  for (const file of tree) files[file.path] = strToU8(file.content);

  const wanted = Object.entries(pictures)
    .filter(([path]) => !files[path])
    .slice(0, MOST_PICTURES);
  for (let i = 0; i < wanted.length; i += 8) {
    await Promise.all(
      wanted.slice(i, i + 8).map(async ([path, url]) => {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(PICTURE_TIMEOUT_MS) });
          if (response.ok) files[path] = new Uint8Array(await response.arrayBuffer());
        } catch {
          /* Left out: the source is the download, a picture is a bonus. */
        }
      }),
    );
  }

  for (const [path, content] of Object.entries(extra ?? {})) if (!files[path]) files[path] = strToU8(content);
  return zipSync(files, { level: 6 });
}
