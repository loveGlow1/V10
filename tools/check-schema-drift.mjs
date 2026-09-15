#!/usr/bin/env node
/* Every table the code talks to is a table the schema declares.
 *
 *   npm run check:schema-drift
 *
 * Three tables the application writes to did not exist in the production
 * database: build_jobs, build_steps and project_deployments. They were declared
 * in supabase/schema.sql and the file had simply never been applied.
 *
 * Nothing said so, because every one of those writers is careful in the way
 * that hides this. liveJob logs and returns null. recordDeployment returns
 * null. So the build state machine recorded nothing for days — every job
 * lookup answered "no job", which reads exactly like "no build running" — and
 * every deployment was created at Vercel and then never polled, because the
 * row the poller reads from was never written. A project could be built,
 * uploaded, built again by Vercel, and lose its address, with no error
 * anywhere.
 *
 * ── WHAT THIS CAN AND CANNOT SEE ──────────────────────────────────────────
 *
 * It reads source, not a database. It CANNOT tell whether schema.sql has been
 * applied — that is the failure above and no offline check reaches it. What it
 * catches is the step before: a table the code reads or writes that nothing
 * declares. That is the commoner drift and the one a person introduces by
 * hand, and it is the reason those three were worth looking for at all.
 *
 * The honest boundary is worth stating rather than implying: green here means
 * the code and the schema file agree, not that the database matches either.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d ? ` — ${d}` : ""}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const root = process.cwd();

/* Declared: every `create table ... public.<name>` in the schema. */
const schema = readFileSync(join(root, "supabase/schema.sql"), "utf8");
const declared = new Set(
  [...schema.matchAll(/create table (?:if not exists )?public\.([a-z0-9_]+)/g)].map((m) => m[1]),
);

/* Used: every `.from("<name>")` in the application's own source.
 *
 * A generated project's client also calls .from(), which is why this reads
 * src/ rather than anything the builder emits — those tables live in the
 * customer's own schema and are nothing to do with this file. */
const used = new Map();
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    if (!/\.tsx?$/.test(path)) continue;
    const source = readFileSync(path, "utf8");
    /* `.storage.from("attachments")` names a BUCKET, not a table, and the two
       spellings are identical after the dot. Skipped by what precedes the
       call rather than by a list of bucket names, which would go stale. */
    for (const match of source.matchAll(/(\.storage\s*)?\.from\(\s*["'`]([a-z0-9_]+)["'`]\s*\)/g)) {
      if (match[1]) continue;
      const table = match[2];
      if (!used.has(table)) used.set(table, new Set());
      used.get(table).add(path.slice(root.length + 1));
    }
  }
};
walk(join(root, "src"));

/* Tables that belong to somebody else's database, not ours. Named rather than
   pattern-matched: an exception nobody wrote down is an exception nobody can
   review. */
const NOT_OURS = new Set([
  /* Supabase Storage's own table, reached through the storage schema. */
  "objects",
  /* A generated project's own tables, in its own schema — these appear in
     source only as examples inside prompts and scaffolding. */
  "profiles", "products", "orders", "posts", "pages", "media", "categories",
]);

console.log(`${declared.size} tables declared, ${used.size} reached from src/\n`);

let undeclared = 0;
for (const [table, files] of [...used].sort()) {
  if (NOT_OURS.has(table)) continue;
  if (declared.has(table)) continue;
  undeclared += 1;
  fail(
    `${table} is written to but never declared`,
    `reached from ${[...files].slice(0, 3).join(", ")}`,
  );
}
has(undeclared === 0, "every table the app reaches is declared in supabase/schema.sql");

/* And the three that were missing, named, so the next person to wonder whether
   they were ever added has an answer in the test rather than in a migration
   log. */
for (const table of ["build_jobs", "build_steps", "project_deployments"]) {
  has(declared.has(table), `${table} is declared`);
  has(used.has(table), `${table} is actually used, so declaring it is not decoration`);
}

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
