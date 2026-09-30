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
      join(root, "src/lib/builder/backend/form-notify.ts"),
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
const notify = await import(join(out, "lib/builder/backend/form-notify.js"));

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

console.log("\nThe owner's email:");
const PROJECT = "123e4567-e89b-12d3-a456-426614174000";
const secret = notify.newSecret();
const trigger = notify.notifySql({ schema: "public", table: "submissions", projectId: PROJECT, secret });
has(/security definer/.test(trigger) && /set search_path/.test(trigger), "the trigger function is definer with a pinned search_path");
has(/exception when others then[\s\S]*return new;/.test(trigger), "and an error in it can never cost the message");
has(/after insert on public\.submissions/.test(trigger), "it fires only after a row really lands");
has(/revoke all on function .* from public, anon, authenticated;/.test(trigger), "and nobody can call it directly");
has(schema.destructiveStatements(trigger).length === 0 && !/\bdrop\b/i.test(trigger), "and installing it drops nothing");
has(trigger.includes("https://") && trigger.includes("/api/forms/notify"), "it knocks on QuickStark's notify endpoint");
let refused = false;
try { notify.notifySql({ schema: "public; drop table x", table: "submissions", projectId: PROJECT, secret }); } catch { refused = true; }
has(refused, "an unsafe schema name is refused rather than written into SQL");

has(notify.secretMatches(secret, notify.hashSecret(secret)), "the right secret is accepted");
has(!notify.secretMatches(notify.newSecret(), notify.hashSecret(secret)), "any other is not");
has(!notify.secretMatches(secret, null), "and nothing matches a project with no secret");

const mail = notify.composeNotification({
  projectName: "Reyes Tailoring",
  record: { form: "contact", name: "Marcus Reyes", email: "marcus@example.com", message: "I'm at 80212 — do you run that far west?", data: { topic: "A garment or an existing order" } },
  dashboardUrl: "https://supabase.com/dashboard/project/abc/editor",
});
has(mail.subject.includes("Marcus Reyes") && mail.subject.includes("A garment or an existing order"), "the subject names who and what", mail.subject);
has(mail.replyTo === "marcus@example.com", "and Reply answers the person who wrote");
has(mail.text.includes("80212") && mail.text.includes("supabase.com/dashboard"), "the body has the message and where it is saved");
const anonymous = notify.composeNotification({ projectName: "x", record: { email: "not an email <script>" }, dashboardUrl: null });
has(anonymous.replyTo === null, "a malformed email is never used as reply-to");

const now = new Date("2026-10-01T12:00:00Z");
let window = { window_start: null, window_count: 0 };
let sent = 0;
let lastFlag = false;
for (let i = 0; i < notify.HOURLY_LIMIT + 10; i += 1) {
  const next = notify.nextWindow(window, now);
  if (next.send) sent += 1;
  if (next.last) lastFlag = true;
  window = next;
}
has(sent === notify.HOURLY_LIMIT, `at most ${notify.HOURLY_LIMIT} emails an hour, however many messages`, `sent ${sent}`);
has(lastFlag, "and the one that fills the hour says emails are paused");
has(notify.nextWindow(window, new Date(now.getTime() + 61 * 60 * 1000)).send, "and they resume when the hour is up");

const notifyRoute = read("src/app/api/forms/notify/route.ts");
has(
  notifyRoute.indexOf("secretMatches") > -1 && notifyRoute.indexOf("secretMatches") < notifyRoute.indexOf("sendEmail("),
  "the endpoint checks the secret before it sends anything",
);
has(!/\.insert\(/.test(notifyRoute), "and stores no message — it stays in their Supabase");

console.log(failed ? `\n${failed} failed, ${passed} passed.` : `\nAll ${passed} passed.`);
process.exit(failed ? 1 : 0);
