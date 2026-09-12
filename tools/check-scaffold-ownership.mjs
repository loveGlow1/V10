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

/* Only one entry per path, however many versions arrived. */
const dupes = tree.map((f) => f.path).filter((p, i, a) => a.indexOf(p) !== i);
has(dupes.length === 0, "no path appears twice", dupes.join(", "));

console.log(failed === 0 ? "\nall good" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
