#!/usr/bin/env node
/* Connecting somebody's own Supabase: the scan, the plan, the check, and the
 * sign-in's own plumbing.
 *
 *   npm run check:schema-scan
 *
 * Offline. No token, no network, no database: the scan is fed snapshots written
 * here, shaped exactly like the one query in inspect.ts returns.
 *
 * The rule under test above all others: NOTHING OF THEIRS IS TOUCHED. A table
 * of the customer's with the same name as one of the app's moves the app, not
 * their table — and where the app cannot be moved, nothing runs.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-schema-scan");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(root, "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, strict: true,
      paths: { "@/*": [join(root, "src", "*")] },
    },
    files: [
      join(root, "src/lib/builder/schema.ts"),
      join(root, "src/lib/builder/architecture.ts"),
      join(root, "src/lib/builder/stack.ts"),
      join(root, "src/lib/builder/backend/inspect.ts"),
      join(root, "src/lib/builder/backend/supabase-oauth.ts"),
    ],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });

/* Put the .js back on relative specifiers, which node's ESM loader needs. */
function fixExtensions(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { fixExtensions(path); continue; }
    if (!entry.endsWith(".js")) continue;
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (whole, before, specifier, after) =>
        specifier.endsWith(".js") ? whole : `${before}${specifier}.js${after}`,
      ),
    );
  }
}
fixExtensions(join(out, "lib"));

const schemaMod = await import(join(out, "lib/builder/schema.js"));
const inspect = await import(join(out, "lib/builder/backend/inspect.js"));
const { decideArchitecture } = await import(join(out, "lib/builder/architecture.js"));
const { decideStack } = await import(join(out, "lib/builder/stack.js"));

let failed = 0;
let passed = 0;
const ok = (t) => { passed += 1; console.log(`ok    ${t}`); };
const fail = (t, d) => { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const brief = "an online store with customer accounts, an admin and product photos";
const manifest = decideArchitecture(brief, "ecommerce", decideStack(brief)).manifest;
const model = schemaMod.dataModelFor(manifest, "public");

const PG = {
  uuid: "uuid", text: "text", integer: "integer", bigint: "bigint", numeric: "numeric",
  boolean: "boolean", timestamptz: "timestamp with time zone", jsonb: "jsonb",
};

/* A database holding exactly what the migration makes. */
function perfect(m, extra = {}) {
  return {
    schemas: [m.schema, "public"],
    tables: m.tables.map((table) => ({
      schema: m.schema,
      name: table.name,
      comment: `${schemaMod.OWNED_MARK} ${table.what}`,
      rls: true,
      policies: table.policies.map((p) => p.name),
      columns: table.columns.map((c) => ({ name: c.name, type: PG[c.type], notNull: !c.nullable, hasDefault: Boolean(c.default) })),
      anonSelect: true,
      authenticatedSelect: true,
    })),
    functions: [{ schema: m.schema, name: "is_admin", comment: `${schemaMod.OWNED_MARK} whether` }],
    buckets: m.buckets.map((b) => ({ id: b.name, public: b.public })),
    ...extra,
  };
}

const empty = { schemas: ["public"], tables: [], functions: [], buckets: [] };
const theirProducts = {
  schema: "public", name: "products", comment: null, rls: false, policies: [],
  columns: [{ name: "id", type: "bigint", notNull: true, hasDefault: true }, { name: "title", type: "text", notNull: false, hasDefault: false }],
  anonSelect: true, authenticatedSelect: true,
};

console.log("\nThe model under test:");
has(model.tables.some((t) => t.name === "products") && model.tables.some((t) => t.name === "profiles"),
  "a store with accounts has products and profiles", model.tables.map((t) => t.name).join(", "));

console.log("\nThe SQL marks what it makes:");
const sql = schemaMod.toSql(model);
has(sql.includes(`comment on table public.products is '${schemaMod.OWNED_MARK}`), "every table's comment carries the ownership mark");
has(/comment on function public\.is_admin\(\) is 'QuickStark:/.test(sql), "and so does is_admin()");
has(sql.trim().endsWith("notify pgrst, 'reload schema';"), "and the API is told to reload its schema");
const extended = schemaMod.toSql(model, { extend: { products: [{ name: "badge", type: "text", nullable: true }] } });
has(/create table if not exists public\.products[\s\S]*?\);\s*\nalter table public\.products add column if not exists badge text;/.test(extended),
  "a missing column is added right after its table, before any index or policy names it");
has(schemaMod.destructiveStatements(extended).length === 0, "and adding columns is not destructive");
has(schemaMod.destructiveStatements("alter table public.profiles drop constraint if exists profiles_role_check;").length === 1,
  "dropping the role rule on its own is still destructive");
has(schemaMod.destructiveStatements("alter table public.profiles drop constraint if exists profiles_role_check; alter table public.orders drop constraint if exists x;").length === 2,
  "and so is any other constraint drop");

console.log("\nThe scan reads and never writes:");
const scan = inspect.snapshotSql(["public", "qs_x"]).toLowerCase();
has(!/\b(insert|update|delete|create|alter|drop|truncate|grant)\b/.test(scan.replace(/'[^']*'/g, "")), "the snapshot query is read-only");
has(inspect.parseSnapshot([{ snapshot: JSON.stringify(empty) }])?.tables.length === 0, "a JSON string in a row array is read");
has(inspect.parseSnapshot({ snapshot: empty })?.schemas[0] === "public", "and a parsed object");
has(inspect.parseSnapshot([{ nope: 1 }]) === null, "and something unreadable is null, never an empty database");

const opts = { settled: false, isolatedSchema: "qs_shop_abc123", canExpose: true };

console.log("\nAn empty Supabase:");
let plan = inspect.planSchema(model, empty, opts);
has(plan.schema === "public" && !plan.isolated, "the app goes in public");
has(plan.create.length === model.tables.length && plan.blocked.length === 0, "every table is created and nothing is blocked");

console.log("\nA Supabase that already has a products table of its own:");
const busy = { ...empty, tables: [theirProducts] };
plan = inspect.planSchema(model, busy, opts);
has(plan.isolated && plan.schema === "qs_shop_abc123" && plan.exposeSchema, "the app moves to a schema of its own and asks for it to be exposed", JSON.stringify(plan));
has(plan.collisions.some((c) => c.name === "public.products"), "and the collision is named for the owner");
has(plan.blocked.length === 0 && plan.create.includes("products"), "and its own products table is created there");
const moved = schemaMod.withSchema(model, plan.schema);
const movedSql = schemaMod.toSql(moved);
has(!/public\.products\b/.test(movedSql), "the migration then never names their public.products", movedSql.match(/.*public\.products.*/)?.[0]);
has(moved.buckets.every((b) => b.name.startsWith("qs_shop_abc123-")), "and its buckets are renamed with it", moved.buckets.map((b) => b.name).join(", "));

plan = inspect.planSchema(model, busy, { ...opts, canExpose: false });
has(!plan.isolated && plan.blocked.length > 0, "without a sign-in connection it cannot move, so it refuses rather than touch their table");
has(plan.blocked.some((line) => /Connect Supabase/.test(line)), "and says how to fix it");

plan = inspect.planSchema(model, busy, { ...opts, settled: true });
has(plan.schema === "public" && plan.blocked.length > 0, "a project whose tables already exist is never moved — a new collision blocks instead");

console.log("\nTheir own is_admin() or storage bucket:");
plan = inspect.planSchema(model, { ...empty, functions: [{ schema: "public", name: "is_admin", comment: null }] }, opts);
has(plan.isolated && plan.collisions.some((c) => c.kind === "function"), "a function of theirs with the same name moves the app too");
if (model.buckets.length > 0) {
  plan = inspect.planSchema(model, { ...empty, buckets: [{ id: model.buckets[0].name, public: false }] }, opts);
  has(plan.isolated && plan.collisions.some((c) => c.kind === "bucket"), "and so does a storage bucket of theirs");
}

console.log("\nA rebuild against tables this app made:");
const current = perfect(model);
plan = inspect.planSchema(model, current, { ...opts, settled: true });
has(plan.reuse.length === model.tables.length && plan.create.length === 0 && plan.blocked.length === 0, "every table is reused");
const legacy = perfect(model);
legacy.tables = legacy.tables.map((t) => ({ ...t, comment: model.tables.find((m) => m.name === t.name).what }));
plan = inspect.planSchema(model, legacy, { ...opts, settled: true });
has(plan.collisions.length === 0, "tables made before the ownership mark existed are still recognised as ours");
const missing = perfect(model);
missing.tables = missing.tables.map((t) => (t.name === "products" ? { ...t, columns: t.columns.filter((c) => c.name !== "status") } : t));
plan = inspect.planSchema(model, missing, { ...opts, settled: true });
has(plan.extend.products?.some((c) => c.name === "status"), "a column added since is planned as an extension");
const retyped = perfect(model);
retyped.tables = retyped.tables.map((t) =>
  t.name === "products" ? { ...t, columns: t.columns.map((c) => (c.name === "price" ? { ...c, type: "text" } : c)) } : t);
plan = inspect.planSchema(model, retyped, { ...opts, settled: true });
has(plan.blocked.some((line) => /products\.price/.test(line)), "a column of the wrong type blocks — nothing is converted");

console.log("\nThe check after the migration:");
let check = inspect.verifySchema(model, perfect(model));
has(check.ok && check.checked > model.tables.length, `a complete database passes (${check.checked} checks)`, check.problems.join("; "));
const noPolicy = perfect(model);
noPolicy.tables[0] = { ...noPolicy.tables[0], policies: [] };
check = inspect.verifySchema(model, noPolicy);
has(!check.ok && check.problems.some((p) => /policy/.test(p)), "a missing policy is caught");
const noRls = perfect(model);
noRls.tables[0] = { ...noRls.tables[0], rls: false };
has(inspect.verifySchema(model, noRls).problems.some((p) => /row-level security/.test(p)), "row-level security switched off is caught");
has(inspect.verifySchema(model, empty).problems.some((p) => /missing/.test(p)), "and missing tables are caught");
const isolatedModel = schemaMod.withSchema(model, "qs_shop_abc123");
has(inspect.verifySchema(isolatedModel, { ...perfect(isolatedModel), schemas: ["public"] }).problems.some((p) => /schema qs_shop_abc123/.test(p)),
  "a schema of its own that does not exist is caught");

console.log("\nNames:");
const name = inspect.isolatedSchemaFor("Ada's Bakery!", "0f3a9c1e-1111-2222-3333-444455556666");
has(/^qs_[a-z0-9_]+$/.test(name) && name.length <= 63, "an isolated schema name is a valid identifier", name);

console.log("\nThe sign-in's plumbing:");
process.env.SUPABASE_OAUTH_CLIENT_ID = "client-id";
process.env.SUPABASE_OAUTH_CLIENT_SECRET = "secret-one";
const oauth = await import(join(out, "lib/builder/backend/supabase-oauth.js"));
const { verifier, challenge } = oauth.pkcePair();
has(challenge === createHash("sha256").update(verifier).digest("base64url"), "the PKCE challenge is the S256 of the verifier");
const url = new URL(oauth.authorizeUrlFor("https://www.quickstark.tech/api/integrations/supabase/callback", "st", challenge));
has(url.origin === "https://api.supabase.com" && url.pathname === "/v1/oauth/authorize", "sign-in goes to Supabase's authorize endpoint");
has(url.searchParams.get("code_challenge_method") === "S256" && url.searchParams.get("response_type") === "code" && url.searchParams.get("state") === "st",
  "with a code challenge, a code response and the state");
const sealed = oauth.seal("refresh-token-value");
has(sealed && !sealed.includes("refresh-token-value") && oauth.unseal(sealed) === "refresh-token-value", "tokens are sealed at rest and open again");
process.env.SUPABASE_OAUTH_CLIENT_SECRET = "secret-two";
has(oauth.unseal(sealed) === null, "and a rotated secret makes them unreadable rather than wrong");

console.log(failed ? `\n${failed} failed, ${passed} passed.` : `\nAll ${passed} passed.`);
process.exit(failed ? 1 : 0);
