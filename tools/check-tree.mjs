#!/usr/bin/env node
/* A project that arrives as files rather than as one document.
 *
 *   npm run check:tree
 *
 * Three things are being held here, and only the first is ordinary testing.
 *
 *   PATHS ARE UNTRUSTED. A path in a tree was written by a model, travelled
 *   through a webhook, and is about to name a file. Getting this wrong is not
 *   a cosmetic bug — it is a write outside the project, or a .env in a
 *   directory somebody pushes to GitHub. Every escape below is checked
 *   explicitly rather than assumed to fall out of the regex.
 *
 *   AND THE ALLOWED ONES MUST STILL PASS. The App Router is built out of
 *   characters that look dangerous: app/blog/[slug]/page.tsx,
 *   app/(marketing)/pricing/page.tsx. A path rule that rejects those rejects
 *   most of a real Next.js project, which is the failure this codebase keeps
 *   having — a check that is right in principle and wrong about the documents
 *   it meets.
 *
 *   THE SCAFFOLD MUST ACTUALLY BUILD. package.json and tsconfig.json are
 *   generated as strings. A trailing comma in either is a project that fails
 *   at `npm install`, which is the first thing that happens and the least
 *   explicable place to fail. They are parsed here, not eyeballed.
 *
 * No keys, no network, no install.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-tree");
mkdirSync(out, { recursive: true });

execFileSync(
  "npx",
  ["tsc", "src/lib/builder/tree.ts", "src/lib/builder/scaffold.ts",
   "src/lib/builder/architecture.ts", "src/lib/builder/schema.ts",
   "--outDir", out, "--rootDir", "src", "--module", "esnext", "--target", "es2022",
   "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

/* tsc emits the import specifiers exactly as they were written — "./schema",
   with no extension — and node's ESM loader will not resolve those. scaffold.ts
   imports schema.ts for real (not as a type), so the extension has to be put
   back before any of this is loaded. check-blueprint.mjs does the same thing for
   the same reason, one directory over. */
for (const entry of readdirSync(join(out, "lib/builder"))) {
  if (!entry.endsWith(".js")) continue;
  const path = join(out, "lib/builder", entry);
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(
      /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
      (whole, before, specifier, after) =>
        specifier.endsWith(".js") ? whole : `${before}${specifier}.js${after}`,
    ),
  );
}

const tree = await import(join(out, "lib/builder/tree.js"));
const scaffold = await import(join(out, "lib/builder/scaffold.js"));
const schema = await import(join(out, "lib/builder/schema.js"));

/* platformFiles and treeBrief used to take a `withBackend` boolean and now take
   the architecture manifest that replaced it — see src/lib/builder/architecture.ts.
   These two turn the old boolean back into the manifest it became, so every
   assertion below stays about the thing it was written to check rather than
   being rewritten around a new signature. */
function manifestFor(kind, withBackend) {
  return {
    type: kind,
    frontend: true,
    backend: withBackend,
    database: withBackend,
    authentication: false,
    admin: false,
    storage: false,
    payments: false,
  };
}

function modelFor(kind, withBackend) {
  return schema.dataModelFor(manifestFor(kind, withBackend), "app_test");
}

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const rejects = (path) => {
  try { tree.normalisePath(path); return false; } catch { return true; }
};
const accepts = (path) => {
  try { return tree.normalisePath(path) === path.replace(/^\.\//, "").trim(); } catch { return false; }
};

// ── Paths that must be refused ────────────────────────────────────────────

for (const [path, why] of [
  ["../../../etc/passwd", "climbing out of the project"],
  ["app/../../secrets.ts", "climbing out from the middle"],
  ["/etc/passwd", "an absolute path"],
  ["C:\\Windows\\system32", "a drive letter"],
  ["~/.ssh/id_rsa", "a home directory"],
  ["app\\page.tsx", "a backslash, which is two different files on two machines"],
  [".env", "the file that holds the keys"],
  [".env.local", "and its variants"],
  ["app/.env.production", "wherever it is put"],
  [".npmrc", "an npm config, which can carry a token"],
  ["node_modules/react/index.js", "writing into node_modules"],
  [".git/config", "writing into .git"],
  [".next/build.json", "writing into a build directory"],
  ["out/index.html", "writing into the export directory"],
  ["a/b/c/d/e/f/g/h/i/page.tsx", "nested deeper than a project goes"],
  ["", "an empty path"],
  ["   ", "a path of whitespace"],
  ["app/ page.tsx", "a leading space in a segment"],
  ["app//page.tsx", "an empty segment"],
  [42, "a path that is not a string"],
  [null, "no path at all"],
]) {
  has(rejects(path), `refused: ${why}`, `accepted ${JSON.stringify(path)}`);
}

// ── Paths that must be allowed ────────────────────────────────────────────
/* Every one of these is in a real Next.js project. A rule that trips on any of
   them has made the file tree unusable for the framework it is generating. */

for (const path of [
  "app/page.tsx",
  "app/layout.tsx",
  "app/globals.css",
  "app/blog/[slug]/page.tsx",
  "app/(marketing)/pricing/page.tsx",
  "app/[...catchAll]/page.tsx",
  "components/nav-bar.tsx",
  "components/Nav.tsx",
  "lib/supabase.ts",
  "next.config.mjs",
  "package.json",
  "public/logo.svg",
  ".gitignore",
]) {
  has(accepts(path), `allowed: ${path}`);
}

has(tree.normalisePath("./app/page.tsx") === "app/page.tsx", "a leading ./ is dropped rather than refused");
/* Whitespace around the WHOLE path is a model being untidy and is tidied.
   Whitespace inside a segment is two paths that look identical, and is not. */
has(tree.normalisePath("  app/page.tsx  ") === "app/page.tsx", "and the path itself is trimmed rather than refused");
/* A space INSIDE a name is a legal filename everywhere and is left alone. The
   ones that are refused are the invisible ones — a leading or trailing space
   makes two paths that look identical on screen and are not. */
has(accepts("public/my logo.svg"), "a space inside a filename is allowed, being legal everywhere");

// ── Reading a tree ────────────────────────────────────────────────────────

const asObject = { "app/page.tsx": "export default function Page() { return null; }", "app/layout.tsx": "x" };
const asArray = [{ path: "app/page.tsx", content: "y" }];

has(tree.readTree(asObject).length === 2, "a tree keyed by path is read");
has(tree.readTree(asArray).length === 1, "and so is an array of files");

const threw = (value) => {
  try { tree.readTree(value); return null; } catch (error) { return error.message; }
};

has(threw({}) !== null, "an empty tree is refused");
has(threw(null) !== null, "so is nothing at all");
has(threw({ "app/page.tsx": 42 }) !== null, "a file with no string content is refused");

/* THE CASE COLLISION. Two files here, one file on the laptop somebody
   downloads onto — and which of the two survives is a coin toss. */
const clash = threw([{ path: "app/Page.tsx", content: "a" }, { path: "app/page.tsx", content: "b" }]);
has(clash !== null, "two paths differing only by case are refused", clash ?? "(allowed)");
has(/same file on most machines/.test(clash ?? ""), "and it says why", clash ?? "");

has(threw([{ path: "a.ts", content: "x" }, { path: "a.ts", content: "y" }]) !== null, "the same file written twice is refused");

/* A file so large it is something embedded rather than written. */
has(threw({ "app/page.tsx": "x".repeat(300_000) }) !== null, "a file larger than source gets is refused");

/* And the whole tree, which is what gets stored per version. */
const huge = Object.fromEntries(
  Array.from({ length: 40 }, (_, i) => [`components/c${i}.tsx`, "x".repeat(200_000)]),
);
has(threw(huge) !== null, "a tree larger than a project is refused");
has(threw(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`c${i}.ts`, "x"]))) !== null, "and one with too many files in it");

// ── The old shape, as a tree ──────────────────────────────────────────────
/* Every page already stored is one HTML document and none will be regenerated.
   They become trees of one file rather than a second code path. */

const page = tree.treeFromPage("<!doctype html><html></html>");
has(tree.isSinglePage(page), "today's single page is a tree with one file in it");
has(tree.previewDocument(page) === "<!doctype html><html></html>", "and it is what the preview serves");

const source = tree.readTree({ "app/page.tsx": "export default () => null;" });
has(tree.previewDocument(source) === null, "a tree that is still source has no document to show");
has(tree.isSinglePage(source) === false, "and is not a single page");

const exported = tree.readTree({ "app/page.tsx": "x", "public/index.html": "<html>built</html>" });
has(tree.previewDocument(exported) === "<html>built</html>", "an exported tree serves its built index");

// ── The scaffold ──────────────────────────────────────────────────────────

const files = scaffold.platformFiles("Jephthah's Café", manifestFor("webapp", true), modelFor("webapp", true));
const find = (path) => files.find((f) => f.path === path);

/* THE ONE THAT FAILS AT INSTALL. These are built as strings; a trailing comma
   in either is a project that dies on the first command anybody runs. */
let pkg;
has(
  (() => { try { pkg = JSON.parse(find("package.json").content); return true; } catch { return false; } })(),
  "package.json parses as JSON",
);
has(
  (() => { try { JSON.parse(find("tsconfig.json").content); return true; } catch { return false; } })(),
  "and so does tsconfig.json",
);

/* npm refuses a name with an apostrophe, a space or a capital in it — and it
   refuses it at install, before anything else has a chance to go wrong. */
has(pkg.name === "jephthah-s-cafe", "the project name is slugged into something npm accepts", pkg.name);
has(scaffold.packageName("") === "quickstark-app", "and a nameless project still gets a valid one");
has(scaffold.packageName("...") === "quickstark-app", "as does one that slugs to nothing");
has(/^[a-z0-9][a-z0-9._-]*$/.test(pkg.name), "the slug matches what npm will take", pkg.name);

/* Static export is the decision the whole stack rests on. */
const config = find("next.config.mjs").content;
has(/output:\s*"export"/.test(config), "next.config asks for a static export");
has(/unoptimized:\s*true/.test(config), "and turns the image optimiser off, which export requires");

/* The version pins. A caret here means two projects generated a month apart
   install different frameworks. */
has(/^\d+\.\d+\.\d+$/.test(pkg.dependencies.next), "next is pinned exactly, not carted", pkg.dependencies.next);
has(/^\d+\.\d+\.\d+$/.test(pkg.dependencies.react), "and so is react", pkg.dependencies.react);

/* The client is a browser client, and the file has to say why that is safe. */
const client = find("lib/supabase.ts").content;
has(/NEXT_PUBLIC_SUPABASE_ANON_KEY/.test(client), "the generated client uses the anon key");
has(!/SERVICE_ROLE/.test(client), "and never the service key, which has no safe home in an exported app");
has(/row-level security/i.test(client), "and says out loud that RLS is the only thing protecting the data");

has(!scaffold.platformFiles("x", manifestFor("landing", false), modelFor("landing", false)).some((f) => f.path === "lib/supabase.ts"), "a project with no backend gets no client");
has(
  !scaffold.platformFiles("x", manifestFor("landing", false), modelFor("landing", false)).find((f) => f.path === "package.json").content.includes("@supabase/supabase-js"),
  "nor the dependency",
);

/* Every path the scaffold writes must survive the path rule it will be read
   back through. A generated file at a refused path is a build that fails on
   its own plumbing. */
has(
  files.every((f) => accepts(f.path)),
  "every file the scaffold writes has a path the reader accepts",
  files.filter((f) => !accepts(f.path)).map((f) => f.path).join(", "),
);

// ── Merging ───────────────────────────────────────────────────────────────

/* What a real generation comes back with: the pages, the layout and the design
   system, and nothing else. layout.tsx and globals.css are the model's to write
   precisely because they carry the design — see REQUIRED_FILES, which checks for
   them, against platformFiles, which does not supply them. */
const generated = tree.readTree({
  "app/page.tsx": "export default () => <h1>Hi</h1>;",
  "app/layout.tsx": "export default function L({children}){return <html><body>{children}</body></html>;}",
  "app/globals.css": ":root{--bg:#0b0f19}",
  "tailwind.config.ts": "// the model wrote its own, because the design needed one",
});
const complete = scaffold.completeTree(generated, "My Shop", manifestFor("ecommerce", true), modelFor("ecommerce", true));
const at = (path) => complete.find((f) => f.path === path);

has(at("package.json") !== undefined, "the plumbing is filled in under what the model wrote");
has(at("app/page.tsx").content.includes("<h1>Hi</h1>"), "and the model's own files survive");
/* ── This expectation is the opposite of what it used to be ────────────────
 *
 * It read "the model wins a collision — taking its config away would undo what
 * was asked for", and that was right while tailwind.config.ts was the model's
 * to write. It stopped being right when the design system arrived: the
 * scaffold now writes tokens into app/tokens.css and maps their NAMES in
 * tailwind.config.ts, so `bg-ground` resolves to var(--ground).
 *
 * A model-written config has an empty theme, so those class names compile to
 * nothing — which shipped, and deployed as a page with no styling at all: two
 * white rectangles on black. tailwind.config.ts joined PLATFORM_OWNED in that
 * fix; this assertion did not follow it and had been failing ever since,
 * against code that is doing the right thing.
 *
 * The general rule is unchanged and is asserted directly above: the model's
 * own files survive. The exception is narrow and is the one this file now
 * guards — a path whose correct contents are known here and cannot be known by
 * a model. */
has(
  at("tailwind.config.ts").content.includes("var(--ground)"),
  "the platform wins a collision on a config that carries the design tokens",
  "a model-written tailwind.config has an empty theme, so every token class compiles to nothing",
);
has(
  complete.map((f) => f.path).join() === [...complete].sort((a, b) => a.path.localeCompare(b.path)).map((f) => f.path).join(),
  "and the result is in a stable order",
);

// ── What is still missing ─────────────────────────────────────────────────

has(scaffold.missingFrom(complete).length === 0, "a completed tree is buildable", scaffold.missingFrom(complete).join("; "));

const noPage = scaffold.completeTree(tree.readTree({ "components/Nav.tsx": "x" }), "app", manifestFor("landing", false), modelFor("landing", false));
const missing = scaffold.missingFrom(noPage);
has(missing.length > 0, "a tree with no home page is reported as unbuildable");
has(/app\/page\.tsx/.test(missing.join(" ")), "and it names the file", missing.join("; "));

// ── The brief ─────────────────────────────────────────────────────────────

for (const kind of ["landing", "ecommerce", "blog", "webapp", "news"]) {
  const brief = scaffold.treeBrief(kind, manifestFor(kind, true), modelFor(kind, true));
  has(brief.includes("app/page.tsx"), `${kind}: the home page is asked for`);
  has(/DO NOT WRITE/.test(brief), `${kind}: and the plumbing is explicitly not asked for`);
  has(/no route handlers|No route handlers/.test(brief), `${kind}: the export limits are stated`);
}

has(
  /generateStaticParams/.test(scaffold.treeBrief("blog", manifestFor("blog", false), modelFor("blog", false))),
  "a kind with dynamic routes is told what export needs from them",
);
has(
  !/supabase/i.test(scaffold.treeBrief("landing", manifestFor("landing", false), modelFor("landing", false))),
  "and a project with no backend is not told to talk to one",
);


/* ── Editing a project, rather than the receipt for one ────────────────────
 *
 * The defect these guard was silent in every way a defect can be. A Next.js
 * build stores .tsx in project_files and a SUMMARY of the project in the html
 * column; the edit path read that column and nothing else. So every edit to a
 * project edited the summary — blocks matched, the patch applied, validation
 * passed, a version was stored and charged for — and the customer's actual
 * source was never touched. pickFile, which exists to choose the file, had no
 * caller at all.
 */
const route = readFileSync(join(process.cwd(), "src/app/api/build/route.ts"), "utf8");

console.log("\nA project's source is what an edit changes:");

has(
  /pickFile\(/.test(route) && /editSource\(/.test(route),
  "the build route picks a file and edits its source",
  "without this every edit to a Next.js project edits the summary page",
);

has(
  /currentTree\(service, project\.id\)/.test(route),
  "and it loads the tree rather than reading the html column",
);

has(
  route.indexOf("if (intent === \"edit\" && service) {") <
    route.indexOf("if (intent === \"edit\" && currentHtml) {"),
  "the project path is tried before the page path",
  "a tree build has an html column too — it is the summary, and reaching it first is the bug",
);

has(
  /storeTree\(\s*service/.test(route),
  "the changed tree is stored as a new version",
);

has(
  /startDeployment\(edited/.test(route),
  "and the change is put online, not just stored",
  "source changed and not deployed leaves the customer's site on the previous build",
);

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
