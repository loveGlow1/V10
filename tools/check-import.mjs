/* A Next.js app brought in from GitHub works like one made here.
 *
 * Proven end to end by hand (the create-next-app starters, in both routers and
 * under src/, rendered in the preview, then downloaded and `next build`-ed);
 * pinned here so none of the pieces quietly goes:
 *   - the preview reads a Pages Router project, at the root or under src/
 *   - next/router and next/font work in the preview, and next/image finds
 *     public/ pictures
 *   - the structure checks and repairs stand aside for a layout they do not
 *     model, so such a project can be edited and published
 *   - the editor is told the project's own conventions
 *   - Download gives an app's whole source as a .zip
 *   - a project as big as GitHub import reads can be stored and edited */

import { readFileSync } from "node:fs";

const read = (file) => readFileSync(file, "utf8");
let failed = 0;
const has = (ok, label) => {
  console.log(`${ok ? "ok   " : "FAIL "} ${label}`);
  if (!ok) failed += 1;
};

const preview = read("src/lib/builder/preview/app-preview.ts");
const runtime = read("src/lib/builder/preview/runtime.ts");
const structure = read("src/lib/builder/next-structure.ts");
const prompts = read("src/lib/builder/prompts.ts");
const edit = read("src/lib/builder/edit.ts");
const route = read("src/app/preview/[projectId]/route.ts");
const tree = read("src/lib/builder/tree.ts");
const push = read("src/lib/github/push.ts");

has(/const pages = pagesRouterView\(tree\);\s*if \(pages\) return pages;/.test(preview), "the preview reads a Pages Router project");
has(/srcPages \? withoutSrc\(stored\)/.test(preview), "including one under src/pages, with its @/ imports");
has(/case 'next\/router':/.test(runtime) && /function pagesRouter\(\)/.test(runtime), "next/router works in the preview");
has(/key === '__esModule' \? true : fontLoader\(\)/.test(runtime), "next/font gives a callable font, as Geist({...}) expects");
has(/var stored = assetUrl\(rest\.src\);\s*if \(stored\) rest\.src = stored;/.test(runtime), "next/image finds a picture in public/");
has(/if \(hasOwnLayout\(tree\)\) return \[\];/.test(structure) && /if \(hasOwnLayout\(tree\)\) return \{ tree, repairs: \[\] \};/.test(structure), "structure checks and repairs stand aside for an imported layout");
has(/export function projectConventions/.test(prompts) && (edit.match(/SOURCE_SYSTEM \+ projectConventions\(/g) ?? []).length === 2, "the editor is told the project's own conventions");
has(/sourceZip\(source\.tree, pictures\)/.test(route) && /application\/zip/.test(route), "Download gives an app's source as a .zip");
const maxFiles = Number(tree.match(/const MAX_FILES = (\d+);/)?.[1]);
const mostRead = Number(push.match(/const MOST_FILES_READ = (\d+);/)?.[1]);
has(maxFiles >= mostRead, `a project as large as an import reads (${mostRead}) can be stored and edited (${maxFiles})`);

console.log(failed ? `\n${failed} failed.` : "\nAll passed.");
process.exit(failed ? 1 : 0);
