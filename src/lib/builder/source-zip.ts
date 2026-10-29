/* A project's source, as a .zip — what Download gives for an app.
 *
 * A single-page build downloads as its page (preview route). An app — made
 * here, or brought in from GitHub — is a tree of source files, and the page
 * the preview route used to hand over for one was a line of summary ("owner/
 * name — 112 files"), which is not the project. This is: every source file at
 * its own path, and the project's pictures fetched into the paths they came
 * from, so the folder runs as `npm install && npm run dev` exactly as it does
 * from the repository.
 *
 * Server-only. */

import { zipSync, strToU8 } from "fflate";

import type { FileTree } from "./tree";

/* Pictures are fetched from their stored public addresses, a few at a time,
   and a slow or missing one is left out rather than failing the download. */
const MOST_PICTURES = 80;
const PICTURE_TIMEOUT_MS = 8_000;

const README_NOTE = `# Downloaded from QuickStark

Run it locally:

    npm install
    npm run dev

Environment variables are not included. Copy them from your project's settings
into a .env.local file if the app needs them.
`;

export async function sourceZip(tree: FileTree, pictures: Record<string, string>): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
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

  if (!files["README.md"]) files["README.md"] = strToU8(README_NOTE);
  else files["QUICKSTARK.md"] = strToU8(README_NOTE);
  return zipSync(files, { level: 6 });
}
