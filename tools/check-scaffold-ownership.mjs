#!/usr/bin/env node
/* The model may not write the connection string.
 *
 *   npm run check:ownership
 *
 * completeTree merges what the platform scaffolds with what the model wrote,
 * and for almost everything the model wins — app/** is its job and a
 * placeholder should lose to a real page. For a handful of paths that is
 * exactly wrong, and one build showed why.
 *
 * Asked for a dashboard with sign-in, the model wrote its own lib/supabase.ts
 * with a hardcoded Supabase URL and anon key for a project that does not
 * exist. It overwrote a scaffolded client reading the three NEXT_PUBLIC_
 * variables and pinned to the schema the project's tables were really created
 * in. Nothing failed at build time and nothing failed at load; a Supabase
 * client does not complain until it is queried, so the app would have shipped
 * and quietly talked to nothing.
 *
 * These assertions are that fix, stated so it cannot come back: whatever the
 * model emits at an owned path, the platform's version is what ends up in the
 * tree — and the tree still takes the model's work everywhere else.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-ownership");
mkdirSync(out, { recursive: true });

/* CommonJS, not ESM, and the reason is worth a line: scaffold.ts imports its
   siblings as `./design`, and tsc does not rewrite that to `./design.js` when
   it emits ES modules — so Node cannot resolve a single one of them. CommonJS
   requires resolve extensionless paths, which is what makes the emitted graph
   runnable without a bundler. The `@/` alias is mapped for the same reason. */
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  extends: join(root, "tsconfig.json"),
  compilerOptions: {
    noEmit: false, outDir: out, rootDir: join(root, "src"),
    module: "commonjs", moduleResolution: "node",
    declaration: false, incremental: false, plugins: [],
    baseUrl: root, paths: { "@/*": ["src/*"] },
  },
  include: [join(root, "src/lib/builder/scaffold.ts")],
}, null, 2));
execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

/* The emitted graph is CommonJS, so it is required rather than imported. */
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));
const require = createRequire(import.meta.url);
const { completeTree } = require(join(out, "lib/builder/scaffold.js"));
const { SYSTEMS } = require(join(out, "lib/builder/design.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const MANIFEST = { type: "dashboard", frontend: true, backend: true, database: true, auth: true };
const MODEL = {
  schema: "app_55e34f8f84e14c578c5f0d86936acf42",
  tables: [{ name: "profiles", columns: [], policies: [] }],
};

/* Exactly what the model did on the build this check exists for. */
const FABRICATED = `import { createClient } from '@supabase/supabase-js';
const supabaseUrl = 'https://qlqyfmhjqtovyivwfjch.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiJ9.INVENTED.SIGNATURE';
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
`;

const tree = completeTree(
  [
    { path: "lib/supabase.ts", content: FABRICATED },
    { path: "next.config.mjs", content: "export default { output: undefined };" },
    { path: "tsconfig.json", content: "{}" },
    { path: "app/page.tsx", content: "export default function P() { return null; }" },
    { path: "app/dashboard/page.tsx", content: "export default function D() { return null; }" },
  ],
  "Dashboard with sign",
  MANIFEST,
  MODEL,
);

const at = (path) => tree.find((f) => f.path === path)?.content ?? "";

// ── The owned paths belong to the platform ────────────────────────────────

has(!at("lib/supabase.ts").includes("qlqyfmhjqtovyivwfjch"),
  "a fabricated Supabase URL never reaches the tree");
has(!at("lib/supabase.ts").includes("INVENTED"),
  "a fabricated anon key never reaches the tree");
has(at("lib/supabase.ts").includes("NEXT_PUBLIC_SUPABASE_URL")
    && at("lib/supabase.ts").includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  "the client reads its credentials from the environment");
has(at("lib/supabase.ts").includes(MODEL.schema),
  "the client is pinned to the schema the tables were created in");
has(at("next.config.mjs").includes('output: "export"'),
  "the model cannot turn off the static export");
has(at("tsconfig.json").includes("paths"), "the model cannot replace tsconfig");

// ── Everything else is still the model's ──────────────────────────────────

has(at("app/page.tsx").includes("function P"), "the model's home page survives");
has(at("app/dashboard/page.tsx").includes("function D"), "the model's routes survive");
has(tree.some((f) => f.path === "package.json"),
  "package.json is still scaffolded when the model omits it");

// ── The styling actually works ────────────────────────────────────────────
//
// The deployed login page rendered as two white rectangles on black: every
// className in the project compiled to nothing. Tailwind was installed and
// configured with an EMPTY theme while the prompt put every colour in
// tokens.css, and globals.css never asked for the utilities at all. Both
// halves are asserted here because either one alone still produces a page
// with no styling.

/* Asserted against a tree that HAS a stylesheet. The first tree above has
   none — platformFiles only scaffolds globals.css when a design system was
   decided — and assertions against a file that is not there pass or fail for
   reasons that have nothing to do with the fix. */
const twConfig = at("tailwind.config.ts");
has(twConfig.includes("var(--ground)") && twConfig.includes("var(--ink)"),
  "the token names are mapped, so bg-ground and text-ink are real classes");
has(!/theme:\s*\{\s*extend:\s*\{\s*\}\s*\}/.test(twConfig),
  "the theme is not left empty");

/* Applied even when the model wrote the stylesheet itself. */
const fromModel = completeTree(
  [{ path: "app/globals.css", content: "@import './tokens.css';\n\nbody { margin: 0 }" }],
  "Shop", MANIFEST, MODEL,
);
const modelCss = fromModel.find((f) => f.path === "app/globals.css").content;
has(/^@tailwind base;$/m.test(modelCss) && /^@tailwind utilities;$/m.test(modelCss),
  "globals.css asks for the Tailwind utilities");
has(modelCss.indexOf("@import") < modelCss.indexOf("@tailwind"),
  "the tokens @import still comes first, as CSS requires");
has(modelCss.includes("body { margin: 0 }"),
  "the model's own stylesheet survives underneath");

/* Idempotent: a stylesheet that already has them is left alone. */
const already = completeTree(
  [{ path: "app/globals.css", content: "@tailwind base;\n@tailwind components;\n@tailwind utilities;\nbody{}" }],
  "Shop", MANIFEST, MODEL,
);
const twice = already.find((f) => f.path === "app/globals.css").content;
has((twice.match(/@tailwind utilities;/g) || []).length === 1,
  "directives are not added twice");

/* ── The design system reaches the page ────────────────────────────────────
 *
 * Three files have to agree before a single colour appears: app/tokens.css
 * DEFINES --ground and six more, tailwind.config.ts MAPS them so `bg-ground`
 * is a real class, and app/globals.css LOADS the first one. The platform
 * writes two of those and used to write neither of the guarantees, so there
 * were two more ways to land on the same blank page as the bug above.
 *
 * Both are asserted against a tree built WITH a design system, because
 * platformFiles only writes tokens.css when there is one. */
const DNA = SYSTEMS[0];

/* The model writes its own tokens, having been told the project has some. Its
   file replaced ours, taking --ground with it, and every class the config maps
   then resolved to an empty custom property — which renders as the browser's
   own colours rather than as an error. */
const invented = completeTree(
  [
    { path: "app/tokens.css", content: ":root { --brand: #ff0000; }\n" },
    { path: "app/globals.css", content: "@import './tokens.css';\nbody{}" },
    { path: "app/page.tsx", content: "export default () => null;" },
  ],
  "Shop", MANIFEST, MODEL, DNA,
);
const tokens = invented.find((f) => f.path === "app/tokens.css").content;
has(!tokens.includes("--brand"), "the model cannot replace the design tokens");
has(
  ["--ground", "--surface", "--ink", "--muted", "--line", "--accent", "--accent-ink"]
    .every((name) => tokens.includes(name)),
  "every token tailwind.config.ts maps is defined",
  tokens.slice(0, 200),
);

/* And the line that connects them, which the brief asked for and nothing
   enforced. All three files present, every one of them correct, and not one
   colour arriving. */
const unlinked = completeTree(
  [
    { path: "app/globals.css", content: "body { margin: 0 }\n" },
    { path: "app/page.tsx", content: "export default () => null;" },
  ],
  "Shop", MANIFEST, MODEL, DNA,
);
const linked = unlinked.find((f) => f.path === "app/globals.css").content;
has(/@import\s+["'][^"']*tokens\.css["']/.test(linked),
  "a stylesheet that forgot the tokens import gets one", linked.slice(0, 120));
has(linked.indexOf("tokens.css") < linked.indexOf("@tailwind"),
  "and it comes before the directives, as CSS requires");
has(linked.includes("body { margin: 0 }"), "and the model's own stylesheet survives");

/* Not added twice to a stylesheet that already had it, in either spelling. */
for (const spelling of ['@import "./tokens.css";', "@import './tokens.css';", '@import "../app/tokens.css";']) {
  const once = completeTree(
    [{ path: "app/globals.css", content: `${spelling}\nbody{}` }],
    "Shop", MANIFEST, MODEL, DNA,
  ).find((f) => f.path === "app/globals.css").content;
  has((once.match(/tokens\.css/g) || []).length === 1,
    `an existing import is left alone — ${spelling}`, once.slice(0, 120));
}

/* And no import is invented when there are no tokens to import: without a
   design system platformFiles writes no tokens.css, and a stylesheet importing
   a file that does not exist fails the build. */
const noDesign = completeTree(
  [{ path: "app/globals.css", content: "body{}" }],
  "Shop", MANIFEST, MODEL,
).find((f) => f.path === "app/globals.css").content;
has(!noDesign.includes("tokens.css"),
  "no tokens import when the project has no tokens file", noDesign.slice(0, 120));

/* Only one entry per path, however many versions arrived. */
const dupes = tree.map((f) => f.path).filter((p, i, a) => a.indexOf(p) !== i);
has(dupes.length === 0, "no path appears twice", dupes.join(", "));

console.log(failed === 0 ? "\nall good" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
