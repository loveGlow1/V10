#!/usr/bin/env node
/* Which backend a project gets, whether it is real, and where its domain lives.
 *
 *   npm run check:backend-modes
 *
 * A custom domain, a Vercel deployment and a database are three different
 * layers, and this codebase had them fused in three separate places. Each fusion
 * was invisible for the same reason: the wrong answer and the right answer are
 * the same SHAPE, so nothing failed — things just pointed somewhere else.
 *
 *   EVERY PROJECT GOT A DATABASE. "No database" was the absence of a row, which
 *   is indistinguishable from a row that failed to write, so a landing page and
 *   a bookkeeping failure produced the same answer and that answer was "put it
 *   on the shared instance".
 *
 *   LINKING A BACKEND CHECKED SHAPE ONLY. Two regexes said the URL was https
 *   and the key was not a service key, and the project was marked connected.
 *   The first real test was a migration inside a sixty-second build, minutes
 *   later, where a typo looks like a build failure.
 *
 *   EVERY DOMAIN WENT ON THE PLATFORM'S VERCEL PROJECT. A generated app
 *   deployed to a Vercel project of its own could not be given a domain at all
 *   — the hostname resolved here, and this platform looked it up and served a
 *   publication that does not exist.
 *
 * So: the mode decision is asserted as pure logic, verification and provisioning
 * are driven against a stubbed fetch, and the domain layer is asserted at the
 * source, because what goes wrong there is an argument quietly not being passed.
 *
 * Offline. No token, no organisation, no network, and nothing is created.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-backend-modes");
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
      join(root, "src/lib/builder/backend/modes.ts"),
      join(root, "src/lib/builder/backend/verify.ts"),
      join(root, "src/lib/builder/backend/managed.ts"),
    ],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });

const modes = await import(join(out, "lib/builder/backend/modes.js"));
const verify = await import(join(out, "lib/builder/backend/verify.js"));
const managed = await import(join(out, "lib/builder/backend/managed.js"));

let failed = 0;
let passed = 0;
const ok = (t, d) => { passed += 1; console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`); };
const fail = (t, d) => { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

/* Every request any module under test made, so an assertion can be made about
   what was NOT sent as well as what was. */
let sent = [];
function stubFetch(reply) {
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url: String(url), method: init.method ?? "GET", body: init.body ?? null, headers: init.headers ?? {} });
    const answer = typeof reply === "function" ? reply(String(url), init) : reply;
    if (answer === "unreachable") throw new Error("ECONNREFUSED");
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      headers: { get: (name) => answer.headers?.[name.toLowerCase()] ?? null },
      json: async () => answer.body ?? null,
    };
  };
}
const realFetch = globalThis.fetch;

// ── The decision: does this project have a database, and whose ────────────
console.log("\nWhich backend a project gets:");

has(
  modes.BACKEND_MODES.every((m) => modes.MODE_LABEL[m] && modes.MODE_BLURB[m]),
  "every mode has something a person can choose on",
  "a mode with no blurb is a radio button with no explanation",
);

has(!modes.hasDatabase("none"), "`none` means no database");
has(
  ["quickstark_managed", "shared", "own"].every((m) => modes.hasDatabase(m)),
  "and every other mode means there is one",
);

has(
  modes.isProductionGrade("quickstark_managed") && modes.isProductionGrade("own"),
  "a project of its own is fit for real customer data",
);
has(
  !modes.isProductionGrade("shared") && !modes.isProductionGrade("none"),
  "the shared preview is not, and says so",
  "auth.users is one table per Supabase PROJECT — every app on the shared instance draws accounts from one pool",
);

/* THE ONE THE ARCHITECTURE TURNS ON. The manifest decides IF; the mode decides
   only WHERE. A choice made once in a settings panel must not conjure a
   database into a project that is a brochure. */
has(
  modes.modeFor({ needsDatabase: false, chosen: "own", canProvision: true }) === "none",
  "a project with no database layer gets none, whatever was chosen",
  "the manifest decides whether there is a database; the mode decides only whose it is",
);

has(
  modes.modeFor({ needsDatabase: true, canProvision: true }) === "quickstark_managed",
  "anything that needs one gets a Supabase project of its own",
);
has(
  modes.modeFor({ needsDatabase: true, canProvision: false }) === "shared",
  "falling back to the shared preview only where this deployment cannot provision",
);
has(
  modes.modeFor({ needsDatabase: true, chosen: "own", canProvision: true }) === "own" &&
    modes.modeFor({ needsDatabase: true, chosen: "own", canProvision: false }) === "own",
  "and an owner who linked their own Supabase is never overruled",
  "it is their account and their data",
);

has(
  modes.isBackendMode("own") && !modes.isBackendMode("Own") && !modes.isBackendMode(null) &&
    !modes.isBackendMode("postgres"),
  "a mode arriving over HTTP is checked against the list, not trusted",
);

// ── Verification: is that Supabase really there ───────────────────────────
console.log("\nWhether a linked backend actually works:");

const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.stub-anon-key";

sent = [];
stubFetch("unreachable");
let seen = await verify.verifyBackend("https://ref.supabase.co", KEY);
has(seen.ok === false && seen.reachable === false, "a Supabase that does not answer is not verified");
has(/paused/i.test(seen.problem), "and the commonest reason is the one named", seen.problem);

sent = [];
stubFetch({ status: 401 });
seen = await verify.verifyBackend("https://ref.supabase.co", KEY);
has(
  seen.ok === false && seen.reachable === true && seen.authorised === false,
  "a refused key is reachable-but-unauthorised, which is a different fix",
);
has(/SAME project/.test(seen.problem), "and the fix is the one that is actually wrong", seen.problem);

stubFetch({ status: 404 });
seen = await verify.verifyBackend("https://example.com", KEY);
has(seen.ok === false && /Project URL/.test(seen.problem), "a server that is not a Supabase says so");

stubFetch({ status: 503 });
seen = await verify.verifyBackend("https://ref.supabase.co", KEY);
has(seen.ok === false && seen.reachable === true, "and a project still starting up is reachable but not yet verified");

sent = [];
stubFetch({ status: 200, headers: { "content-profile": "public, graphql_public" }, body: {} });
seen = await verify.verifyBackend("https://ref.supabase.co/", KEY);
has(seen.ok === true && seen.authorised === true, "a Supabase that answers its own root is verified");
has(
  JSON.stringify(seen.schemas) === JSON.stringify(["public", "graphql_public"]),
  "and the schemas it will serve are read from it",
  seen.schemas?.join(", "),
);
has(
  sent[0]?.url === "https://ref.supabase.co/rest/v1/",
  "the trailing slash on a pasted URL does not become a double one",
  sent[0]?.url,
);

stubFetch({ status: 200, body: {} });
seen = await verify.verifyBackend("https://ref.supabase.co", KEY);
has(
  seen.ok === true && JSON.stringify(seen.schemas) === JSON.stringify(["public"]),
  "an instance that advertises no schemas is not failed over a missing header",
  "self-hosted and older PostgREST vary; a connection that works is not refused for that",
);

/* NOTHING IS WRITTEN. A verification that created a table to prove it could
   create tables would leave debris in somebody's database on every attempt,
   including the failed ones. */
has(
  sent.every((call) => call.method === "GET" && !call.body),
  "verification never writes anything to somebody else's database",
  sent.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`).join(", "),
);

// The PGRST106 question, asked BEFORE a build instead of discovered after one.
has(
  !verify.schemaIsServable("app_55e34f8f", ["public", "graphql_public"]),
  "a schema PostgREST does not serve is caught before the build, not after it",
);
has(verify.schemaIsServable("public", ["public"]), "and `public` is servable everywhere");
const problem = verify.schemaProblem("app_55e34f8f", ["public", "graphql_public"]);
has(
  /app_55e34f8f/.test(problem) && /Exposed schemas/.test(problem),
  "and the message names the schema and where to add it",
);

// ── Provisioning a project of its own ─────────────────────────────────────
console.log("\nGiving a project a Supabase of its own:");

const TOKEN = "sbp_stub_management_token";
delete process.env.SUPABASE_MANAGEMENT_TOKEN;
delete process.env.SUPABASE_ORG_ID;

has(!managed.configured(), "with no token and no organisation, nothing can be provisioned");
const why = managed.unconfiguredReason();
has(
  /SUPABASE_MANAGEMENT_TOKEN/.test(why) && /SUPABASE_ORG_ID/.test(why),
  "and an operator is told exactly which variables are missing",
  why,
);

sent = [];
stubFetch({ status: 200, body: {} });
let made = await managed.provisionProject({ projectName: "Store", projectId: "abc123def456" });
has(made.ok === false, "an unconfigured deployment refuses rather than throwing");
has(sent.length === 0, "and makes no request at all", `${sent.length} request(s) went out without a token`);

process.env.SUPABASE_MANAGEMENT_TOKEN = TOKEN;
process.env.SUPABASE_ORG_ID = "org_stub";
has(managed.configured(), "with both set, it can");

const names = [
  managed.managedName("Store", "abc123de-f456-7890-abcd-ef1234567890"),
  managed.managedName("Store", "99887766-5544-3322-1100-aabbccddeeff"),
];
has(names.every((n) => /^qs-[a-z0-9-]+$/.test(n)), "the project name is one Supabase will take", names.join(", "));
has(names[0] !== names[1], "and two customers who both called theirs Store are two projects");
has(
  /^qs-app-/.test(managed.managedName("🚀🚀🚀", "abc123de-0000-0000-0000-000000000000")),
  "a name with nothing usable in it still produces a name",
  managed.managedName("🚀🚀🚀", "abc123de-0000-0000-0000-000000000000"),
);

sent = [];
stubFetch((url) =>
  /api-keys/.test(url)
    ? { status: 200, body: [{ name: "anon", api_key: "anon-value" }] }
    : { status: 201, body: { id: "qrstuvwxyzabcdef" } },
);
made = await managed.provisionProject({ projectName: "Store", projectId: "abc123de-f456" });
has(made.ok === true, "a created project comes back with what the app is built against", made.reason);
has(made.ok && made.project.url === "https://qrstuvwxyzabcdef.supabase.co", "the URL is derived from the ref Supabase returned");
/* The point of the whole module: a project of its own has nothing to share a
   namespace with, so the tables go where PostgREST already serves them. */
has(made.ok && made.project.schema === "public", "and its schema is `public`, which is why PGRST106 cannot happen here");

const create = sent.find((call) => call.method === "POST");
const body = JSON.parse(create?.body ?? "{}");
has(
  body.organization_id === "org_stub" && typeof body.region === "string",
  "the project is created in the configured organisation, which is the account that pays",
);
has(
  `${create?.headers?.Authorization}` === `Bearer ${TOKEN}`,
  "the management token goes in the header and nowhere else",
);
/* The strongest credential in the system after SUPABASE_DB_URL — it can DELETE
   projects — so it must not come back in anything a caller might log. */
has(
  !JSON.stringify(made).includes(TOKEN),
  "and never appears in what is returned",
);
has(
  typeof body.db_pass === "string" && body.db_pass.length >= 16 && !JSON.stringify(made).includes(body.db_pass),
  "the database password is made, sent and forgotten — a credential with no reader is a liability",
);

sent = [];
stubFetch((url) =>
  /api-keys/.test(url)
    ? { status: 200, body: [{ name: "anon", api_key: "anon-value" }] }
    : { status: 201, body: { id: "another-ref-here" } },
);
await managed.provisionProject({ projectName: "Store", projectId: "abc123de-f456" });
const second = JSON.parse(sent.find((call) => call.method === "POST")?.body ?? "{}");
has(body.db_pass !== second.db_pass, "and it is a different password every time");

stubFetch({ status: 402, body: { message: "organization is over its project limit" } });
made = await managed.provisionProject({ projectName: "Store", projectId: "abc" });
has(
  made.ok === false && /over its project limit/.test(made.reason),
  "a refusal carries Supabase's own reason, because a status alone is not actionable",
  made.reason,
);

/* The dangerous case. Supabase may well have created a project and we cannot
   address it — an orphan somebody is paying for. */
stubFetch({ status: 201, body: { name: "qs-store-abc" } });
made = await managed.provisionProject({ projectName: "Store", projectId: "abc" });
has(
  made.ok === false && /may have been created/.test(made.reason),
  "an accepted create with no ref warns that there may be an orphan to find",
  made.reason,
);

stubFetch((url) => (/api-keys/.test(url) ? { status: 200, body: [] } : { status: 201, body: { id: "ref-ok" } }));
made = await managed.provisionProject({ projectName: "Store", projectId: "abc" });
has(
  made.ok === false && /retried rather than recreated/.test(made.reason),
  "and a project whose key is not ready yet is retried, not created a second time",
  made.reason,
);

stubFetch({ status: 200, body: { status: "COMING_UP" } });
has(!(await managed.projectReady("ref")), "a project still coming up is not ready for a migration");
stubFetch({ status: 200, body: { status: "ACTIVE_HEALTHY" } });
has(await managed.projectReady("ref"), "and one that is healthy is");

stubFetch({
  status: 200,
  body: [
    { database_type: "READ_REPLICA", connection_string: "postgres://replica" },
    { database_type: "PRIMARY", connection_string: "postgres://primary" },
  ],
});
has(
  (await managed.connectionStringFor("ref")) === "postgres://primary",
  "a migration goes to the primary, over the pooler",
  "the direct host resolves to IPv6 only and a Vercel function has no IPv6 egress",
);

delete process.env.SUPABASE_MANAGEMENT_TOKEN;
delete process.env.SUPABASE_ORG_ID;
globalThis.fetch = realFetch;

// ── Three layers, not one ─────────────────────────────────────────────────
console.log("\nA domain, a Vercel project and a database are three different things:");

const domains = readFileSync(join(root, "src/app/api/domains/route.ts"), "utf8");
const vercelDomains = readFileSync(join(root, "src/lib/publish/vercel-domains.ts"), "utf8");
const schema = readFileSync(join(root, "supabase/schema.sql"), "utf8");
const connection = readFileSync(join(root, "src/lib/builder/backend/connection.ts"), "utf8");

has(
  /vercel_project/.test(schema) && /project_domains/.test(schema),
  "the Vercel project a domain was attached to is a stored column",
  "deriving it from the project name means a project that changes shape strands its own domain",
);
has(
  /add column if not exists mode text/.test(schema),
  "and the backend mode is a column rather than an inference",
);

/* Type/database drift, which is the way a new mode goes wrong: the TypeScript
   accepts it, the panel offers it, and the insert is refused by a CHECK nobody
   thought to widen. */
const check = /project_backends_mode_check[\s\S]{0,200}?check \(mode in \(([^)]*)\)\)/.exec(schema);
const allowed = (check?.[1] ?? "").split(",").map((v) => v.trim().replace(/'/g, "")).filter(Boolean).sort();
has(
  JSON.stringify(allowed) === JSON.stringify([...modes.BACKEND_MODES].sort()),
  "the database accepts exactly the modes the code can produce",
  `database: ${allowed.join(", ") || "(no constraint found)"} — code: ${[...modes.BACKEND_MODES].sort().join(", ")}`,
);

/* The security property of this table, and adding columns is exactly when it
   gets broken: db_url is settable, replaceable, and readable by nobody. */
const selectGrants = schema.match(/grant select \(([^)]*)\)\s*\n?\s*on public\.project_backends/g) ?? [];
has(
  selectGrants.length > 0 && selectGrants.every((grant) => !/db_url/.test(grant)),
  "and no SELECT grant on project_backends can read db_url",
  selectGrants.length ? selectGrants.find((g) => /db_url/.test(g)) : "no select grant found at all",
);

has(
  /addDomain\(domain, vercelProject\)/.test(domains),
  "a domain is ADDED to the project that will actually serve it",
);
has(
  /removeDomain\([^)]*vercel_project/.test(domains),
  "REMOVED from the project it was attached to, read from the row",
  "removing it from the platform's project instead leaves the hostname on the app's, serving nothing and claimable by nobody",
);
has(
  (domains.match(/row\.vercel_project/g) ?? []).length >= 2,
  "and RE-CHECKED against that same project",
  "polling the platform about a domain on an app's project answers `not found` forever, so it sits at awaiting_dns whatever the owner does to their DNS",
);
has(
  /vercel_project/.test(domains.slice(domains.indexOf("export async function GET"), domains.indexOf("export async function POST"))),
  "the re-check selects the column it needs",
);

/* The three-layer rule in one assertion: a domain may be connected to a
   deployed app, which has no published snapshot and never will. */
has(
  /latestDeployment\(/.test(domains) && /published_version_id/.test(domains),
  "a domain can point at a deployed app OR a published page",
  "requiring a published snapshot meant a generated Next.js app could not have a domain at all",
);

has(
  /VERCEL_PROJECT_ID/.test(vercelDomains),
  "and the platform's own project is the fallback, not the only answer",
);

has(
  /stored === "none"[\s\S]{0,40}return null/.test(connection),
  "a project whose mode is `none` resolves to no backend",
  "no connection opened, no schema named, no migration written — provision only what is needed",
);

// ── The panel a person actually chooses on ────────────────────────────────
console.log("\nAnd there is somewhere to choose:");

const panel = readFileSync(join(root, "src/app/dashboard/components/workspace/BackendPanel.tsx"), "utf8");
const backendRoute = readFileSync(join(root, "src/app/api/projects/[id]/backend/route.ts"), "utf8");

/* The mode union in the panel is written by hand — it cannot import from a
   server module — so it drifts silently, and the symptom is a mode the server
   returns that the panel renders as nothing at all. */
const declared = /type Mode =([^;]*);/.exec(panel)?.[1] ?? "";
const inPanel = (declared.match(/"([a-z_]+)"/g) ?? []).map((v) => v.replace(/"/g, "")).sort();
has(
  JSON.stringify(inPanel) === JSON.stringify([...modes.BACKEND_MODES].sort()),
  "the panel knows every mode the server can send",
  `panel: ${inPanel.join(", ")} — server: ${[...modes.BACKEND_MODES].sort().join(", ")}`,
);
has(
  inPanel.every((mode) => new RegExp(`\\b${mode}:`).test(panel)),
  "and has a title for each of them",
  "a mode with no title renders as an empty heading",
);

/* The bug this whole exercise started from: resolveBackend correctly answers
   null for a project with no database, and the panel showed that as an error. */
has(
  /chosen === "none"/.test(backendRoute) &&
    backendRoute.indexOf('chosen === "none"') < backendRoute.indexOf("await resolveBackend"),
  "a project with no database is answered before a connection is looked for",
  "resolveBackend answers null for it, and reporting that as `No Supabase is configured` turns a decision into an error",
);

has(
  /needsDatabase/.test(backendRoute) && /project_architecture/.test(backendRoute),
  "what the product needs comes from the manifest the build wrote",
  "the mode decides only WHERE the data lives; the manifest decides IF there is any",
);
has(
  /modeFor\(\{ needsDatabase, chosen, canProvision \}\)/.test(backendRoute),
  "and the recommendation is the one decision function, not a second copy of it",
);
has(
  /unavailableBecause/.test(backendRoute) && /unavailableBecause/.test(panel),
  "an option this deployment cannot honour says why, where somebody reads it",
  "`unavailable` on its own sends somebody to support for a missing environment variable",
);
has(
  !/setBackend\(\{/.test(panel),
  "the panel re-reads after a change rather than assembling the new state itself",
  "a half-filled Backend puts a panel on screen that disagrees with the server about what the project is",
);

console.log(failed ? `\n${failed} failed.` : `\nAll ${passed} passed.`);
process.exit(failed ? 1 : 0);
