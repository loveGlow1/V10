#!/usr/bin/env node
/* Real photographs in a generated project.
 *
 *   npm run check:tree-images
 *
 * The single-page stack has had a fill pass since images.ts was written: the
 * model declares a slot carrying art direction and no src, and real pixels go
 * in after generation. The file tree never got one — fillImages is called on
 * the single HTML document and a project build skips it — so a project's
 * pictures could only come from the pipeline that runs BEFORE generation, and
 * when that returned nothing the model drew a neutral panel and that was final.
 * Grey rounded rectangles, reported as "images show as blank placeholders".
 *
 * What is defended here:
 *
 *   ONE exclusion set across the whole project. Within a page images.ts already
 *   stops two slots sharing a photograph; across a project the same rule has to
 *   hold, or a four-page site shows the same hero four times.
 *
 *   ONE budget across the whole project, well under the tree's own ceiling. A
 *   build that fetches beautiful photographs and is then refused for being too
 *   large has cost somebody their entire build.
 *
 *   NEVER throwing, and never losing a file. An unconfigured or failing
 *   provider leaves neutral placeholders, which is what makes photographs a
 *   deployment decision rather than a dependency.
 *
 * No keys, no network: the provider below is a stub.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-tree-images");
mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify(
    {
      extends: join(root, "tsconfig.json"),
      compilerOptions: {
        noEmit: false, outDir: out, rootDir: join(root, "src"),
        module: "commonjs", moduleResolution: "node",
        declaration: false, incremental: false, plugins: [],
        baseUrl: root, paths: { "@/*": ["src/*"] },
      },
      include: [join(root, "src/lib/builder/tree-images.ts")],
    },
    null,
    2,
  ),
);
try {
  execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { stdio: ["ignore", "ignore", "pipe"] });
} catch {}
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));
const shim = join(out, "node_modules");
mkdirSync(shim, { recursive: true });
try { symlinkSync(out, join(shim, "@"), "dir"); } catch {}

const require = createRequire(import.meta.url);
const { fillTreeImages, declaresPhotographs, TREE_IMAGE_BUDGET_BYTES } = require(
  join(out, "lib/builder/tree-images.js"),
);

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const file = (path, content) => ({ path, content });
const at = (tree, path) => tree.find((f) => f.path === path)?.content ?? "";

const slot = (shot, weight = "feature") =>
  `<img data-shot="${shot}" data-ratio="4/5" data-weight="${weight}" alt="${shot}">`;

/* A provider that always answers, with a different picture each time. */
function stubProvider(bytesEach = 1000) {
  let n = 0;
  return {
    async shotFor(_slot, _width, _context, options) {
      n += 1;
      const id = `stub:${n}`;
      if (options?.exclude && [...options.exclude].includes(id)) return null;
      return {
        id,
        bytes: Buffer.alloc(bytesEach, 65),
        contentType: "image/jpeg",
        credit: { author: `A${n}`, source: "stub", url: "https://example.com" },
      };
    },
  };
}

const TREE = [
  file("app/page.tsx", `export default function Home(){ return <section>${slot("a loaded truck at dawn", "hero")}</section>; }`),
  file("components/Feature.tsx", `export default function F(){ return <div>${slot("a warehouse aisle")}</div>; }`),
  file("lib/data.ts", "export const ROUTES = [];"),
  file("package.json", '{"name":"x"}'),
];

/* ── It fills, and it fills the right files ─────────────────────────────── */

{
  const result = await fillTreeImages(TREE, stubProvider());
  has(result.filled === 2, "every declared slot in the project is filled", `filled=${result.filled}`);
  has(
    at(result.tree, "app/page.tsx").includes("src=\"data:image/jpeg;base64,"),
    "a page's slot gets real pixels",
  );
  has(
    at(result.tree, "components/Feature.tsx").includes("src=\"data:image/jpeg;base64,"),
    "and so does a component's",
  );
  has(at(result.tree, "lib/data.ts") === "export const ROUTES = [];", "a file with no markup is untouched");
  has(at(result.tree, "package.json") === '{"name":"x"}', "and so is the plumbing");
  has(result.tree.length === TREE.length, "no file is added or lost");
  has(result.credits.length === 2, "every photograph used is credited", `credits=${result.credits.length}`);
}

/* ── One exclusion set across the project ───────────────────────────────── */

{
  const result = await fillTreeImages(TREE, stubProvider());
  has(new Set(result.used).size === result.used.length, "no photograph is used twice across the project");
  has(
    at(result.tree, "app/page.tsx") !== at(result.tree, "components/Feature.tsx"),
    "so two files do not end up with the same picture",
  );
}

{
  /* Seeded with what earlier builds used, so a rebuild is not a repeat. */
  const result = await fillTreeImages(TREE, stubProvider(), { exclude: ["stub:1"] });
  has(!result.used.includes("stub:1"), "a photograph the project already used is not used again");
}

/* ── One budget across the project, under the tree's ceiling ─────────────── */

has(
  TREE_IMAGE_BUDGET_BYTES < 3_000_000,
  "the budget leaves room under MAX_TREE_BYTES for the project itself",
  `budget=${TREE_IMAGE_BUDGET_BYTES}`,
);

{
  /* A budget that covers one picture and not two. The second keeps its
     placeholder rather than the fill overrunning. */
  const result = await fillTreeImages(TREE, stubProvider(3000), { budget: 4200 });
  has(result.filled === 1, "spending stops at the budget", `filled=${result.filled}`);
  has(result.bytes <= 4200, "and never exceeds it", `bytes=${result.bytes}`);
  const both = at(result.tree, "app/page.tsx") + at(result.tree, "components/Feature.tsx");
  has(!both.includes('src=""'), "the slot that missed out still gets a placeholder, not an empty src");
}

/* ── Unconfigured, failing, and empty ───────────────────────────────────── */

{
  const result = await fillTreeImages(TREE, null);
  has(result.filled === 0, "no provider fills nothing");
  has(
    at(result.tree, "app/page.tsx").includes("src="),
    "but every slot still gets a neutral placeholder rather than a broken image",
  );
}

{
  const angry = { async shotFor() { throw new Error("rate limited"); } };
  const result = await fillTreeImages(TREE, angry);
  has(result.filled === 0, "a provider that throws costs no pictures it had");
  has(result.tree.length === TREE.length, "and costs no files at all");
}

{
  const none = [file("app/page.tsx", "export default function H(){ return <h1>Hi</h1>; }")];
  const result = await fillTreeImages(none, stubProvider());
  has(result.filled === 0, "a project declaring no slots is left alone");
  has(result.tree === none, "and returned by identity");
}

has(await fillTreeImages([], stubProvider()).then((r) => r.tree.length === 0), "an empty tree is handled");

/* ── Recognising a declaration ──────────────────────────────────────────── */

has(declaresPhotographs(TREE), "a tree with slots declares photographs");
has(!declaresPhotographs([file("app/page.tsx", "<h1>Hi</h1>")]), "one without them does not");
has(
  !declaresPhotographs([file("lib/x.ts", 'const s = "data-shot";')]),
  "and a non-markup file mentioning the attribute does not count",
);

console.log(failed === 0 ? "\nAll tree image checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
