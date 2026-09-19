#!/usr/bin/env node
/* Does the schema validator refuse what it must refuse?
 *
 *   npm run check:app-schema
 *
 * app-schema.ts asks a language model to design the tables an application
 * needs, and what comes back goes into a migration that a machine runs against
 * a database holding somebody's real rows. The model is not the thing being
 * tested here. The VALIDATOR is: every check below is a proposal that is wrong
 * in one of the ways that matters, and the only acceptable answer to each is a
 * refusal with a reason.
 *
 * Nothing is repaired anywhere in that file, deliberately, and these assert
 * that too — a table that is nearly right is worse than no table, because the
 * app is written against it and the defect is found by a customer.
 *
 * Offline. No model, no database, no key.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-app-schema");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, strict: true, types: ["node"],
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [join(process.cwd(), "src/lib/builder/app-schema.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });

const { readProposal, withAuthored } = await import(join(out, "lib/builder/app-schema.js"));

let failed = 0;
let passed = 0;
const ok = (t, d) => { passed += 1; console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`); };
const fail = (t, d) => { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

/* A proposal that is correct in every way, so each case below can be one
   change away from it rather than a fresh object nobody can compare. */
const sound = () => ({
  why: "The tables a task tracker needs.",
  tables: [
    {
      name: "projects",
      what: "One row per project somebody is tracking work in.",
      columns: [
        { name: "owner_id", type: "uuid", references: { table: "auth.users", onDelete: "cascade" } },
        { name: "name", type: "text" },
        { name: "archived", type: "boolean", default: "false" },
      ],
      indexes: [{ on: ["owner_id"] }],
      policies: [
        { name: "projects_own", for: "all", to: ["authenticated"], using: "owner_id = auth.uid()", why: "A person reaches their own projects and nobody else's." },
      ],
    },
    {
      name: "tasks",
      what: "One row per task inside a project.",
      columns: [
        { name: "project_id", type: "uuid", references: { table: "projects", onDelete: "cascade" } },
        { name: "title", type: "text" },
        { name: "done", type: "boolean", default: "false" },
      ],
      policies: [
        { name: "tasks_own", for: "all", to: ["authenticated"], using: "project_id in (select id from projects where owner_id = auth.uid())", why: "A task is reachable by whoever owns the project holding it." },
      ],
    },
  ],
});

console.log("\nA sound proposal is accepted:");

const good = readProposal(sound());
has(good.ok === true, "a well-formed schema comes back as tables", good.ok ? undefined : good.reason);
has(good.ok && good.tables.length === 2, "with every table it proposed");

/* THE ONE THING THAT IS ADDED. Asking the model for id/created_at/updated_at
   is asking it to get them subtly wrong in the one place a mistake is
   permanent. */
const projects = good.ok ? good.tables[0] : null;
has(
  projects && projects.columns[0].name === "id" && projects.columns[0].primaryKey === true,
  "every table is given an id primary key rather than asked for one",
);
has(
  projects && projects.columns.some((c) => c.name === "created_at") &&
    projects.columns.some((c) => c.name === "updated_at"),
  "and the two timestamps beside it",
);
has(
  projects && projects.columns.filter((c) => c.name === "id").length === 1,
  "a proposal that sends id anyway does not get two of them",
);

console.log("\nAnd the refusals, which are the point:");

/* THE ONE. RLS is the entire security model — the anon key is public and there
   is no server-side secret anywhere in a generated app. */
const noPolicy = sound();
noPolicy.tables[0].policies = [];
has(
  readProposal(noPolicy).ok === false,
  "a table with no policy is refused",
  "row-level security is the only thing protecting a generated app's data",
);

const allowsEverything = sound();
allowsEverything.tables[0].policies = [
  { name: "projects_all", for: "all", to: ["anon", "authenticated"], why: "no test at all" },
];
has(
  readProposal(allowsEverything).ok === false,
  "and so is a policy that tests nothing",
  "a policy with neither using nor check allows every row to everybody",
);

/* Everything below goes into SQL that schema.ts assembles by concatenation. */
for (const [label, expression] of [
  ["a statement separator", "owner_id = auth.uid(); drop table projects"],
  ["a SQL comment", "owner_id = auth.uid() -- anything"],
  ["a block comment", "owner_id = auth.uid() /* anything"],
  ["an unbalanced bracket", "owner_id = auth.uid("],
]) {
  const injected = sound();
  injected.tables[0].policies[0].using = expression;
  has(
    readProposal(injected).ok === false,
    `a policy expression carrying ${label} is refused`,
    "these are assembled into SQL by string concatenation",
  );
}

const newlineWhy = sound();
newlineWhy.tables[0].policies[0].why = "one line\n-- and then another";
const flattened = readProposal(newlineWhy);
has(
  flattened.ok && !flattened.tables[0].policies[0].why.includes("\n"),
  "a policy reason is flattened to one line",
  "it is emitted as a -- comment, and a newline ends the comment",
);

for (const [label, mutate] of [
  ["a table named with something that is not an identifier", (p) => { p.tables[0].name = "drop table"; }],
  ["a table this platform writes itself", (p) => { p.tables[0].name = "profiles"; }],
  ["the same table twice", (p) => { p.tables[1].name = "projects"; }],
  ["a column of an unknown type", (p) => { p.tables[0].columns[1].type = "serial"; }],
  ["a reference to a table that is not there", (p) => { p.tables[1].columns[0].references.table = "elsewhere"; }],
  ["a table with no columns of its own", (p) => { p.tables[0].columns = []; }],
  ["a proposal with no tables at all", (p) => { p.tables = []; }],
]) {
  const broken = sound();
  mutate(broken);
  has(readProposal(broken).ok === false, `${label} is refused`);
}

has(readProposal(null).ok === false, "and so is an answer that is not an object");
has(readProposal({ tables: "lots" }).ok === false, "and one whose tables are not a list");

console.log("\nMerging keeps the deterministic tables:");

/* profiles is the identity table and its policies are the reason a role cannot
   be self-granted. Nothing authored may replace it. */
const held = {
  schema: "app_1",
  buckets: [],
  tables: [{ name: "profiles", what: "the identity table", columns: [], policies: [] }],
};
const merged = withAuthored(held, [
  { name: "profiles", what: "an authored replacement", columns: [], policies: [] },
  { name: "tasks", what: "authored", columns: [], policies: [] },
]);
has(
  merged.tables.length === 2 && merged.tables[0].what === "the identity table",
  "an authored table never replaces one dataModelFor wrote",
  "profiles carries the policies that stop a role being self-granted",
);
has(merged.tables.some((t) => t.name === "tasks"), "and the rest are added beside it");

console.log(
  failed === 0 ? `\nAll ${passed} passed.` : `\n${failed} failed.`,
);
process.exit(failed === 0 ? 0 : 1);
