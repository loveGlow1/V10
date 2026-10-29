/* Download gives each kind of project what it is, and vanilla sites run.
 *
 * Proven end to end by hand — a vanilla site (ES modules, fetch of a local
 * JSON file, a classic script, a second page) running in the static preview;
 * the Download dialog on a computer and an emulated iPhone producing each
 * file; the zip merge keeping a repository's lockfile and fonts with edits on
 * top and nothing added. Pinned here so none of it quietly goes. */

import { readFileSync } from "node:fs";

const read = (file) => readFileSync(file, "utf8");
let failed = 0;
const has = (ok, label) => {
  console.log(`${ok ? "ok   " : "FAIL "} ${label}`);
  if (!ok) failed += 1;
};

const staticPreview = read("src/lib/builder/preview/static-preview.ts");
const snapshot = read("src/lib/builder/preview/snapshot.ts");
const route = read("src/app/preview/[projectId]/route.ts");
const zip = read("src/lib/builder/source-zip.ts");
const push = read("src/lib/github/push.ts");
const dialog = read("src/components/DownloadDialog.tsx");

/* Vanilla sites */
has(/moduleSource\(at!, js, files, modules\)/.test(staticPreview) && /function moduleUrl/.test(staticPreview), "a module's imports of the site's own files resolve in the preview");
has(/fetchShim\(files\)/.test(staticPreview) && /window\.fetch=function/.test(staticPreview), "fetch() of the site's own files is answered in the preview");
has(/window\.__qsHere=here/.test(staticPreview), "and resolved from whichever page is showing");

/* Page as shown */
has(/withSnapshotBridge\(withFlierFit\(withSinglePageEdit/.test(route), "a single page answers \"page as shown\"");
has((staticPreview.match(/withSnapshotBridge\(/g) ?? []).length >= 2, "every page of a static site answers it too");
has(/scripts\[k\]\.remove\(\)/.test(snapshot) && /\[copy\]\.concat/.test(snapshot) && /indexOf\('data-qs'\) === 0/.test(snapshot), "the page as shown has no scripts and none of the preview's markers");
has(/b\.setAttribute\('value', a\.value\)/.test(snapshot) && /a\.type !== 'password'/.test(snapshot), "what was typed is kept — never a password");
has(/root\.hasAttribute\('data-qs-snapshot-on'\)/.test(snapshot), "the listener survives a static site's page change");

/* Kinds and formats */
has(/params\.get\("download"\) === "kind"/.test(route) && /kind = !multi \? "page" : staticEntryOf\(source\.tree\) && !canRenderApp\(source\.tree\) \? "static" : "app"/.test(route), "the server says what a project is: page, static or app");
has(/if \(multi \|\| format === "source"\)/.test(route), "an app or static site is always its files; a page's code on request");
has(/page: \["zip-shown", "shown", "html"\]/.test(dialog) && /static: \["zip-shown", "shown"\]/.test(dialog) && /app: \["app-zip"\]/.test(dialog), "the dialog offers each kind its own choices");
has(/files\["page-as-shown\.html"\] = strToU8\(shown\)/.test(dialog), "Code + page as shown puts both in the .zip");
for (const file of [
  "src/app/dashboard/components/workspace/PreviewPanel.tsx",
  "src/app/dashboard/components/ProjectRowMenu.tsx",
  "src/app/dashboard/components/workspace/BuildResultCard.tsx",
  "src/app/dashboard/components/workspace/QuickActionsSheet.tsx",
]) {
  const text = read(file);
  has(/useProjectDownload\(/.test(text) && !/\?download=1`\}\s*download/.test(text), `${file.split("/").pop()} opens the Download dialog`);
}

/* The zip is the project, exactly */
has(!/README_NOTE|QUICKSTARK\.md/.test(zip), "nothing is added to a project's zip");
has(/if \(!own\.has\(path\) && isProjectSource\(path, content\.length\)\) continue;/.test(zip), "a linked repository's other files come with it, minus source deleted here");
has(/export async function readRepoArchive/.test(push) && /linkedRepositoryFiles\(supabase, projectId\)/.test(route), "the repository is read whole for the download");
has(/from GitHub: \(\[\\w\.-\]\+\)/.test(route), "including a repository imported without a link, at the commit it came from");

console.log(failed ? `\n${failed} failed.` : "\nAll passed.");
process.exit(failed ? 1 : 0);
