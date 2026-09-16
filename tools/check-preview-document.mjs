#!/usr/bin/env node
/* The document that runs a generated project in the builder.
 *
 *   npm run check:preview-document
 *
 * Everything here is an invariant that fails SILENTLY and TOTALLY when it
 * breaks — the pane goes blank or shows a stack trace, for every project on the
 * platform at once, and nothing upstream reports a problem because the build
 * succeeded and the files are fine.
 *
 * The React version is the sharpest of them. React 19 ships no UMD build at
 * all, so a well-meaning bump of that constant to match package.json 404s the
 * script tag, leaves `React` undefined and breaks every preview. It looks like
 * housekeeping and it is an outage, which is exactly the kind of change a test
 * has to be standing in front of.
 *
 * No keys, no network: the CDN is not reached, the RULE about which versions
 * may be pinned is asserted instead.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-preview-document");
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
      include: [join(root, "src/lib/builder/preview/app-preview.ts")],
    },
    null,
    2,
  ),
);
try {
  execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { stdio: ["ignore", "ignore", "pipe"] });
} catch {
  /* The emit is what matters; `tsc --noEmit` over the repo catches type errors
     and this does not replace it. */
}
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));

const require = createRequire(import.meta.url);
const { appPreviewDocument, canRenderApp, tailwindConfigScript, stylesheetOf } = require(
  join(out, "lib/builder/preview/app-preview.js"),
);

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const file = (path, content) => ({ path, content });

const minimal = [
  file("app/layout.tsx", 'export default function L({children}){return <div>{children}</div>;}'),
  file("app/page.tsx", "export default function P(){return <h1>Hi</h1>;}"),
];

/* ── The version that must not be bumped without thinking ───────────────── */

{
  const source = readFileSync(join(root, "src/lib/builder/preview/app-preview.ts"), "utf8");
  const react = source.match(/libs\/react\/(\d+)\.(\d+)\.(\d+)\/umd\//);
  has(Boolean(react), "the React script is pinned to an explicit version");
  has(
    react && Number(react[1]) <= 18,
    "React is pinned to a major that publishes a UMD build",
    react
      ? `pinned to ${react[0]} — React 19 and later ship no UMD, so this tag would 404 and every preview would break`
      : "no version found",
  );

  const dom = source.match(/libs\/react-dom\/(\d+)\.(\d+)\.(\d+)\/umd\//);
  has(
    dom && react && dom[0].split("/")[2] === react[0].split("/")[2],
    "react and react-dom are pinned to the same version",
    dom && react ? `${react[0]} vs ${dom[0]}` : "",
  );

  has(
    /libs\/babel-standalone\/\d+\.\d+\.\d+\//.test(source),
    "Babel is pinned to an explicit version",
  );
  has(!/@latest|\/latest\//.test(source), "nothing is pinned to a floating tag");
}

/* ── What it refuses to render ──────────────────────────────────────────── */

has(canRenderApp(minimal), "a tree with a page can be rendered");
has(!canRenderApp([file("components/Nav.tsx", "")]), "a tree with no page cannot");
has(appPreviewDocument({ tree: [] }) === null, "an empty tree yields no document");
has(
  appPreviewDocument({ tree: [file("lib/x.ts", "export const a = 1;")] }) === null,
  "a tree of helpers with no page yields no document, so the caller falls back",
);

/* ── The document ───────────────────────────────────────────────────────── */

{
  const doc = appPreviewDocument({ tree: minimal, projectName: "Lumen" });
  has(doc.startsWith("<!doctype html>"), "it is a document");
  has(doc.includes("<title>Lumen</title>"), "the project names the tab");
  has(
    doc.includes('content="app-preview"'),
    "it marks itself, so the workspace can tell a rendered app from a summary",
  );
  has(doc.includes("__QS_FILES"), "the source travels with it");
  has(doc.includes("__QS_ROUTES"), "the route table travels with it");

  /* Script order is load-bearing: the runtime uses React, ReactDOM and Babel
     the moment it runs, so all three tags must come first. */
  const react = doc.indexOf("libs/react/");
  const babel = doc.indexOf("babel-standalone");
  const runtime = doc.indexOf("__QS_FILES");
  const start = doc.lastIndexOf("(function ()");
  has(react < runtime && babel < runtime, "the libraries load before the project data");
  has(runtime < start, "the project data is set before the runtime runs");
}

/* ── Escaping, which is the one that is a security bug rather than a bug ── */

{
  const hostile = [
    file("app/page.tsx", 'export default function P(){return <p>{"</script><script>window.__owned=1</script>"}</p>;}'),
  ];
  const doc = appPreviewDocument({ tree: hostile });
  has(
    !doc.includes("</script><script>window.__owned"),
    "source containing a closing script tag cannot break out of the data block",
  );
  has(doc.includes("\\u003c"), "angle brackets in embedded source are escaped");
}

{
  const named = appPreviewDocument({ tree: minimal, projectName: '<img src=x onerror=alert(1)>' });
  has(!named.includes("<img src=x"), "a project name cannot inject markup into the title");
}

/* ── The stylesheet ─────────────────────────────────────────────────────── */

{
  const styled = [
    ...minimal,
    file("app/globals.css", '@import "./tokens.css";\n@tailwind base;\nbody{color:red}'),
    file("app/tokens.css", ":root{--ink:#111}"),
  ];
  const css = stylesheetOf(styled);
  has(css.includes("--ink:#111"), "a relative CSS import is inlined", css);
  has(!css.includes("@import"), "the import itself is gone");

  const remote = stylesheetOf([
    ...minimal,
    file("app/globals.css", '@import url("https://fonts.googleapis.com/css2?family=Inter");\nbody{}'),
  ]);
  has(remote.includes("fonts.googleapis.com"), "a real URL import is left alone to fetch");
}

/* ── The Tailwind theme ─────────────────────────────────────────────────── */

{
  const withConfig = [
    ...minimal,
    file(
      "tailwind.config.ts",
      'import type { Config } from "tailwindcss";\n\nconst config: Config = {\n  theme: { extend: { colors: { ink: "var(--ink)" } } },\n};\n\nexport default config;\n',
    ),
  ];
  const script = tailwindConfigScript(withConfig);
  has(Boolean(script), "a tailwind config is extracted");
  has(!/^\s*import\s/m.test(script), "the type import is stripped");

  const sandbox = { window: {} };
  vm.createContext(sandbox);
  let threw = null;
  try {
    vm.runInContext(script, sandbox);
  } catch (error) {
    threw = error;
  }
  has(!threw, "the extracted config is valid JavaScript", threw ? String(threw.message) : "");
  has(
    sandbox.window.__qsTailwind &&
      sandbox.window.__qsTailwind.theme.extend.colors.ink === "var(--ink)",
    "the project's own tokens survive into the theme",
    JSON.stringify(sandbox.window.__qsTailwind),
  );
}

{
  const inline = tailwindConfigScript([
    ...minimal,
    file("tailwind.config.ts", 'export default { theme: { extend: {} } } satisfies Config;\n'),
  ]);
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  let threw = null;
  try { vm.runInContext(inline, sandbox); } catch (error) { threw = error; }
  has(!threw, "an inline `export default {...} satisfies Config` also extracts", threw ? String(threw.message) : "");
}

has(
  tailwindConfigScript(minimal) === null,
  "a project with no tailwind config asks for none rather than inventing one",
);

/* A config shape this does not understand is dropped rather than guessed at —
   Tailwind's defaults still style the page, and a syntax error in this tag
   would take the whole document down with it. */
has(
  tailwindConfigScript([...minimal, file("tailwind.config.ts", "module.exports = { theme: {} };")]) === null,
  "an unrecognised config shape is dropped rather than half-translated",
);

/* ── And the route has to REACH this renderer ─────────────────────────────
 *
 * Everything above tests a renderer that, for thirteen of the fourteen
 * projects in production, was never called.
 *
 * The preview route decided which kind of build it was holding by asking
 * `isProjectSummary(build.html)` — a marker written into the receipt. The
 * marker was added on 15 September; every project built before that has a
 * receipt without one. So the test read false, the branch was skipped, and the
 * route fell through to serving `build.html`: the receipt, framed in the pane
 * where the customer's application should be. The complaint that started all of
 * this — "users should not get a summary in that manner" — was still true of
 * every project the customer owned, with the fix merged and deployed.
 *
 * Whether a build is a project is a fact about the BUILD: it has source files.
 * That is true of a project stored last week and of one stored ten minutes ago,
 * and it needs no marker to have been written at the time. */
const previewRoute = readFileSync(join(root, "src/app/preview/[projectId]/route.ts"), "utf8");
const storeTree = readFileSync(join(root, "src/lib/builder/store-tree.ts"), "utf8");

/* And then the same lesson, one level up.
 *
 * `loadTree(build.id)` is the right question about a BUILD and the wrong one
 * about a PROJECT. A build row can exist without its files — an older save
 * path, an orchestrator step that wrote the summary and stopped — and when the
 * newest one is like that, the empty tree left the renderer nothing to route
 * and the pane fell through to the receipt all over again.
 *
 * Three projects in production are in that state, and two of them have a
 * complete tree on the build immediately before. */
has(
  /await currentTree\(supabase, projectId\)/.test(previewRoute),
  "the route asks the PROJECT for its files, not just the newest build row",
);
has(
  /async function newestStoredTree\(/.test(storeTree),
  "a build row without its files does not mean the project has no source",
  "two of the three projects in this state have a complete tree one build back",
);
has(
  /const found = ids\.find\(\(id\) => withFiles\.has\(id\)\)/.test(storeTree),
  "and the NEWEST build that has source is the one it recovers",
);
has(
  /sourceMissing: true/.test(storeTree),
  "with the receipt kept as the answer of last resort, for a project with none anywhere",
);

has(
  /tree\.length > 0 \|\| isProjectSummary\(/.test(previewRoute),
  "and a build WITH FILES is a project, whatever its stored document says",
  "asking only the marker skips every project built before the marker existed",
);

has(
  /if \(!wantsDiagnostics && isProject\)/.test(previewRoute),
  "the render branch is taken on that answer",
);

/* The receipt is still reachable, and still only where it was asked for. */
has(
  /wantsDiagnostics/.test(previewRoute) && /cannotRender\(\)/.test(previewRoute),
  "a tree that cannot be routed says so rather than being handed the receipt",
  "the summary stays at ?diagnostics=1, which is where somebody goes to look for it",
);

/* ── A design that does not hang on one third-party script ───────────────
 *
 * A project's whole stylesheet — its tokens, its base element styles, its
 * container rule — used to go into `<style type="text/tailwindcss">` and
 * nowhere else. A browser does not apply a style element with an unknown
 * type; only the Tailwind CDN script does, after it loads, by reading that
 * block and compiling it.
 *
 * Measured in Chromium against a real project with that one request failing:
 * the page still RENDERS correctly — heading, cards, footer, the header
 * collapsing at 390px — and it renders in Times New Roman with no palette, no
 * gutters and blue underlined links, text against the edge of the glass.
 * Indistinguishable, to the person looking at it, from us having built them
 * something broken.
 *
 * So the stylesheet is emitted twice: natively first, then in the Tailwind
 * block as before. With the CDN up the second wins on order and nothing
 * changes. Without it, the design survives. */
{
  const styled = [
    ...minimal,
    file("app/tokens.css", ":root { --ground: #FBFAF8; --ink: #16150F; --container: 1200px; }"),
    file(
      "app/globals.css",
      "@import './tokens.css';\n\n@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n" +
        "body { background: var(--ground); color: var(--ink); }\n" +
        ".container { max-width: var(--container); margin: 0 auto; padding: 0 24px; }",
    ),
  ];

  const doc = appPreviewDocument({ tree: styled, projectName: "Styled" });

  const native = doc.match(/<style>([\s\S]*?)<\/style>/g) ?? [];
  const carriesDesign = native.some(
    (block) => /--ground/.test(block) && /\.container/.test(block),
  );

  has(
    carriesDesign,
    "THE PROJECT'S CSS IS IN A PLAIN <style> THE BROWSER APPLIES",
    "without this the whole design is contingent on cdn.tailwindcss.com loading",
  );
  has(
    /<style type="text\/tailwindcss">/.test(doc),
    "and still in the Tailwind block, so utility classes keep working",
  );
  has(
    doc.indexOf("<style>") < doc.indexOf('<style type="text/tailwindcss">'),
    "with the native copy FIRST, so a CDN that does load still wins on order",
    "otherwise this would change how every styled preview looks today",
  );

  const nativeBlock = native.find((block) => /--ground/.test(block)) ?? "";
  has(
    !/@tailwind\s/.test(nativeBlock),
    "the @tailwind directives are stripped from the native copy",
    "they mean nothing to a browser and only litter the console",
  );
  has(
    !/@import\s+['"]\.\//.test(nativeBlock),
    "and so is the relative @import, which stylesheetOf has already inlined",
  );
}

console.log(failed === 0 ? "\nAll preview document checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
