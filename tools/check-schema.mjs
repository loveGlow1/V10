#!/usr/bin/env node
/* Every table the code uses is a table somebody declared.
 *
 *   npm run check:schema
 *
 * The database this app talks to is described in supabase/*.sql, and that
 * description is only worth having if it is complete. A table that exists on
 * the live instance because somebody once ran a statement by hand works
 * perfectly until the day a second environment is built from these files, and
 * then it is missing — with the failure landing at runtime, in whichever
 * feature happened to need it, rather than at deploy time where it could be
 * read.
 *
 * This is the cheap half of that problem and the half that needs no network:
 * every `.from("x")` in the source has to name something the SQL creates. It
 * does not prove the columns match — that needs a live connection, and a check
 * nobody can run without credentials is a check nobody runs. What it does prove
 * is that nothing in the codebase is talking to a table this repository has
 * never heard of.
 *
 * WHY IT EXISTS. credit_plans said one thing in schema.sql and another in
 * credits.ts, and the Pro plan granted 600 credits while every screen quoted
 * 300 — for as long as it took somebody to notice. Drift here is not
 * theoretical.
 *
 * No keys, no network.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

/* Tables the SQL declares, across every file in supabase/ — the schema is in
   more than one of them, which is itself easy to forget. */
const declared = new Set();
const sqlDir = join(root, "supabase");
for (const file of readdirSync(sqlDir)) {
  if (!file.endsWith(".sql")) continue;
  const sql = readFileSync(join(sqlDir, file), "utf8");
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi)) {
    declared.add(m[1]);
  }
  /* A view is a thing you can select from too. */
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?(\w+)/gi)) {
    declared.add(m[1]);
  }
  /* `create policy "…" on public.x` would otherwise leave "on" in the set. */
  declared.delete("on");
}

/* Tables the code reaches for. supabase-js spells every one of them the same
   way, which is what makes this greppable at all. */
function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

/* Prompt text, not code. schema.ts teaches a model how to query its own
   generated tables — `supabase.from("products")` inside a template literal —
   and a table named in an instruction is not a table this app talks to. */
const PROMPT_SOURCES = new Set(["src/lib/builder/schema.ts"]);

const used = new Map();
for (const file of sources(join(root, "src"))) {
  if (PROMPT_SOURCES.has(file.replace(`${root}/`, ""))) continue;
  const code = readFileSync(file, "utf8");
  for (const m of code.matchAll(/\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(file.replace(`${root}/`, ""));
  }
}

/* Not ours. Supabase Storage buckets share the .from() spelling with tables,
   and a generated project's own tables are created per project at build time
   by provision.ts rather than declared here. */
const NOT_TABLES = new Set(["project-attachments", "attachments", "avatars", "assets"]);

let failed = 0;
const missing = [];
for (const [table, files] of [...used].sort()) {
  if (NOT_TABLES.has(table)) continue;
  if (!declared.has(table)) {
    failed++;
    missing.push({ table, files: [...files] });
  }
}

console.log(`${declared.size} tables declared in supabase/*.sql`);
console.log(`${used.size} distinct tables referenced from src/`);
console.log();

if (missing.length === 0) {
  console.log("ok    every table the code uses is declared in the schema");
} else {
  for (const { table, files } of missing) {
    console.log(`FAIL  "${table}" is used but never created`);
    for (const file of files) console.log(`        ${file}`);
  }
}

/* The other direction is informational rather than a failure. A declared table
   nothing reads yet is an ordinary state — the schema may simply be ahead of
   the feature — and failing on it would make adding a table a two-commit job. */
const unused = [...declared].filter((t) => !used.has(t)).sort();
if (unused.length) {
  console.log(`\nnote  declared but not referenced from src/: ${unused.join(", ")}`);
}

console.log(failed === 0 ? "\nall good" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
