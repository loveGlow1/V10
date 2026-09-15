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

/* ── What the audit found once it went the other way ──────────────────────
 *
 * The checks above ask "is everything the code uses written down". Auditing
 * the live database against this file asked the reverse — "is everything the
 * database does written down" — and turned up four things that were not, all
 * of them real and two of them load-bearing:
 *
 *   project_assets            a table in production since the asset pipeline
 *                             shipped, absent from the file entirely
 *   its read policy           the rule deciding who can see an asset row
 *   rls_auto_enable           an event trigger that switches RLS on for every
 *                             new table in public — the backstop that makes
 *                             "every table has RLS" true even when a runtime-
 *                             created schema forgets
 *   sweep_crypto_payments     a pg_cron function that makes an OUTBOUND HTTP
 *                             call from inside the database
 *
 * None could be found by reading src/, which is why they are pinned by name
 * here: a file that omits its own security controls is not a description of
 * the database, and a file nobody can trust is the cover three tables went
 * missing from production under. */
console.log("");
for (const [needle, what] of [
  ['create table if not exists public.project_assets', "project_assets is declared"],
  ['create policy "Owners read their project assets"', "and who may read an asset row"],
  ["create or replace function public.rls_auto_enable", "rls_auto_enable is declared"],
  ["create event trigger ensure_rls", "and the event trigger that runs it on every new table"],
  ["create or replace function public.sweep_crypto_payments", "sweep_crypto_payments is declared"],
  ["create trigger project_files_set_updated_at", "project_files keeps its updated_at trigger"],
]) {
  has(schema.includes(needle), what, `missing from supabase/schema.sql: ${needle}`);
}

/* The sweep reads its bearer token from Vault at call time. The token must
   never be in this repository, and writing the function down is exactly the
   moment somebody might paste one in beside it. */
has(
  /vault\.decrypted_secrets/.test(schema) && !/Bearer [A-Za-z0-9_.-]{12,}/.test(schema),
  "and reads its token from Vault rather than carrying one",
  "a secret has been written into supabase/schema.sql",
);

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
