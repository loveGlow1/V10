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

const {
  architectureFromChoice,
  architectureOptions,
  architectureQuestion,
  decideArchitecture,
  describeArchitecture,
  isArchitectureChoice,
  raiseArchitecture,
} = await import(join(out, "lib/builder/architecture.js"));
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
    /* ── The barber ───────────────────────────────────────────────────────
     *
     * A real build, and the reason asksForPage is read here at all. The word
     * "shop" in "barber shop" scored as commerce, so the kind arrived as
     * `ecommerce` — and the kind's defaults then switched on a database,
     * accounts, an admin area and a storage bucket for somebody who had asked,
     * in as many words, for ONE PAGE.
     *
     * The kind is deliberately still `ecommerce` in this case: it is passed in
     * rather than classified, so this tests the layer that has to hold even
     * when the classifier upstream has already got it wrong. A single page
     * cannot have an admin area, whatever kind the brief was filed under. */
    brief: "Build a simple one page site for my barber shop",
    kind: "ecommerce",
    on: [],
    off: ["backend", "database", "authentication", "admin", "storage", "payments"],
    promoted: false,
  },
  {
    /* The same statement in the other spellings people use for it. */
    brief: "a one-pager for my coffee shop",
    kind: "ecommerce",
    on: [],
    off: ["backend", "database", "authentication", "admin", "storage", "payments"],
  },
  {
    brief: "just a page for my flower shop",
    kind: "ecommerce",
    on: [],
    off: ["backend", "database", "authentication", "admin", "storage", "payments"],
  },
  {
    /* And the one thing that still overrules it, for the reason stack.ts
       gives: a one-page site with a members login is a contradiction, and the
       login is the half that cannot be faked. */
    brief: "a single page site for my gym where members log in to see their bookings",
    kind: "webapp",
    on: ["backend", "database", "authentication"],
    off: [],
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
    /* A SHOP, which is what these expectations describe — the catalogue-only
       case is asserted separately below, because its whole point is that it
       does NOT get these tables. */
    commerce: kind === "ecommerce",
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
    /* ── The two settings this migration does not run without ──────────────
     *
     * Both were missing and neither had ever been seen to fail, because the
     * connection string pointed at a host that could not be resolved — every
     * provision died at DNS, so none of them reached the SQL. Zero schemas had
     * ever been created and there were two more reasons waiting behind the one
     * that was visible. Found by running this migration by hand, which is not
     * a way to find things.
     *
     * check_function_bodies: is_admin() is created before `profiles` exists,
     * because the first table's own policies call it. Postgres validates a
     * `language sql` body at creation and refuses:
     *
     *     ERROR: relation "profiles" does not exist
     *
     * Reordering cannot fix it — the function needs the table and the table's
     * policies need the function. Turning off body validation for the
     * transaction is the documented answer to that circle.
     *
     * search_path: the SQL refers to sibling tables unqualified, as
     * `references categories(id)` and `select role from profiles`. Nothing set
     * a path, so they resolved against `public`, where none of these tables
     * live. */
    ["set local check_function_bodies = off;", "is_admin() can be written before profiles exists"],
    [`set local search_path = ${schema}, public;`, "unqualified sibling references resolve"],
  ];

  for (const [needle, what] of required) {
    if (!sql.includes(needle)) fail("emitted SQL", `${what} — missing ${JSON.stringify(needle)}`);
  }

  /* Both settings have to come before the first thing that depends on them,
     which is everything. A `set` after the function is a `set` that did not
     happen in time. */
  const firstStatement = sql.indexOf("create ");
  for (const setting of ["set local check_function_bodies = off;", `set local search_path = ${schema}, public;`]) {
    const at = sql.indexOf(setting);
    if (at === -1 || at > firstStatement) {
      fail("emitted SQL", `${JSON.stringify(setting)} must come before the first create`);
    }
  }

  /* `set local`, not `set`: provisioning runs this inside one transaction on a
     pooled connection, and a plain `set` would outlive it and change how the
     next thing on that connection behaves.
   *
   * Statement-level only, which is what the semicolon is doing in the pattern.
   * is_admin() carries its own `set search_path = …` as part of `create
   * function`, with no semicolon and no relation to transactions — and the
   * first version of this check failed on exactly that, which is the check
   * being wrong rather than the SQL. */
  if (/^set (?!local )[^;\n]*;/m.test(sql)) {
    fail("emitted SQL", "a setting escapes the transaction — use `set local`");
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

/* ── Capabilities are additive ─────────────────────────────────────────────
 *
 * Capability was decided once at build time and could not change, so the only
 * route to one the first build missed was a rebuild — which throws the page
 * away. That is the real reason this system leans toward giving every project
 * everything up front: guessing low was unrecoverable.
 *
 * The rule that makes it safe to relax is that nothing here ever takes a layer
 * AWAY. A later message that does not mention the database is not a request to
 * delete somebody's tables.
 */
console.log("\nRaising a project's capabilities");

const page = {
  type: "landing",
  frontend: true,
  backend: false,
  database: false,
  authentication: false,
  admin: false,
  storage: false,
  payments: false,
};

const withAuth = raiseArchitecture(page, ["authentication"]);
if (withAuth.manifest.authentication && withAuth.manifest.backend && withAuth.manifest.database) {
  pass("adding accounts brings the backend and database with them");
} else {
  fail("adding accounts brings the backend and database with them", JSON.stringify(withAuth.manifest));
}

if (withAuth.added.join() === "backend,database,authentication") {
  pass("and says which layers were added, in build order");
} else {
  fail("and says which layers were added, in build order", withAuth.added.join());
}

const full = {
  ...page,
  type: "ecommerce",
  backend: true,
  database: true,
  authentication: true,
  admin: true,
  storage: true,
};
const narrowed = raiseArchitecture(full, ["frontend"]);
const lost = Object.keys(full).filter((k) => full[k] === true && narrowed.manifest[k] !== true);

if (lost.length === 0) {
  pass("an edit that mentions nothing removes nothing");
} else {
  fail("an edit that mentions nothing removes nothing", `lost: ${lost.join(", ")}`);
}

if (narrowed.added.length === 0) {
  pass("and reports no change rather than a no-op upgrade");
} else {
  fail("and reports no change rather than a no-op upgrade", narrowed.added.join());
}

const admin = raiseArchitecture(page, ["admin"]);
if (admin.manifest.authentication) {
  pass("an admin cannot be added without a way to sign into it");
} else {
  fail("an admin cannot be added without a way to sign into it");
}

const pay = raiseArchitecture(page, ["payments"]);
if (pay.manifest.database) {
  pass("payments cannot be added without somewhere to record the sale");
} else {
  fail("payments cannot be added without somewhere to record the sale");
}

/* ── The question, and the three answers to it ───────────────────────────
 *
 * None of this had a check, which is how it came to have no caller at all:
 * decideArchitecture returned `certain`, architectureQuestion had the words
 * and architectureOptions had the chips, and for months nothing read any of
 * them — so a guess was spent on rather than asked about, and "build me a
 * shop" arrived with a users table nobody wanted.
 *
 * The chips and the parser have to agree or an answer is silently discarded
 * and the question asked again forever, which is the same failure wearing a
 * different hat. So they are checked against each other rather than each
 * against a list written here. */
/* ── A CATALOGUE IS NOT A SHOP ────────────────────────────────────────────
 *
 * "A product showcase for our furniture, no cart or checkout" is about
 * products, so it is filed as ecommerce — correctly — and the kind's defaults
 * then gave it a basket, orders, customer accounts, an admin area and a
 * storage bucket, for somebody who had declined the basket in the same
 * sentence. The `orders` table in particular was migrated into their database
 * where nothing would ever write to it.
 *
 * The layers are checked as well as the tables, because the tables follow from
 * them and asserting only the tables would pass on a manifest that was wrong
 * in a way dataModelFor happened to ignore. */
console.log("\nA catalogue is not a shop:");

const showcase = decideArchitecture(
  "a product showcase for our furniture, no cart or checkout",
  "ecommerce",
  decideStack("a product showcase for our furniture, no cart or checkout"),
);

for (const [layer, wanted] of [
  ["database", true],
  ["commerce", false],
  ["authentication", false],
  ["admin", false],
]) {
  if (showcase.manifest[layer] === wanted) pass(`a showcase has ${wanted ? "" : "no "}${layer}`);
  else fail(`a showcase has ${wanted ? "" : "no "}${layer}`, describeArchitecture(showcase.manifest));
}

const showcaseTables = dataModelFor(showcase.manifest, schemaNameFor("11111111-2222-3333-4444-555555555555"))
  .tables.map((table) => table.name);

if (showcaseTables.includes("products")) pass("and still gets its products — a catalogue is data");
else fail("and still gets its products — a catalogue is data", showcaseTables.join(", "));

const sellingOnly = ["orders", "order_items", "discounts"].filter((name) => showcaseTables.includes(name));
if (sellingOnly.length === 0) pass("and none of the tables that exist only because money changes hands");
else fail("and none of the tables that exist only because money changes hands", sellingOnly.join(", "));

/* And the shop still is one. Removing commerce from a real store would be a
   different bug, and a louder one. */
const store = decideArchitecture(
  "build me an online store for handmade candles",
  "ecommerce",
  decideStack("build me an online store for handmade candles"),
);
if (store.manifest.commerce && store.manifest.authentication) pass("a real store still sells");
else fail("a real store still sells", describeArchitecture(store.manifest));

console.log("\nThe architecture question:");

const chips = architectureOptions("ecommerce");

if (chips.length === 3) {
  pass("three answers are offered");
} else {
  fail("three answers are offered", `${chips.length} — never force somebody onto our infrastructure to get an app`);
}

if (chips.every((chip) => isArchitectureChoice(chip.value))) {
  pass("and every chip offered is one the parser accepts");
} else {
  fail(
    "and every chip offered is one the parser accepts",
    chips.filter((chip) => !isArchitectureChoice(chip.value)).map((chip) => chip.value).join(", "),
  );
}

if (chips.some((chip) => chip.value === "own")) {
  pass("one of them is the customer's own backend");
} else {
  fail("one of them is the customer's own backend", "the spec's rule is that this is never forced");
}

if (!isArchitectureChoice("anything-else") && !isArchitectureChoice(null)) {
  pass("and nothing else is accepted as an answer");
} else {
  fail("and nothing else is accepted as an answer");
}

const decidedStore = decideArchitecture("an online store with accounts and an admin", "ecommerce", decideStack("an online store with accounts and an admin"));

/* FRONTEND is a real answer, not a smaller version of the other two. */
const asFrontend = architectureFromChoice("frontend", "ecommerce", decidedStore);
if (!asFrontend.manifest.database && !asFrontend.manifest.authentication && !asFrontend.needsProject) {
  pass("choosing the front of it turns every layer off");
} else {
  fail("choosing the front of it turns every layer off", describeArchitecture(asFrontend.manifest));
}

/* THE ONE. "My own backend" is the SAME application — the layers are what the
   app is made of, and building fewer of them because of where the database
   lives would be a different product. */
const asOwn = architectureFromChoice("own", "ecommerce", decidedStore);
if (asOwn.manifest.database && asOwn.manifest.authentication) {
  pass("choosing your own backend keeps every layer the app needs");
} else {
  fail(
    "choosing your own backend keeps every layer the app needs",
    "it changes where the data lives, not what the app is",
  );
}

if (asOwn.certain && asFrontend.certain) {
  pass("and an answered question is not asked again");
} else {
  fail("and an answered question is not asked again");
}

const asked = architectureQuestion("ecommerce", decidedStore.manifest);
if (chips.every((chip) => asked.toLowerCase().includes(chip.label.toLowerCase()))) {
  pass("the question names every option it offers");
} else {
  fail("the question names every option it offers", asked);
}

console.log("All good.\n");
