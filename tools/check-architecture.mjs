#!/usr/bin/env node
/* Checks the architecture manifest, the schema it produces, and the SQL that
 * schema emits.
 *
 *   npm run check:architecture
 *
 * Three things, because three things can quietly break and none of them has a
 * type checker behind it.
 *
 * The first is the decision. decideArchitecture is regexes and defaults, and a
 * regex widened to catch one brief catches three others — the expensive version
 * of that here is a landing page for a dentist arriving with a users table and
 * an admin nobody asked for. Every case below is a brief and the layers it must
 * and must not produce.
 *
 * The second is the schema. Every table this generates carries the policies
 * that are the only thing standing between its rows and the public internet, so
 * the invariants are asserted directly: RLS on everything, a policy on
 * everything, no table left readable by accident.
 *
 * The third is the SQL itself. It is emitted as text and never compiled by
 * anything on the way to Postgres, so the structural properties — every table
 * created, every policy dropped before it is created, the admin helper defined
 * before the policies that call it — are checked here or nowhere.
 *
 * Offline and free. No network, no database, no key.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-architecture");
mkdirSync(out, { recursive: true });

/* A tsconfig of its own, for the same reason check-blueprint.mjs writes one:
   these modules import each other by "@/…" and tsc will not take `paths` on the
   command line. */
const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".",
      rootDir: join(process.cwd(), "src"),
      module: "esnext",
      target: "es2022",
      moduleResolution: "bundler",
      skipLibCheck: true,
      strict: true,
      paths: { "@/*": [join(process.cwd(), "src", "*")] },
    },
    files: [
      join(process.cwd(), "src/lib/builder/architecture.ts"),
      join(process.cwd(), "src/lib/builder/schema.ts"),
      join(process.cwd(), "src/lib/builder/stack.ts"),
      join(process.cwd(), "src/lib/builder/project-summary.ts"),
    ],
  }),
);

execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });

/* tsc emits import specifiers exactly as they were written — "./architecture",
   with no extension — and node's ESM loader will not resolve those. Most of
   these modules import each other only for types, which are erased; the summary
   imports LAYER_LABEL and KIND_LABEL for real, so the extension has to be put
   back before anything is loaded. check-tree.mjs does the same, one file over. */
for (const dir of [join(out, "lib/builder"), join(out, "lib")]) {
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".js")) continue;
    const path = join(dir, entry);
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
        (whole, before, specifier, after) =>
          specifier.endsWith(".js") ? whole : `${before}${specifier}.js${after}`,
      ),
    );
  }
}

const { decideArchitecture, describeArchitecture } = await import(
  join(out, "lib/builder/architecture.js")
);
const { dataModelFor, schemaNameFor, toSql, toTypes } = await import(
  join(out, "lib/builder/schema.js")
);
const { decideStack } = await import(join(out, "lib/builder/stack.js"));

let failures = 0;

function fail(what, detail) {
  failures += 1;
  console.error(`  ✗ ${what}\n    ${detail}`);
}

function pass(what) {
  console.log(`  ✓ ${what}`);
}

/* ── The decision ─────────────────────────────────────────────────────────
 *
 * `on` is what the brief must produce and `off` is what it must not. Both are
 * listed for every case, because the failure that matters is asymmetric: a
 * missing layer is a project somebody rebuilds, and a layer nobody asked for is
 * a schema somebody has to go and delete.
 */
const CASES = [
  {
    brief: "a landing page for my dental practice in Leeds",
    kind: "landing",
    on: [],
    off: ["backend", "database", "authentication", "admin", "storage", "payments"],
  },
  {
    brief: "one-page site for a wedding photographer, just the design",
    kind: "landing",
    on: [],
    off: ["backend", "database", "authentication", "admin", "storage", "payments"],
  },
  {
    /* The case the whole promotion mechanism exists for: nothing here says
       database, login or route, and a store without them is a picture. */
    brief: "build me an online store for handmade candles",
    kind: "ecommerce",
    on: ["backend", "database", "authentication", "admin", "storage"],
    off: ["payments"],
    promoted: true,
  },
  {
    brief: "a shopify-style store with stripe checkout and an admin to manage inventory",
    kind: "ecommerce",
    on: ["backend", "database", "authentication", "admin", "storage", "payments"],
    off: [],
  },
  {
    /* And the case that must survive it: somebody saying the back half is not
       wanted outranks every default. */
    brief: "just the storefront design for a sneaker shop, no backend",
    kind: "ecommerce",
    on: [],
    off: ["backend", "database", "authentication", "admin", "storage", "payments"],
  },
  {
    brief: "a wordpress-style blog where I can write and publish posts",
    kind: "blog",
    on: ["backend", "database", "authentication", "admin", "storage"],
    off: ["payments"],
  },
  {
    brief: "a static blog about woodworking, frontend only",
    kind: "blog",
    on: [],
    off: ["backend", "database", "admin"],
  },
  {
    /* webapp starts empty and takes only what the brief argues for. A converter
       is the case that must not grow a users table. */
    brief: "a unit converter for cooking measurements",
    kind: "webapp",
    on: [],
    off: ["database", "authentication", "admin", "storage", "payments"],
  },
  {
    brief: "a CRM where sales reps log in and manage their own leads",
    kind: "webapp",
    on: ["backend", "database", "authentication"],
    off: ["payments"],
  },

  /* ── An account, in the words people actually use ──────────────────────
   *
   * Every case below was decided WRONG before the AUTH patterns were widened,
   * and each was wrong in a way nothing could see: no error, no question, a
   * confident manifest, and a build spent on it.
   *
   * The asymmetry that caused it is worth keeping in mind when touching these:
   * kinds.ts scores a bare "accounts" as evidence of software and routes the
   * brief to the webapp blueprint, while stack.ts wanted the word next to
   * "user" or after a verb. So the same word decided what to build and failed
   * to turn on the thing it needed. */
  {
    /* Authentication arrived FALSE here, so a shop with customer accounts got
       a database and no way for a customer to be anybody. */
    brief:
      "an online bakery where customers create accounts, save addresses, order cakes and track their orders",
    kind: "webapp",
    on: ["backend", "database", "authentication"],
    off: ["admin", "payments"],
  },
  {
    /* Accounts named first in a feature list, which is where they usually are.
       This produced a Next.js project with no layers at all. */
    brief: "team project management application with accounts, projects, tasks and permissions",
    kind: "webapp",
    on: ["backend", "database", "authentication"],
    off: ["payments", "storage"],
  },
  {
    brief: "a members portal where each client can view their own documents",
    kind: "webapp",
    on: ["backend", "database", "authentication"],
    off: ["payments"],
  },

  /* ── And what is NOT an account ────────────────────────────────────────
   *
   * The other direction, which is the expensive one: widening a pattern to
   * catch the cases above must not turn a booking form into a users table.
   * "Sign up" is the word people use for both. */
  {
    brief: "a yoga studio site where people can sign up for a class",
    kind: "landing",
    on: [],
    off: ["backend", "database", "authentication", "admin", "storage", "payments"],
  },
  {
    brief: "a landing page for my studio with a form to sign up for the newsletter",
    kind: "landing",
    on: [],
    off: ["backend", "database", "authentication", "admin", "storage", "payments"],
  },
  {
    brief: "a conference page where you can register for the event",
    kind: "landing",
    on: [],
    off: ["backend", "database", "authentication", "admin", "storage", "payments"],
  },
];

console.log("\nThe decision");

for (const testCase of CASES) {
  const needs = decideStack(testCase.brief, testCase.kind);
  const result = decideArchitecture(testCase.brief, testCase.kind, needs);
  const manifest = result.manifest;

  const wrongOn = testCase.on.filter((layer) => manifest[layer] !== true);
  const wrongOff = testCase.off.filter((layer) => manifest[layer] === true);

  if (wrongOn.length > 0 || wrongOff.length > 0) {
    fail(
      testCase.brief,
      [
        wrongOn.length > 0 ? `missing: ${wrongOn.join(", ")}` : "",
        wrongOff.length > 0 ? `should not have: ${wrongOff.join(", ")}` : "",
        `got ${describeArchitecture(manifest)}`,
      ]
        .filter(Boolean)
        .join(" — "),
    );
    continue;
  }

  if (testCase.promoted && !result.promoted) {
    fail(testCase.brief, "should have raised the stack to a project and did not");
    continue;
  }

  /* A layer that is on with nothing saying why is a layer nobody can argue
     with, which is the failure this field exists to prevent. */
  if (result.needsProject && result.why.length === 0) {
    fail(testCase.brief, "layers are on and nothing says why");
    continue;
  }

  pass(`${testCase.brief} → ${describeArchitecture(manifest)}`);
}

/* ── The schema ───────────────────────────────────────────────────────────*/

console.log("\nThe schema");

const KINDS = [
  { kind: "ecommerce", expect: ["profiles", "products", "orders", "order_items", "discounts"] },
  { kind: "blog", expect: ["profiles", "posts", "pages", "tags", "post_tags"] },
  { kind: "news", expect: ["profiles", "posts", "categories"] },
];

for (const { kind, expect } of KINDS) {
  const manifest = {
    type: kind,
    frontend: true,
    backend: true,
    database: true,
    authentication: true,
    admin: true,
    storage: true,
    payments: kind === "ecommerce",
  };

  const model = dataModelFor(manifest, schemaNameFor("11111111-2222-3333-4444-555555555555"));
  const names = new Set(model.tables.map((table) => table.name));
  const missing = expect.filter((name) => !names.has(name));

  if (missing.length > 0) {
    fail(`${kind} schema`, `missing tables: ${missing.join(", ")}`);
    continue;
  }

  /* Every table, without exception. A table here with no policy is a table that
     returns nothing to everybody, and the person debugging that learns to turn
     RLS off — which is the actual disaster this guards. */
  const naked = model.tables.filter((table) => table.policies.length === 0);
  if (naked.length > 0) {
    fail(`${kind} schema`, `tables with no policy: ${naked.map((t) => t.name).join(", ")}`);
    continue;
  }

  /* A policy nobody can explain is a policy nobody can review. */
  const unexplained = model.tables.flatMap((table) =>
    table.policies.filter((policy) => !policy.why || policy.why.length < 20).map((policy) => policy.name),
  );
  if (unexplained.length > 0) {
    fail(`${kind} schema`, `policies with no reason given: ${unexplained.join(", ")}`);
    continue;
  }

  /* Anything a visitor can read has to say so deliberately. A write policy open
     to `anon` would mean an unauthenticated stranger changing rows. */
  const anonWrites = model.tables.flatMap((table) =>
    table.policies
      .filter((policy) => policy.for !== "select" && policy.to.includes("anon"))
      .map((policy) => `${table.name}.${policy.name}`),
  );
  if (anonWrites.length > 0) {
    fail(`${kind} schema`, `signed-out visitors can write: ${anonWrites.join(", ")}`);
    continue;
  }

  pass(`${kind} — ${model.tables.length} tables, every one with RLS and a policy`);
}

/* A landing page has no database at all, and the empty model is the shape every
   caller reads rather than a null they have to branch on. */
{
  const model = dataModelFor(
    {
      type: "landing",
      frontend: true,
      backend: false,
      database: false,
      authentication: false,
      admin: false,
      storage: false,
      payments: false,
    },
    "app_x",
  );

  if (model.tables.length !== 0 || toSql(model) !== "") {
    fail("landing", "a project with no database produced tables");
  } else {
    pass("landing — no database, no tables, no SQL");
  }
}

/* ── The SQL ──────────────────────────────────────────────────────────────*/

console.log("\nThe SQL");

{
  const manifest = {
    type: "ecommerce",
    frontend: true,
    backend: true,
    database: true,
    authentication: true,
    admin: true,
    storage: true,
    payments: true,
  };

  const schema = schemaNameFor("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  const model = dataModelFor(manifest, schema);
  const sql = toSql(model);

  const required = [
    [`create schema if not exists ${schema};`, "the schema is created"],
    [`create or replace function ${schema}.is_admin()`, "the admin helper is defined"],
    ["security definer", "the admin helper bypasses RLS, or its own policy recurses"],
    [`set search_path = ${schema}, public`, "the helper's search_path is pinned"],
  ];

  for (const [needle, what] of required) {
    if (!sql.includes(needle)) fail("emitted SQL", `${what} — missing ${JSON.stringify(needle)}`);
  }

  for (const table of model.tables) {
    const qualified = `${schema}.${table.name}`;
    if (!sql.includes(`create table if not exists ${qualified} (`)) {
      fail("emitted SQL", `${table.name} is not created`);
    }
    if (!sql.includes(`alter table ${qualified} enable row level security;`)) {
      fail("emitted SQL", `${table.name} does not have row-level security enabled`);
    }
    for (const policy of table.policies) {
      /* Dropped before created, or a second run of the migration fails on a
         policy that already exists — and this migration runs on every build. */
      if (!sql.includes(`drop policy if exists ${policy.name} on ${qualified};`)) {
        fail("emitted SQL", `${policy.name} is not dropped before it is created`);
      }
      const dropAt = sql.indexOf(`drop policy if exists ${policy.name} on ${qualified};`);
      const createAt = sql.indexOf(`create policy ${policy.name} on ${qualified}`);
      if (createAt !== -1 && dropAt !== -1 && dropAt > createAt) {
        fail("emitted SQL", `${policy.name} is created before it is dropped`);
      }
    }
  }

  /* is_admin() is called by policies; a definition that appears after them is a
     migration that fails on the first one. */
  const helperAt = sql.indexOf(`create or replace function ${schema}.is_admin()`);
  const firstCall = sql.indexOf(`${schema}.is_admin()`, helperAt + 1);
  if (helperAt !== -1 && firstCall !== -1 && helperAt > firstCall) {
    fail("emitted SQL", "is_admin() is defined after the first policy that calls it");
  }

  /* Every call has to be schema-qualified. An unqualified one resolves through
     the caller's search_path, which is not ours to control — and a policy that
     cannot resolve its function does not degrade, it errors, and every query
     against that table fails with a message about a missing function. */
  const policyLines = sql
    .split("\n")
    .filter((line) => line.trimStart().startsWith("using (") || line.trimStart().startsWith("with check ("));
  const unqualified = policyLines.filter((line) => /(?<!\.)\bis_admin\(\)/.test(line));
  if (unqualified.length > 0) {
    fail("emitted SQL", `${unqualified.length} policy clauses call is_admin() unqualified`);
  }

  /* The helper's own body is the one place it may be unqualified: its
     search_path is pinned, and qualifying a definer function's self-reference
     buys nothing. */
  if (!sql.includes("select 1 from profiles")) {
    fail("emitted SQL", "the admin helper does not read profiles");
  }

  /* Buckets are global per Supabase project, not per schema. Two generated
     stores both asking for `product-images` would share one bucket — one shop's
     photographs in the other's storage. The prefix is what stops that, so it is
     asserted rather than assumed. */
  for (const bucket of model.buckets) {
    if (!bucket.name.startsWith(`${schema}-`)) {
      fail("emitted SQL", `bucket ${bucket.name} is not scoped to this project and will collide`);
    }
  }

  if (failures === 0) pass(`${model.tables.length} tables, ${model.buckets.length} scoped bucket, ${sql.split("\n").length} lines of SQL`);
}

/* ── The types ────────────────────────────────────────────────────────────*/

console.log("\nThe types");

{
  const model = dataModelFor(
    {
      type: "blog",
      frontend: true,
      backend: true,
      database: true,
      authentication: true,
      admin: true,
      storage: true,
      payments: false,
    },
    "app_types",
  );

  const types = toTypes(model);

  for (const table of model.tables) {
    if (!types.includes(`      ${table.name}: {`)) {
      fail("emitted types", `${table.name} has no type`);
    }
  }

  /* A column with a default is optional on insert and required on the row. Both
     halves matter: without the first, every insert has to spell out created_at;
     without the second, a row is typed as though a NOT NULL column might be
     missing. */
  if (!types.includes("Row: {") || !types.includes("Insert: {") || !types.includes("Update: {")) {
    fail("emitted types", "a table is missing one of Row, Insert or Update");
  }

  if (!types.includes("export type Posts =")) {
    fail("emitted types", "no row alias was emitted");
  }

  if (failures === 0) pass(`${model.tables.length} tables typed`);
}

/* ── The preview ──────────────────────────────────────────────────────────
 *
 * A project of .tsx files has no HTML in it — the HTML is what `next build`
 * produces, and nothing in this system runs `next build`. So the preview is a
 * summary of what was made, and the two things it must never do are lie about
 * the app and lie about the database.
 */

console.log("\nThe preview");

{
  const { projectSummary, routesOf } = await import(join(out, "lib/builder/project-summary.js"));

  const manifest = {
    type: "ecommerce",
    frontend: true,
    backend: true,
    database: true,
    authentication: true,
    admin: true,
    storage: true,
    payments: false,
  };
  const model = dataModelFor(manifest, schemaNameFor("dddddddd-eeee-ffff-0000-111111111111"));
  const tree = [
    "package.json",
    "app/layout.tsx",
    "app/page.tsx",
    "app/products/page.tsx",
    "app/products/[slug]/page.tsx",
    "app/(marketing)/about/page.tsx",
    "app/admin/products/page.tsx",
    "components/Nav.tsx",
    "lib/supabase.ts",
  ].map((path) => ({ path, content: "x\n".repeat(10) }));

  const routes = routesOf(tree);
  /* Route groups are organisational and never appear in a URL. A summary that
     printed /(marketing)/about would be naming an address that 404s. */
  if (routes.some((route) => route.includes("("))) {
    fail("routes", `a route group leaked into a URL: ${routes.join(" ")}`);
  }
  if (!routes.includes("/about")) fail("routes", "a grouped route lost its path");
  if (!routes.includes("/")) fail("routes", "the home page is not listed");

  const ready = projectSummary({
    projectName: "Ember & Wick",
    manifest,
    tree,
    model,
    databaseReady: true,
  });
  const pending = projectSummary({
    projectName: "Ember & Wick",
    manifest,
    tree,
    model,
    databaseReady: false,
  });

  /* The document has to survive readGeneratedDocument, which is what stores it.
     A summary that fails validation is a build that reports itself as broken. */
  if (!/^<!doctype html/i.test(ready) || !/<\/html\s*>\s*$/.test(ready.trim())) {
    fail("summary", "is not a complete HTML document, so the save route will refuse it");
  }

  /* The one distinction the summary exists to keep straight. */
  if (!ready.includes("created") || ready.includes("not created yet")) {
    fail("summary", "a created database is not reported as created");
  }
  if (!pending.includes("not created yet")) {
    fail("summary", "a database that was never created is reported as though it were");
  }

  /* A project name is somebody's typing and goes into a document served to a
     browser. */
  const injected = projectSummary({
    projectName: '<script>alert(1)</script>',
    manifest,
    tree,
    model,
    databaseReady: true,
  });
  if (injected.includes("<script>alert")) {
    fail("summary", "a project name is interpolated without escaping");
  }

  if (!ready.includes("app/admin/products/page.tsx")) {
    fail("summary", "the admin files are not listed");
  }

  if (failures === 0) {
    pass(`${routes.length} routes, ${model.tables.length} tables, escaped, valid HTML`);
  }
}

console.log("");

if (failures > 0) {
  console.error(`${failures} ${failures === 1 ? "failure" : "failures"}.\n`);
  process.exit(1);
}

console.log("All good.\n");
