#!/usr/bin/env node
/* The tables an app's code uses, created from the SQL its build wrote.
 *
 *   npm run check:authored-sql
 *
 * Aurelia's dashboard shipped reading `favorites` while the database had only
 * `profiles` and `media`: the build wrote lib/schema.sql and nothing ran it.
 * The save route now runs that SQL — and because it runs a model's SQL against
 * somebody's real database, what it will run is pinned here: only creating,
 * always safe to run twice, never a statement that removes or rewrites data.
 *
 * Offline. The same file was also run twice against a real Postgres 16 when
 * this was written; that is not repeated here because CI has no database.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-authored-sql");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, strict: true, types: ["node"],
      typeRoots: [join(process.cwd(), "node_modules", "@types")],
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [join(process.cwd(), "src/lib/builder/backend/authored-sql.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

const { missingTables, authoredSql, prepareAuthoredSql } = await import(
  join(out, "lib/builder/backend/authored-sql.js")
);

let failed = 0;
let passed = 0;
const has = (cond, t, d) => {
  if (cond) { passed += 1; console.log(`ok    ${t}`); }
  else { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
};

console.log("\nWhich tables the code needs:");
const tree = [
  { path: "app/dashboard/saved/page.tsx", content: 'await supabase.from("favorites").select("*"); await supabase.from(\'profiles\').select();' },
  { path: "app/dashboard/profile/page.tsx", content: 'await supabase.storage.from("avatars").upload(path, file);' },
  { path: "lib/schema.sql", content: "create table favorites (id uuid primary key);" },
];
has(JSON.stringify(missingTables(tree, ["profiles", "media"])) === '["favorites"]', "a table the code queries and the plan lacks", JSON.stringify(missingTables(tree, ["profiles", "media"])));
has(!missingTables(tree, ["profiles"]).includes("avatars"), "a storage bucket is not a table");
has(authoredSql(tree)?.path === "lib/schema.sql", "the build's own SQL is found");

console.log("\nWhat is run:");
const sql = `
create type viewing_status as enum ('pending', 'done');
create table favorites (id uuid primary key, user_id uuid);
create unique index favorites_user_idx on favorites(user_id);
alter table favorites enable row level security;
alter table profiles add column phone text;
create policy "users read own favorites" on favorites for select using (auth.uid() = user_id);
-- drop table favorites;   (a comment, not a statement)
`;
const ready = prepareAuthoredSql(sql);
has(ready.ok, "a schema that only creates is accepted", ready.reason);
has(/exception when duplicate_object/.test(ready.sql), "a type is created only if it is not there");
has(/create table if not exists favorites/.test(ready.sql), "so is a table");
has(/create unique index if not exists favorites_user_idx/.test(ready.sql), "and an index");
has(/add column if not exists phone/.test(ready.sql), "and a column");
has(/drop policy if exists "users read own favorites" on favorites;\ncreate policy "users read own favorites"/.test(ready.sql), "a policy is replaced rather than duplicated");
has(/notify pgrst, 'reload schema';\n$/.test(ready.sql), "and the API is told to see the new tables at once");
has(!/drop table/.test(ready.sql), "a destructive statement inside a comment is not run");
has(JSON.stringify(ready.tables) === '["favorites"]', "and it reports the tables it creates");
has(/^set search_path to "app_1", public;/.test(prepareAuthoredSql(sql, "app_1").sql), "an app in its own schema gets its tables there");

console.log("\nWhat is never run:");
for (const bad of [
  "drop table favorites;",
  "delete from profiles;",
  "truncate profiles;",
  "update profiles set role = 'admin';",
  "alter table profiles drop column role;",
  "alter table profiles rename to people;",
  "grant all on profiles to anon;",
  "create table a (id int); drop table profiles;",
]) {
  has(!prepareAuthoredSql(bad).ok, `refused: ${bad}`);
}

console.log(failed === 0 ? `\nAll ${passed} passed.` : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
