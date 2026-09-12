#!/usr/bin/env node
/* The platform's own files have to compile together.
 *
 *   npm run check:generated-types
 *
 * lib/supabase.ts and lib/database.types.ts are PLATFORM_OWNED — the model
 * does not write them and cannot see them, and whatever it writes at those
 * paths is discarded (see check:ownership). That makes them the platform's
 * responsibility in a way the rest of a generated project is not: a mistake
 * here is not a model having a bad day, it is every project built from that
 * day on failing the same way.
 *
 * Which is what happened. A generated admin page opened with
 *
 *     type MediaRow = Database["public"]["Tables"]["media"]["Row"];
 *
 * — the obvious line, and the right one in every other Supabase codebase in
 * existence — and `next build` stopped dead:
 *
 *     Type error: Property 'public' does not exist on type 'Database'.
 *
 * Twenty-seven files compiled and the deployment died on a naming convention,
 * because the shared instance puts each project's tables in app_<projectid>
 * rather than in public, and the types file said so and nothing else.
 *
 * Nothing caught it here, because nothing here had ever compiled the files
 * these two produce. The other checks read them as TEXT and assert that
 * strings appear in them, which cannot see a type error at all.
 *
 * So this one runs tsc. It is the slowest check in the repo and it is the only
 * one that would have caught the failure it exists for.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-generated-types");
mkdirSync(out, { recursive: true });

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
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));

const shim = join(out, "node_modules");
mkdirSync(shim, { recursive: true });
try { execFileSync("ln", ["-sfn", out, join(shim, "@")]); } catch { /* already there */ }

const require = createRequire(import.meta.url);
const { completeTree } = require(join(out, "lib/builder/scaffold.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const MANIFEST = { type: "webapp", frontend: true, backend: true, database: true, authentication: true };

/* Both arrangements a real project can be in. The shared instance gives each
   project a schema of its own; somebody's own Supabase uses public, where
   there is nothing to share it with. Both have to compile. */
const CASES = [
  ["the shared instance, a schema per project", "app_c9bad93f9bd546039239608a09fe89d6"],
  ["somebody's own Supabase, where it is public", "public"],
];

for (const [label, schema] of CASES) {
  const model = {
    schema,
    tables: [
      { name: "media", columns: [
        { name: "id", type: "uuid" },
        { name: "path", type: "text" },
        { name: "alt", type: "text", nullable: true },
        { name: "created_at", type: "timestamptz", default: "now()" },
      ], policies: [] },
      { name: "post_tags", columns: [
        { name: "post_id", type: "uuid" },
        { name: "tag_id", type: "uuid" },
      ], policies: [] },
    ],
  };

  const tree = completeTree([{ path: "app/page.tsx", content: "export default function P() { return null; }" }],
    "Newsroom", MANIFEST, model);

  const at = (path) => tree.find((f) => f.path === path)?.content ?? null;
  const types = at("lib/database.types.ts");
  const client = at("lib/supabase.ts");

  if (!types || !client) {
    fail(`${label}: the platform writes both files`, `types=${Boolean(types)} client=${Boolean(client)}`);
    continue;
  }

  /* Compiled in a directory inside the repo, so `@supabase/supabase-js`
     resolves the way it does in a real project. */
  const sandbox = join(root, ".check-generated-types");
  rmSync(sandbox, { recursive: true, force: true });
  mkdirSync(join(sandbox, "lib"), { recursive: true });
  writeFileSync(join(sandbox, "lib/database.types.ts"), types);
  writeFileSync(join(sandbox, "lib/supabase.ts"), client.replace(/@\/lib\//g, "./"));

  /* A consumer written the way a model writes one — which is to say, the way
     the Supabase documentation writes one. THE FIRST LINE IS THE ONE THAT
     FAILED A REAL DEPLOYMENT. */
  writeFileSync(join(sandbox, "lib/consumer.ts"), `import { supabase } from "./supabase";
import type { Database, Media } from "./database.types";

type MediaRow = Database["public"]["Tables"]["media"]["Row"];
type ByRealName = Database["${schema}"]["Tables"]["media"]["Row"];

export async function load(): Promise<MediaRow[]> {
  const { data } = await supabase.from("media").select("id, path, alt, created_at");
  return (data as unknown as MediaRow[]) ?? [];
}

export const byRealName: ByRealName | null = null;
export const byAlias: Media | null = null;
`);

  let errors = "";
  try {
    execFileSync("npx", [
      "tsc", "--strict", "--noEmit", "--skipLibCheck",
      "--moduleResolution", "bundler", "--module", "esnext",
      "--target", "ES2022", "--lib", "dom,dom.iterable,esnext",
      join(sandbox, "lib/database.types.ts"),
      join(sandbox, "lib/supabase.ts"),
      join(sandbox, "lib/consumer.ts"),
    ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    errors = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
  }

  has(errors === "", `${label}: the generated data layer compiles`, errors.split("\n").slice(0, 6).join("\n        "));

  /* Said separately from the compile, so a future failure names which half
     broke rather than just "it did not compile". */
  has(types.includes('public:') || schema === "public",
    `${label}: the tables are reachable as Database["public"]`);
  has(types.includes(schema),
    `${label}: and under the schema the rows are really in`);

  rmSync(sandbox, { recursive: true, force: true });
}

console.log(failed === 0 ? "\nall good" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
