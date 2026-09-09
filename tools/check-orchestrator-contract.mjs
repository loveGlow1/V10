#!/usr/bin/env node
/* The app, the orchestrator and the database agree about a project row.
 *
 *   npm run check:contract
 *
 * Three systems write to `public.projects` during one build: /api/build before
 * dispatch, the n8n workflow's Sync Project Row and Flag Build Failure, and the
 * save route when a page lands. None of them can see the others, and nothing
 * fails when they disagree — the row simply ends up saying something untrue.
 *
 * That is not hypothetical. The save route wrote `intent: "webapp"` on every
 * successful build, overwriting the kind the other two had written correctly.
 * On the live instance all seventeen Built rows said "webapp" while the Failed
 * ones — which never reach the save route — kept blog, ecommerce and landing.
 * Every finished landing page in the product was labelled a web app, and no
 * error was ever raised.
 *
 * So this reads the workflow source and the routes and checks they still name
 * the same columns and the same values. It is a source check, not a live one:
 * it must pass in CI, where there is no n8n and no database.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");

const workflow = read("n8n/build-orchestrator.workflow.ts");
const save = read("src/app/api/builder/webapp/save/route.ts");
const build = read("src/app/api/build/route.ts");
const schema = read("supabase/schema.sql");
const contract = read("src/lib/n8n.ts");

/* Every column any of the three writes to `projects`. A column that does not
   exist is a silent no-op through PostgREST, not an error.
   
   Searched across the whole file rather than inside the `create table` block:
   half of these arrive by `alter table ... add column if not exists` further
   down, which is how a schema that has to be re-runnable against an existing
   database grows. Scoping to the create statement missed three columns that
   have been live for weeks — the check was wrong, not the schema. */
console.log("Every column written to `projects` exists in the schema:");
for (const column of ["status", "intent", "preview_url", "last_build_at", "prompt", "user_id"]) {
  const declared =
    new RegExp(`add column if not exists ${column}\\b`).test(schema) ||
    new RegExp(`^\\s*${column}\\s+(text|uuid|timestamptz|boolean)`, "m").test(schema);
  has(declared, `projects.${column}`, "written by the app or the workflow but not declared in schema.sql");
}

console.log("\nThe kind survives a successful build:");
has(
  !/intent: "webapp"/.test(save),
  "the save route does not hardcode the kind",
  'it wrote intent: "webapp" over whatever the app and the workflow had decided',
);
has(
  /isBuildKind\(sentArchitectureType\)/.test(save),
  "it reads the kind from the architecture manifest instead",
  "the manifest carries the kind the prompt was actually composed from",
);
has(
  /\.\.\.\(builtKind \? \{ intent: builtKind \} : \{\}\)/.test(save),
  "and leaves the column alone when the manifest carries none",
  "a value already written correctly twice does not need a third guess over it",
);
has(
  /intent: kind\.kind/.test(build),
  "/api/build writes the kind before dispatch",
  "this is the first of the three writes and the one the prompt was composed from",
);

console.log("\nStatus values match on both sides:");
/* The workflow writes these strings and the app's union has to admit them, or
   readResult quietly coerces an unknown status to "Building" — a failed build
   that shows as still running. */
for (const status of ["Building", "Built", "Failed", "Needs Clarification"]) {
  has(
    contract.includes(`"${status}"`),
    `BuildStatus admits "${status}"`,
    "the workflow or a route writes it; n8n.ts must list it",
  );
}
has(
  /branchStatus === "needs_clarification"/.test(workflow) || workflow.includes("needs_clarification"),
  'the workflow still uses "needs_clarification" as its branch marker',
  "Assemble Build Result maps it to the Needs Clarification status",
);

console.log("\nThe generation fields the workflow reads are the ones the app sends:");
for (const field of ["provider", "generationUrl", "generationHeaders", "generationBody", "responseShape"]) {
  has(contract.includes(field), `n8n.ts sends ${field}`, "the workflow reads it off Normalize Build Request");
  has(workflow.includes(field), `the workflow reads ${field}`, "the app sends it and nothing consumes it");
}

console.log("\nAnd the fields Save Page sends are the ones the save route accepts:");
for (const field of ["files", "stack", "backend", "architecture", "designSystem"]) {
  has(save.includes(field), `the save route accepts ${field}`, "Save Page sends it; an unread field is a silent drop");
}

console.log(failed ? `\n${failed} failed.` : "\nAll passed.");
process.exit(failed ? 1 : 0);
