#!/usr/bin/env node
/* A single page that asks to keep form input: recognised, given one safe
 * table, and pointed at the owner's own Supabase — or answered with the button
 * that links one. See src/lib/builder/backend/page-data.ts. */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-page-data");
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
      join(root, "src/lib/builder/backend/page-data.ts"),
      join(root, "src/lib/builder/schema.ts"),
      join(root, "src/lib/builder/edit-plan.ts"),
      join(root, "src/lib/builder/backend/inspect.ts"),
    ],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });

/* Same relinking as check-backend-modes.mjs: "@/…" and extensionless relative
   specifiers rewritten to the compiled files they name. */
function relink(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      relink(path);
      continue;
    }
    if (!entry.endsWith(".js")) continue;
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        /((?:from|import)\s*\(?\s*["'])((?:@\/|\.\.?\/)[^"']+?)(["'])/g,
        (whole, before, specifier, after) => {
          let target = specifier;
          if (target.startsWith("@/")) {
            target = relative(dirname(path), join(out, target.slice(2))).replace(/\\/g, "/");
            if (!target.startsWith(".")) target = `./${target}`;
          }
          return `${before}${target.endsWith(".js") ? target : `${target}.js`}${after}`;
        },
      ),
    );
  }
}
relink(join(out, "lib"));

const page = await import(join(out, "lib/builder/backend/page-data.js"));
const schema = await import(join(out, "lib/builder/schema.js"));
const plan = await import(join(out, "lib/builder/edit-plan.js"));
const inspect = await import(join(out, "lib/builder/backend/inspect.js"));

let failed = 0;
let passed = 0;
function has(condition, label, detail) {
  if (condition) {
    passed += 1;
    console.log(`ok    ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

const LANDING = {
  type: "landing", frontend: true, backend: false, database: false,
  authentication: false, admin: false, storage: false, payments: false,
};
const asks = (message) => page.isPageDataAsk(message, plan.planEdit(message, LANDING).touches);

console.log("\nWhat counts as a page keeping form input:");
for (const message of [
  "connect a database to this landing page",
  "connect my supabase",
  "save the waitlist emails",
  "add a waitlist sign up form that stores emails",
  "store contact form messages in the database",
  "make the newsletter box actually save subscribers",
  "collect RSVPs in my database",
]) {
  has(asks(message), `yes: "${message}"`);
}

console.log("\nAnd what does not:");
for (const message of [
  "make the form blue",
  "change the hero headline",
  "add login so members can see their profile",
  "add stripe checkout",
  "let visitors upload files",
  "fix the header without adding any backend",
  "send me an email when someone signs up",
]) {
  has(!asks(message), `no: "${message}"`);
}

console.log("\nThe table it gets:");
const model = page.pageDataModel("public");
const table = model.tables[0];
has(model.tables.length === 1 && table.name === page.PAGE_TABLE, "one table, named submissions");
has(
  table.policies.length === 1 && table.policies[0].for === "insert",
  "whose only policy lets a visitor add a row — nothing lets anybody read one back",
);
has(
  table.columns.every((column) => column.primaryKey || column.default || column.nullable || column.check),
  "every column is bounded or defaulted, so one visitor cannot fill it",
);
const sql = schema.toSql(model);
has(/enable row level security/i.test(sql), "and row-level security is on");
has(schema.destructiveStatements(sql).length === 0, "and the migration contains nothing destructive");

console.log("\nLeast privilege:");
has(
  sql.includes(`grant insert on public.${page.PAGE_TABLE} to anon;`) &&
    sql.includes(`grant insert on public.${page.PAGE_TABLE} to authenticated;`),
  "visitors are granted insert on it and nothing else",
  sql.split("\n").filter((line) => line.startsWith("grant")).join(" | "),
);
has(!/grant [^;]*(select|update|delete)[^;]* on public\.submissions/.test(sql), "not select, update or delete");

const snapshotWith = (privileges) => ({
  schemas: ["public"],
  functions: [],
  buckets: [],
  tables: [
    {
      schema: "public", name: page.PAGE_TABLE, comment: `${schema.OWNED_MARK} x`, rls: true,
      policies: table.policies.map((p) => p.name),
      columns: table.columns.map((c) => ({ name: c.name, type: { uuid: "uuid", text: "text", timestamptz: "timestamp with time zone", jsonb: "jsonb" }[c.type], notNull: !c.nullable, hasDefault: Boolean(c.default) })),
      anonSelect: privileges.anon.includes("select"),
      authenticatedSelect: privileges.authenticated.includes("select"),
      privileges,
    },
  ],
});
const verified = inspect.verifySchema(model, snapshotWith({ anon: ["insert"], authenticated: ["insert"] }));
has(verified.ok, "the check after the build passes an insert-only table", verified.problems?.join("; "));
const missing = inspect.verifySchema(model, snapshotWith({ anon: [], authenticated: ["insert"] }));
has(!missing.ok, "and fails one visitors cannot insert into", missing.problems?.join("; "));

console.log("\nWhat the page editor is told:");
const brief = page.pageDataBrief({ url: "https://abc.supabase.co", anonKey: "sb_publishable_x", schema: "public" });
has(brief.includes("https://abc.supabase.co") && brief.includes("sb_publishable_x"), "the URL and the public key");
has(brief.includes("cdn.jsdelivr.net/npm/@supabase/supabase-js@2"), "where to load the client from");
has(/never chain \.select\(\)/i.test(brief), "never to read back, which would fail by design");
has(!brief.includes("db: { schema"), "no schema option for public");
has(
  page.pageDataBrief({ url: "https://abc.supabase.co", anonKey: "k", schema: "app_x" }).includes('db: { schema: "app_x" }'),
  "and the schema, when the app was given one of its own",
);

console.log("\nThe button:");
const href = page.connectDatabaseHref("123e4567-e89b-12d3-a456-426614174000");
has(page.isConnectDatabaseHref(href), "the link a reply carries is recognised as the button");
has(href.startsWith("https://") || href.startsWith("http://"), "and survives the stored-link filter, which keeps only http(s)");
has(!page.isConnectDatabaseHref("https://example.com/dashboard/project/x?view=manage"), "other links are left as chips");

console.log("\nThe user owns the data:");
const read = (path) => readFileSync(join(root, path), "utf8");
const connection = read("src/lib/builder/backend/connection.ts");
has(
  /if \(!data\) return null;/.test(connection) &&
    connection.indexOf("if (!data) return null;") < connection.indexOf("const shared = sharedCredentials();"),
  "a project with nothing linked gets no database, not a schema on QuickStark's",
);
const backendRoute = read("src/app/api/projects/[id]/backend/route.ts");
const unlink = backendRoute.slice(backendRoute.indexOf("export async function DELETE"));
has(!/\.delete\(\)/.test(unlink), "disconnecting keeps the project's choice rather than deleting it");
has(/mode: "own"/.test(unlink) && /url: null/.test(unlink), "and leaves it as \"your own, not connected\"");
has(!/QuickStark's Supabase/.test(unlink), "and never says the next build moves to QuickStark's Supabase");
const connectRoute = read("src/app/api/projects/[id]/backend/supabase/route.ts");
const connectPost = connectRoute.slice(connectRoute.indexOf("export async function POST"), connectRoute.indexOf("export async function DELETE"));
has(!/provisionChecked|toSql|create table/i.test(connectPost), "connecting creates no tables — that is the next build's job");
has(/db_url: null/.test(connectPost), "and stores no database password");
const api = read("src/lib/builder/backend/supabase-api.ts");
has(/\[\.\.\.existing, \.\.\.added\]/.test(api), "sign-in redirects are added to theirs, never replacing them");
has(
  /usage, limits and billing/i.test(read("src/app/dashboard/components/workspace/ConnectSupabase.tsx")),
  "the connect panel says Supabase usage, limits and billing stay with their account",
);

console.log(failed ? `\n${failed} failed, ${passed} passed.` : `\nAll ${passed} passed.`);
process.exit(failed ? 1 : 0);
