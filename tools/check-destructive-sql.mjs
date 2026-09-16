#!/usr/bin/env node
/* Nothing this platform runs against a customer's database may destroy anything.
 *
 *   npm run check:destructive-sql
 *
 * Every migration QuickStark writes is additive by construction — `create
 * schema if not exists`, `create table if not exists`, `create index if not
 * exists` — and the only `drop` anywhere in it is `drop policy if exists`,
 * which replaces a rule rather than losing a row.
 *
 * That is true today, and it is true BY CONVENTION, which is not the same as
 * being true. The SQL below is applied by a machine, against a database holding
 * somebody's real orders and users, with nobody watching. The cost of being
 * wrong once is not a failed build, it is their data — and no amount of care in
 * the generator buys as much as one check standing in front of the connection.
 *
 * Two halves, and the second matters as much as the first: the guard has to
 * catch what destroys, and it has to let through what this repository actually
 * writes. A guard that refuses the real migration is a platform that cannot
 * create a table, which is how a safety check gets deleted six months later.
 *
 * No keys, no network, no database.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-destructive-sql");
mkdirSync(out, { recursive: true });

execFileSync(
  "npx",
  ["tsc", "src/lib/builder/schema.ts", "src/lib/builder/architecture.ts",
   "--outDir", out, "--rootDir", "src", "--module", "esnext", "--target", "es2022",
   "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

for (const entry of readdirSync(join(out, "lib/builder"))) {
  if (!entry.endsWith(".js")) continue;
  const path = join(out, "lib/builder", entry);
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(
      /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
      (whole, before, specifier, after) =>
        specifier.endsWith(".js") ? whole : `${before}${specifier}.js${after}`,
    ),
  );
}

const { dataModelFor, destructiveStatements, toSql } = await import(join(out, "lib/builder/schema.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

/* ── What must be caught ─────────────────────────────────────────────────── */
const DESTRUCTIVE = [
  ["drop table orders;", "a table dropped"],
  ["DROP TABLE IF EXISTS orders;", "and one dropped politely"],
  ["alter table orders drop column total;", "a column dropped"],
  ["alter table orders\n  drop constraint orders_pkey;", "a constraint dropped over two lines"],
  ["truncate orders;", "a table emptied"],
  ["truncate table orders restart identity;", "and emptied thoroughly"],
  ["delete from orders where 1=1;", "rows deleted"],
  ["update orders set total = 0;", "rows overwritten"],
  ["drop schema app_x cascade;", "a whole schema"],
  ["create table if not exists a (id uuid);\ndrop table b;", "one bad statement among good ones"],
];

for (const [sql, label] of DESTRUCTIVE) {
  const found = destructiveStatements(sql);
  has(found.length > 0, `${label} is refused`, JSON.stringify(found));
}

/* ── And what must NOT be ────────────────────────────────────────────────── */
const SAFE = [
  ["drop policy if exists p on public.orders;", "a policy replaced, which loses no rows"],
  ["drop trigger if exists t on public.orders;", "a trigger replaced"],
  ["create table if not exists orders (id uuid primary key);", "a table created"],
  ["create index if not exists i on orders (id);", "an index created"],
  ["alter table orders add column if not exists note text;", "a column added"],
  ["alter table orders enable row level security;", "row-level security switched on"],
  [
    `create policy "readers may delete their own" on public.orders for delete using (auth.uid() = user_id);`,
    "a policy ABOUT deletion, which is a rule rather than a deletion",
  ],
  [
    `insert into public.notes (body) values ('drop table orders');`,
    "the words inside a string",
  ],
  ["-- drop table orders;\ncreate table if not exists a (id uuid);", "the words inside a comment"],
  ["/* truncate everything */\ncreate table if not exists a (id uuid);", "and inside a block comment"],
  ["", "an empty migration"],
];

for (const [sql, label] of SAFE) {
  const found = destructiveStatements(sql);
  has(found.length === 0, `${label} is allowed`, JSON.stringify(found));
}

/* ── The real migrations, which is the half that keeps the guard alive ───── */
const MANIFESTS = [
  ["a store with everything on", {
    type: "ecommerce", frontend: true, backend: true, database: true,
    authentication: true, admin: true, storage: true, payments: true,
  }],
  ["a blog", {
    type: "blog", frontend: true, backend: true, database: true,
    authentication: true, admin: true, storage: false, payments: false,
  }],
  ["a dashboard", {
    type: "webapp", frontend: true, backend: true, database: true,
    authentication: true, admin: false, storage: false, payments: false,
  }],
];

for (const [label, manifest] of MANIFESTS) {
  const sql = toSql(dataModelFor(manifest, "app_check"));
  has(sql.length > 0, `${label} produces a migration`);
  const found = destructiveStatements(sql);
  has(
    found.length === 0,
    `${label} passes the guard`,
    `${found.length} refused: ${JSON.stringify(found.slice(0, 2))}`,
  );
  /* And it is additive in the way the spec asks for, said explicitly so a
     future rewrite that drops the `if not exists` is caught here. */
  has(
    /create table if not exists/.test(sql),
    `${label} creates tables only when they are not there`,
  );
}

/* The guard is wired in, not merely written. */
const provision = readFileSync(join(root, "src/lib/builder/backend/provision.ts"), "utf8");
has(
  /destructiveStatements\(sql\)/.test(provision),
  "provision reads the migration before it runs it",
);
has(
  /return \{ ok: false, applied: false, reason \};/.test(provision),
  "and refuses rather than warning",
);

console.log(failed === 0 ? "\nAll destructive SQL checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
