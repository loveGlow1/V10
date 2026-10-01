#!/usr/bin/env node
/* Running SQL on a project's own database, from the conversation.
 *
 *   npm run check:database-ask
 *
 * The agent runs SQL on somebody's real database, so what it recognises as a
 * database request, what runs at once, what waits for "Run it", and what is
 * never run are pinned here. A false yes runs SQL nobody asked for.
 *
 * Offline. No model, no network, no database.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-database-ask");
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
    files: [join(process.cwd(), "src/lib/builder/backend/database-ask.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

const { sqlFromMessage, isDatabaseAsk, judgeSql, formatRows, wrapSql } = await import(join(out, "lib/builder/backend/database-ask.js"));

let failed = 0;
let passed = 0;
const has = (cond, t, d) => {
  if (cond) { passed += 1; console.log(`ok    ${t}`); }
  else { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
};

console.log("\nWhat is SQL:");
has(sqlFromMessage("run this:\n```sql\ncreate table x (id int);\n```") === "create table x (id int);", "a fenced block");
has(sqlFromMessage("select * from favorites limit 5;") !== null, "a message that is a statement");
has(sqlFromMessage("create a pricing section") === null, "not 'create a pricing section'");
has(sqlFromMessage("update the hero text") === null, "not 'update the hero text'");

console.log("\nWhat is a database request:");
for (const [message, want] of [
  ["add a phone column to the profiles table", true],
  ["seed the properties table with 10 listings", true],
  ["show me the latest viewing_requests", true],
  ["how many rows are in favorites in my database", true],
  ["run the migration on my supabase", true],
  ["add a row to the pricing table", false],
  ["make the hero darker", false],
  ["add a contact form that saves to the database", false],
  ["update the footer text", false],
  ["change the colour of the dashboard button", false],
  /* The prompt this broke on, sent four times: a feature request that
     mentions the database. It was turned into SQL every time. */
  ["Finish the dashboard against the tables that now exist in my database. On the property pages, make the favourite heart, Schedule Viewing and Contact Agent save for the signed-in user, and record each property opened in recently_viewed. In the dashboard, make Overview, Saved, Scheduled Viewings, Recently Viewed, Profile and Settings read and update the signed-in user's real rows, with empty states for a new account. Replace the placeholder admin page with a real admin area where an editor manages properties, agents, viewing requests (confirm or cancel) and contact inquiries. Keep the current design and every existing page.", false],
  ["create the tables my dashboard uses in my database", false],
  ["build an admin area to manage the properties table", false],
  ["create a favorites table in my database", true],
  ["drop the old_listings table from my database", true],
]) has(isDatabaseAsk(message) === want, `${want ? "yes" : "no"}: ${message.slice(0, 90)}`);

console.log("\nWhat runs at once:");
const safe = judgeSql("create table if not exists a (id int); insert into a values (1); select * from a;");
has(safe.risky.length === 0 && safe.forbidden.length === 0, "creating, inserting and reading");
has(safe.ddl, "and a schema change is noticed, so the API reloads");
has(/notify pgrst, 'reload schema';$/.test(wrapSql(safe.statements, "public", true)), "the API is told to see new tables");
has(/^set search_path to "app_1", public;/.test(wrapSql(["select 1"], "app_1", false)), "an app in its own schema is queried there");

console.log("\nWhat waits for 'Run it':");
for (const sql of [
  "drop table a;", "delete from a where id = 1;", "truncate a;", "update a set id = 2;",
  "alter table a rename to b;", "alter table a drop column x;", "alter table a alter column x type text;",
  "alter table a disable row level security;", "grant all on a to anon;", "revoke select on a from anon;",
  "insert into a values (1) on conflict (id) do update set id = 2;",
  "create or replace function f() returns int language sql as 'select 1';",
]) has(judgeSql(sql).risky.length === 1, sql);

console.log("\nWhat is never run:");
for (const sql of [
  "copy a from program 'rm -rf /';", "select pg_read_file('/etc/passwd');", "alter system set work_mem = '1GB';",
  "select lo_import('/etc/shadow');", "select pg_terminate_backend(123);",
]) has(judgeSql(sql).forbidden.length === 1, sql);

console.log("\nReading it right:");
const quoted = judgeSql("insert into a (t) values ('a; drop table b');");
has(quoted.statements.length === 1 && quoted.risky.length === 0, "a semicolon inside a string is not a second statement");
has(judgeSql("-- drop table a\nselect 1;").risky.length === 0, "a drop inside a comment is not a drop");
has(formatRows([{ id: 1, name: "Villa | Serena" }, { id: 2, name: null }]).includes("| 2 | — |"), "rows come back as a readable table");
has(formatRows([]) === "No rows.", "and an empty result says so");

console.log(failed === 0 ? `\nAll ${passed} passed.` : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
