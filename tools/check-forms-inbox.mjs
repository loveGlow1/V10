#!/usr/bin/env node
/* The QuickStark forms inbox.
 *
 *   npm run check:forms-inbox
 *
 * Offline. inbox.ts is pure, so what a submission may hold, how fast one
 * sender may go and how the inbox exports are exercised directly; the routes
 * and the builder wiring are read as source and held to their order.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-forms-inbox");
mkdirSync(out, { recursive: true });
execFileSync(
  "npx",
  ["tsc", "src/lib/forms/inbox.ts", "--outDir", out, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--types", "node"],
  { stdio: ["ignore", "ignore", "inherit"] },
);
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
const F = await import(join(out, "inbox.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => {
  failed += 1;
  console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`);
};
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));
const read = (path) => readFileSync(join(root, path), "utf8");

const P = "3fc189d2-c93e-499f-a855-fee0121dc530";

/* ── What a submission may hold ───────────────────────────────────────── */
{
  const good = F.parseSubmission({ project: P, form: "Contact", name: "Ada", email: "ada@example.com", message: "Hello", data: { topic: "Viewing", budget: 2, agree: true } });
  has(good.ok && good.value.form === "contact" && good.value.data.budget === 2 && good.value.data.agree === true, "a normal contact message is accepted, with its extra fields");
  has(!F.parseSubmission({ project: "nope", message: "hi" }).ok, "a submission without a real project id is refused");
  const spam = F.parseSubmission({ project: P, message: "buy now", [F.HONEYPOT]: "http://spam" });
  has(!spam.ok && spam.spam === true, "a filled honeypot is caught as spam, to be answered like a success and not stored");
  has(!F.parseSubmission({ project: P, email: "not-an-email" }).ok, "a malformed email is refused");
  has(!F.parseSubmission({ project: P }).ok, "an empty form is refused");
  has(!F.parseSubmission({ project: P, message: "x" }, 25_000).ok, "a body over 20KB is refused before it is read");
  const long = F.parseSubmission({ project: P, message: "a".repeat(9000), name: "b".repeat(500) });
  has(long.ok && long.value.message.length === 5000 && long.value.name.length === 120, "long fields are clipped to their limits");
  const many = F.parseSubmission({ project: P, data: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, "v"])) });
  has(many.ok && Object.keys(many.value.data).length === 30, "at most 30 extra fields are kept");
  const nested = F.parseSubmission({ project: P, data: { deep: { a: 1 }, list: [1, 2], text: "ok" } });
  has(nested.ok && !("deep" in nested.value.data) && !("list" in nested.value.data) && nested.value.data.text === "ok", "nested objects and lists in extra fields are dropped");
  has(F.parseSubmission({ project: P, message: "hi" }).value?.form === "contact", "a form with no name is a contact form");
}

/* ── How fast ─────────────────────────────────────────────────────────── */
has(F.withinLimits({ sender: 4, project: 0 }) && !F.withinLimits({ sender: 5, project: 0 }), "five messages per sender per ten minutes, then refused");
has(!F.withinLimits({ sender: 0, project: 300 }), "and 300 per project per hour");
const token = F.senderToken("203.0.113.9", "salt");
has(token.length === 32 && !token.includes("203") && token === F.senderToken("203.0.113.9", "salt") && token !== F.senderToken("203.0.113.9", "other"), "the sender is a salted one-way token, never the address");

/* ── Export ───────────────────────────────────────────────────────────── */
{
  const csv = F.toCsv([
    { created_at: "2026-10-17T10:00:00Z", form: "contact", name: "Ada, Lovelace", email: "ada@example.com", message: 'She said "hi"\nthen left', data: { topic: "Viewing" } },
    { created_at: "2026-10-17T11:00:00Z", form: "waitlist", name: "=HYPERLINK(\"http://evil\")", email: null, message: null, data: { size: 3 } },
  ]);
  const lines = csv.split("\r\n");
  has(lines[0] === "received,form,name,email,message,topic,size", "every extra field any row has becomes a column");
  has(csv.includes('"Ada, Lovelace"') && csv.includes('"She said ""hi""\nthen left"'), "commas, quotes and line breaks are quoted");
  has(csv.includes(`"'=HYPERLINK(""http://evil"")"`), "a cell a spreadsheet would run as a formula is defused with a leading quote");
}

/* ── What the page builder is told ────────────────────────────────────── */
{
  const brief = F.inboxBrief({ projectId: P, siteUrl: "https://www.quickstark.tech/" });
  has(brief.includes("https://www.quickstark.tech/api/forms/submit"), "pages post to the absolute inbox address");
  has(brief.includes(P), "with this project's id");
  has(/text\/plain/.test(brief), "as text/plain, so no cross-site pre-flight is needed");
  has(brief.includes(F.HONEYPOT), "with the honeypot field");
  has(!/supabase|anon key|api key/i.test(brief), "and no key or database client of any kind");
}

/* ── The routes and the wiring ────────────────────────────────────────── */
{
  const submit = read("src/app/api/forms/submit/route.ts");
  const at = (needle) => submit.indexOf(needle);
  has(/"Access-Control-Allow-Origin": "\*"/.test(submit) && /export function OPTIONS/.test(submit), "the submit route answers any origin, including the preview's");
  has(at("parsed.spam") > 0 && at("parsed.spam") < at('from("form_submissions").insert'), "spam is answered before anything is stored");
  has(at("withinLimits(") > 0 && at("withinLimits(") < at('from("form_submissions").insert'), "the limits are checked before the insert");
  has(/deleted_at/.test(submit), "a deleted project takes no messages");
  has(/after\(/.test(submit) && at("after(") > at('from("form_submissions").insert'), "the owner's email goes after the visitor has their answer");

  const inbox = read("src/app/api/projects/[id]/forms/route.ts");
  has((inbox.match(/await context\(id\)/g) ?? []).length === 3, "every inbox method checks ownership first");
  has((inbox.match(/\.eq\("project_id", owned\.projectId\)/g) ?? []).length >= 5, "and every read and write is scoped to that project");

  const pageData = read("src/lib/builder/backend/page-data.ts");
  has(/inboxBrief\(\{ projectId: input\.projectId/.test(pageData) && !/kind: "needs-link",\s*said:/.test(pageData), "a page with no Supabase gets the inbox, not a request to connect one");

  const base = read("src/lib/builder/blueprints/base.ts");
  has(/Send submissions where a FORMS section says/.test(base), "the build rules send forms where the FORMS section says");
  const route = read("src/app/api/build/route.ts");
  has(/forms: formsBriefText \|\| undefined/.test(route), "and the build route gives the inbox to projects with no database of their own");

  /* Email settings work for the inbox too: on by default, as the submit route
     behaves, and changeable without a Supabase to install anything into. */
  const settings = read("src/app/api/projects/[id]/backend/notifications/route.ts");
  has(/inbox: !own/.test(settings) && /enabled: row \? row\.enabled : !own/.test(settings), "inbox projects report emails as on until turned off");
  has(!/Connect your Supabase first/.test(settings), "and turning emails on never asks an inbox project to connect Supabase");
  has(/upsert\(\{ project_id: owned\.projectId[^)]*\}, \{ onConflict: "project_id" \}\)/.test(settings), "settings are upserted, so installing on an own Supabase cannot collide with them");
  has(/body\.action !== "test"/.test(settings) && /nextWindow\(/.test(settings) && settings.indexOf("nextWindow(") < settings.indexOf("sendEmail("), "a test email goes to the saved address and counts toward the hourly cap");
  const notify = read("src/app/dashboard/components/workspace/FormNotifications.tsx");
  has(/Update email/.test(notify) && /Send test email/.test(notify) && /Emails go to/.test(notify), "the settings say where emails go, with Update email and Send test email");
  const panel = read("src/app/dashboard/components/workspace/BackendPanel.tsx");
  has(/<FormInbox projectId=\{projectId\} \/>\s*\{[^}]*\}\s*\{!\(backend\?\.mode === "own" && backend\.url\) && <FormNotifications/.test(panel), "the Database panel shows the inbox's email settings beside it");

  const schema = read("supabase/schema.sql");
  has(/create table if not exists public\.form_submissions/.test(schema) && /revoke all on public\.form_submissions from anon, authenticated/.test(schema), "the table exists, and no browser role can write to it");
}

rmSync(out, { recursive: true, force: true });
console.log(failed ? `\n${failed} check${failed === 1 ? "" : "s"} failed.` : "\nAll forms inbox checks passed.");
process.exit(failed ? 1 : 0);
