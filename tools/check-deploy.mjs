#!/usr/bin/env node
/* What gets uploaded when a generated project is deployed.
 *
 *   npm run check:deploy
 *
 * The deployment itself cannot be tested without a Vercel token and a network,
 * and the half that can be tested without either is the half that would do the
 * damage. Two things matter here and neither involves an HTTP call:
 *
 *   WHAT GOES IN THE FILES. A generated app is handed three NEXT_PUBLIC_
 *   values so it can reach its database, and NEXT_PUBLIC_ means Next inlines
 *   them at build time and serves them to every visitor. Anything else that
 *   found its way into that file — a service-role key, a Postgres URL — would
 *   be published to the whole internet by a function whose job is to publish.
 *   So: exactly three keys, and nothing that looks like a secret, ever.
 *
 *   WHAT THE SITE IS CALLED. The name becomes a hostname, so it has to survive
 *   being put in one whatever somebody called their project — including an
 *   emoji, a sentence, or nothing at all — and two projects with the same
 *   title must not become one site.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-deploy");
mkdirSync(out, { recursive: true });

/* Compiled through the project's own tsconfig rather than a handful of CLI
   flags, because the module is written for strict mode: a looser compile
   widens the `ok: true | false` discriminants to boolean and stops narrowing
   the result union, so the file would be checked under rules it is not
   written against. */
/* CommonJS, not ESM. vercel-deploy.ts now imports a VALUE from scaffold.ts —
   the framework version the platform stands behind — so this is a real runtime
   import graph rather than one file, and tsc does not rewrite `@/lib/...` or
   `./design` to anything Node can resolve when it emits ES modules. CommonJS
   requires do resolve them. */
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  extends: join(root, "tsconfig.json"),
  compilerOptions: {
    noEmit: false, outDir: out, rootDir: join(root, "src"),
    module: "commonjs", moduleResolution: "node",
    declaration: false, incremental: false, plugins: [],
    baseUrl: root, paths: { "@/*": ["src/*"] },
  },
  include: [join(root, "src/lib/publish/vercel-deploy.ts")],
}, null, 2));
execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));

/* tsc does not rewrite the `@/` alias in what it emits, so the compiled file
   still requires "@/lib/builder/scaffold" literally. Node resolves that as a
   package named `@`, so pointing one at the emitted root makes it resolvable
   without touching the source for the sake of a test. */
const shim = join(out, "node_modules");
mkdirSync(shim, { recursive: true });
try { symlinkSync(out, join(shim, "@"), "dir"); } catch { /* already there */ }
const require = createRequire(import.meta.url);
const { deploymentFiles, deploymentName, deploymentsConfigured, productionDomain, stableHost } =
  require(join(out, "lib/publish/vercel-deploy.js"));

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const TARGET = {
  name: "shop-abc123",
  supabaseUrl: "https://example.supabase.co",
  supabaseAnonKey: "anon-key-value",
  supabaseSchema: "app_55e34f8f84e14c578c5f0d86936acf42",
};

const TREE = [
  { path: "package.json", content: '{"name":"shop"}' },
  { path: "app/page.tsx", content: "export default function Page() { return null; }" },
  { path: "app/layout.tsx", content: "export default function L() { return null; }" },
];

// ── What goes in the files ────────────────────────────────────────────────

const files = deploymentFiles(TREE, TARGET);
const env = files.find((f) => f.file === ".env.production");

has(files.length === TREE.length + 1, "every source file is uploaded, plus the environment",
  `got ${files.length} for a tree of ${TREE.length}`);
has(files.every((f) => f.encoding === "utf-8" && typeof f.data === "string"),
  "every entry is an inline utf-8 file");
has(!!env, "an .env.production is written");

const keys = (env?.data ?? "").split("\n").filter(Boolean).map((line) => line.split("=")[0]).sort();
has(
  JSON.stringify(keys) === JSON.stringify([
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_SCHEMA",
    "NEXT_PUBLIC_SUPABASE_URL",
  ]),
  "exactly the three public keys, and nothing else",
  `got ${keys.join(", ")}`,
);

/* THE ONE THAT MATTERS. This file is compiled into a public website. If any of
   these ever appears in it, the deploy path has become a way to publish the
   platform's own credentials. */
const FORBIDDEN = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "VERCEL_API_TOKEN",
  "VERCEL_TEAM_ID",
  "service_role",
  "postgresql://",
  "postgres://",
];
const leaked = FORBIDDEN.filter((needle) => (env?.data ?? "").includes(needle));
has(leaked.length === 0, "no secret can reach the published environment file",
  leaked.length ? `LEAKED: ${leaked.join(", ")}` : undefined);

has(env.data.includes(`NEXT_PUBLIC_SUPABASE_SCHEMA=${TARGET.supabaseSchema}`),
  "the app is pointed at its own schema");

/* A generator that emitted its own guess at these must not win over the
   platform's real values. */
const withGuess = deploymentFiles(
  [...TREE, { path: ".env.production", content: "NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321" }],
  TARGET,
);
const envs = withGuess.filter((f) => f.file === ".env.production");
has(envs.length === 1 && envs[0].data.includes(TARGET.supabaseUrl),
  "a generated .env.production is replaced, not duplicated",
  `${envs.length} env files, data=${envs[0]?.data?.slice(0, 60)}`);

has(deploymentFiles([...TREE, { path: ".env.local", content: "X=1" }], TARGET)
  .every((f) => f.file !== ".env.local"),
  "a generated .env.local never ships");

/* ── A project with no backend gets no credentials ────────────────────────
 *
 * The three fields used to be read off process.env at both call sites, so
 * EVERY deployment carried the platform's own Supabase address and anon key —
 * including a frontend-only project that has no client to use them and no
 * business holding them, and including a project linked to its owner's
 * database, which got ours instead of theirs.
 *
 * The caller supplies them now, from envFor(resolveBackend(...)), and absent
 * means absent. */
const noBackend = deploymentFiles(TREE, { name: TARGET.name });
has(noBackend.every((f) => f.file !== ".env.production"),
  "a project with no backend ships no environment file at all",
  noBackend.find((f) => f.file === ".env.production")?.data);

has(!JSON.stringify(noBackend).includes("supabase.co"),
  "and no Supabase address reaches it by any other route");

/* Half a connection is not a connection. A target missing any one of the three
   must not produce a file with `undefined` in it, which would compile into the
   bundle and fail at runtime in somebody's browser. */
const partial = deploymentFiles(TREE, { name: TARGET.name, supabaseUrl: TARGET.supabaseUrl });
has(partial.every((f) => f.file !== ".env.production"),
  "a partial connection is refused rather than half-written");

// ── The framework version ─────────────────────────────────────────────────
//
// A stored tree pinning next@15.5.4 could not be deployed at all: Vercel
// refuses a vulnerable framework AFTER a clean compile, so the build succeeds
// and the deployment fails. The tree is not rewritten in the database — the
// current pin is carried at deploy time, so an old build becomes deployable
// without regenerating it and charging for it twice.

const stale = deploymentFiles(
  [{ path: "package.json", content: JSON.stringify({
      name: "shop",
      dependencies: { next: "15.5.4", react: "19.1.0" },
      devDependencies: { typescript: "5.6.3" },
    }) }],
  TARGET,
);
const manifest = JSON.parse(stale.find((f) => f.file === "package.json").data);

has(manifest.dependencies.next !== "15.5.4", "a deprecated framework pin is not uploaded");
has(/^\d+\.\d+\.\d+$/.test(manifest.dependencies.next),
  "it is replaced with an exact version", manifest.dependencies.next);
has(manifest.dependencies.react === "19.1.0", "every other dependency is left alone");
has(manifest.devDependencies.typescript === "5.6.3", "devDependencies are left alone");
has(manifest.name === "shop", "the rest of the manifest is untouched");

/* A manifest that is not JSON fails the build loudly, which is the right
   failure. A deploy step that silently repairs one hides a real problem. */
const broken = deploymentFiles([{ path: "package.json", content: "{ not json" }], TARGET);
has(broken.find((f) => f.file === "package.json").data === "{ not json",
  "an unparseable manifest is left exactly as it is");

// ── What the site is called ───────────────────────────────────────────────

const id = "55e34f8f-84e1-4c57-8c5f-0d86936acf42";
const other = "11111111-2222-3333-4444-555555555555";

const hostname = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
for (const [label, input] of [
  ["an ordinary title", "Dashboard with sign in"],
  ["punctuation", "Ade's Bakery — Lagos!"],
  ["emoji only", "🎂🎉"],
  ["empty", ""],
  ["very long", "a".repeat(300)],
  ["already a slug", "my-shop"],
]) {
  const name = deploymentName(input, id);
  has(hostname.test(name) && name.length <= 52, `${label} makes a usable hostname`, `got "${name}"`);
}

has(deploymentName("Shop", id) !== deploymentName("Shop", other),
  "two projects with the same title are two sites");
has(deploymentName("Shop", id) === deploymentName("Shop", id),
  "the same project keeps the same site across builds");

// ── The address somebody is given ─────────────────────────────────────────
//
// Vercel returns two kinds of hostname and only one of them is worth giving to
// a person. This was handing out the wrong one and calling it live:
//
//   nova-estates-038f1129-6dj1ceo99-neuralis-systems-ai.vercel.app
//
// That is the DEPLOYMENT url — unique to one build, different after the next
// one. Somebody who bookmarked it, or sent it to a colleague, had a link that
// silently stopped being their latest app the moment they changed anything.

const DEPLOYMENT_HOST = "nova-estates-038f1129-6dj1ceo99-neuralis-systems-ai.vercel.app";
const PRODUCTION_ALIAS = "nova-estates-038f1129.vercel.app";

has(stableHost([PRODUCTION_ALIAS, DEPLOYMENT_HOST], DEPLOYMENT_HOST) === PRODUCTION_ALIAS,
  "THE ONE: the stable alias wins over the per-build url",
  `got ${stableHost([PRODUCTION_ALIAS, DEPLOYMENT_HOST], DEPLOYMENT_HOST)}`);

/* A custom domain is what somebody actually wants people to see, so it beats
   even the stable .vercel.app one. */
has(stableHost(["nova-estates.quickstark.tech", PRODUCTION_ALIAS], DEPLOYMENT_HOST)
      === "nova-estates.quickstark.tech",
  "a custom domain beats a vercel.app name");

/* Order must not decide it — Vercel does not promise one. */
has(stableHost([DEPLOYMENT_HOST, PRODUCTION_ALIAS], DEPLOYMENT_HOST) === PRODUCTION_ALIAS,
  "the order Vercel lists them in does not matter");

/* With nothing to choose from, the deployment url is still better than
   nothing — a real address that works today beats an empty card. */
has(stableHost([], DEPLOYMENT_HOST) === DEPLOYMENT_HOST,
  "no aliases at all falls back to the deployment url");

has(stableHost([DEPLOYMENT_HOST], DEPLOYMENT_HOST) === DEPLOYMENT_HOST,
  "an alias list containing only the deployment url is the same thing");

/* ── And the fast path has to make the same choice ─────────────────────────
 *
 * stableHost was correct, tested, and called only from the POLLING path. The
 * upload path parsed the aliases — readDeployment has always returned them —
 * and then returned the raw deployment host anyway, so the address written to
 * the build row, shown as "YOUR APP IS LIVE" and embedded in the workspace was
 * the per-build one.
 *
 * On a Vercel team account that host is behind Deployment Protection by
 * default: 401 to anyone not signed in to the team, which inside an iframe is
 * a blank white rectangle. The customer is told their app is live, handed a
 * link, and shown an empty box. The production alias — assigned at creation,
 * because these are created with target: "production" — is not protected.
 *
 * Read from source: the call cannot be made here without a Vercel token, but
 * dropping the aliases is the defect and it is visible. */
const deploySource = readFileSync(join(root, "src/lib/publish/vercel-deploy.ts"), "utf8");
const startBody = deploySource.slice(
  deploySource.indexOf("export async function startDeployment"),
  deploySource.indexOf("export type DeploymentState"),
);

has(
  /url: `https:\/\/\$\{stableHost\(deployment\.aliases, deployment\.url, target\.name\)\}`/.test(startBody),
  "the upload path hands back the stable alias, not the per-build host",
  "a per-build host is behind Deployment Protection on a team account: 401, and a white iframe",
);

/* Never a scheme, never a path — the caller prefixes https:// itself, and a
   host that arrived with one would produce https://https://… */
for (const host of [PRODUCTION_ALIAS, "nova-estates.quickstark.tech", DEPLOYMENT_HOST]) {
  const picked = stableHost([host], DEPLOYMENT_HOST);
  has(!picked.includes("://") && !picked.includes("/"),
    `the result is a bare hostname — ${picked}`);
}

// ── Configuration ─────────────────────────────────────────────────────────

const had = process.env.VERCEL_API_TOKEN;
delete process.env.VERCEL_API_TOKEN;
has(deploymentsConfigured() === false, "without a token, deployment reports itself unconfigured");
if (had !== undefined) process.env.VERCEL_API_TOKEN = had;

/* ── Whose address it is ───────────────────────────────────────────────────
 *
 * A deployment belongs to the PROJECT. It is a site that is up, and it stays
 * up whatever happens in the workspace afterwards.
 *
 * The workspace asked the newest BUILD row for it, and took whatever address
 * was on that row. The newest build is very often not the one that deployed —
 * an edit that changed source without redeploying, a build that failed, a
 * stage of a longer plan — and every one of those rows carries a null. So a
 * project that was live went dark in its own workspace because somebody sent
 * it a message: the preview fell back to the stored document, which for a
 * Next.js project is the SUMMARY, and the customer was shown a receipt where
 * their application had been, with nothing saying the site was still up.
 *
 * Read from source. The query cannot be run here without a database, but the
 * shape of it is the defect, and the shape is visible. */
const deployRoute = readFileSync(
  join(root, "src/app/api/projects/[id]/deploy/route.ts"),
  "utf8",
);

has(
  /\.not\(\s*"deployment_url"\s*,\s*"is"\s*,\s*null\s*\)/.test(deployRoute),
  "the live address is the newest build that HAS one, not the newest build",
  "without the filter, any build after a deployment blanks the address of a project that is still up",
);

has(
  /const url = live\?\.deployment_url/.test(deployRoute),
  "and that is what the workspace is handed",
);

/* The failure is still the LAST attempt's, not the last deployment's — those
   are different questions and reading one for the other would report a reason
   from before the deployment that succeeded. */
has(
  /const failure = url \? null : \(latest\?\.deployment_error/.test(deployRoute),
  "a reason is only offered when there is no live address to offer instead",
);

const deploySourceForNames = readFileSync(
  join(root, "src/lib/publish/vercel-deploy.ts"),
  "utf8",
);

/* ── The address, when Vercel has not named one yet ───────────────────────
 *
 * "Deployment links only really open on Vercel. Only domain links open in any
 * browser." That is the bug in one sentence, and the fix is arithmetic rather
 * than patience.
 *
 * At the moment a deployment is CREATED, Vercel's response often carries no
 * aliases at all — they are reported once it has built. Falling back to the
 * deployment host there hands back the per-build address, which on a team
 * account is behind Deployment Protection: 401 to everyone not signed in to
 * the team, and a blank white rectangle inside an iframe.
 *
 * The production domain does not have to be waited for. Vercel gives a project
 * `<project>.vercel.app` and re-points it at each new production deployment,
 * and these are all created with target: "production". So the name we chose
 * for the project IS the address. */
has(productionDomain("swiftcargo-using-next-7e7c4cb5") === "swiftcargo-using-next-7e7c4cb5.vercel.app",
  "a project's domain is its name",
  `got ${productionDomain("swiftcargo-using-next-7e7c4cb5")}`);

/* THE ONE THAT WAS REPORTED, in the shape it was reported in: a deployment
   Vercel had named no alias for, whose per-build host was shown to the
   customer as "YOUR APP IS LIVE" and opened as a blank page. */
has(
  stableHost([], "swiftcargo-using-next-7e7c4cb5-ph1a4eon9-neuralis-systems-ai.vercel.app",
    "swiftcargo-using-next-7e7c4cb5") === "swiftcargo-using-next-7e7c4cb5.vercel.app",
  "with no aliases reported, the project's domain wins over the per-build host",
  `got ${stableHost([], "swiftcargo-using-next-7e7c4cb5-ph1a4eon9-neuralis-systems-ai.vercel.app", "swiftcargo-using-next-7e7c4cb5")}`,
);

/* A real alias still beats a derived one — it is what Vercel actually says. */
has(stableHost([PRODUCTION_ALIAS], DEPLOYMENT_HOST, "some-project") === PRODUCTION_ALIAS,
  "a reported alias beats a derived domain");
has(stableHost(["nova.quickstark.tech"], DEPLOYMENT_HOST, "some-project") === "nova.quickstark.tech",
  "and a custom domain beats both");

/* Without a project name there is nothing to derive, and the old answer
   stands — no worse than it was. */
has(stableHost([], DEPLOYMENT_HOST) === DEPLOYMENT_HOST,
  "with no name and no aliases, the deployment host is still the fallback");

/* Every path that resolves an address takes the name, not just the first one:
   the upload, the poll and the wait each had their own copy of this. */
/* Counted rather than eyeballed: there are three places that resolve an
   address — the upload, the poll and the wait — and each had its own copy of
   the same mistake. A call site left without the name is an address that comes
   back protected, which is invisible until somebody opens it. */
const resolvesAddress = deploySourceForNames.match(/stableHost\([\s\S]{0,140}?\)\s*[;`}]/g) || [];
const calls = resolvesAddress.filter((call) => !call.includes("aliases: string[]"));
has(
  calls.length >= 3 && calls.every((call) => /projectName\)|target\.name\)/.test(call)),
  `every address the deploy module resolves is given the project name — ${calls.length} call sites`,
  calls.filter((call) => !/projectName\)|target\.name\)/.test(call)).join(" | ") || "none found",
);

/* ── Pressing Deploy ───────────────────────────────────────────────────────
 *
 * Two separate failures, both of them in the moment somebody presses the
 * button and expects something to happen.
 *
 * THE ADDRESS DID NOT SURVIVE. Only this path skipped writing it: the save
 * route puts deployment_url on the build row as soon as Vercel accepts an
 * upload, and the deploy button deferred entirely to settleDeployment in the
 * cron. So the address lived in one fetch response and was gone on reload —
 * the workspace asked the build row, found nothing, and went back to showing
 * the summary as though nothing had been deployed.
 *
 * THE PANE WENT BLANK. Vercel answers as soon as it has ACCEPTED the upload;
 * installing and compiling takes another one to three minutes. The panel
 * pointed its frame at that address immediately, so pressing Deploy replaced a
 * working preview of the landing page with a white rectangle for the length of
 * the build. The app was fine. It simply was not there yet. */
const deployApi = readFileSync(
  join(root, "src/app/api/projects/[id]/deploy/route.ts"),
  "utf8",
);
const post = deployApi.slice(deployApi.indexOf("export async function POST"));

has(
  /deployment_url: started\.url, deployment_error: null/.test(post),
  "pressing Deploy writes the address where the workspace reads it",
  "otherwise it lives in one response and the next load shows the summary again",
);

const panel = readFileSync(
  join(root, "src/app/dashboard/components/workspace/PreviewPanel.tsx"),
  "utf8",
);

has(
  /setBuilding\(body\.building === true\)/.test(panel),
  "the panel keeps `building` apart from `deployed`",
  "the address is real before the site behind it is",
);

/* Matched as a PREFIX rather than as the whole condition. What this test is
   defending is that `!building` guards the frame — pointing it at a site that
   is still compiling is what turned a working preview into a blank white pane
   on every deploy. Further conjuncts narrow that further and are fine; the
   literal-string form of this assertion failed the moment one was added, which
   made it a test of the spelling rather than of the property. */
has(
  /\{deployed && !building(?: && \w+)* \? \(/.test(panel),
  "and does not point the frame at a site that is still compiling",
  "this is what turned a working preview into a blank white pane on every deploy",
);

/* ── And does not point it at a site that is out of date either ──────────
 *
 * The other way the frame can lie, and a newer one: an edit no longer
 * deploys itself, so a project that is live and has since been edited has a
 * site older than its own source. Framing that site shows somebody the
 * version BEFORE the change they just made, in the pane whose job is to show
 * them what they have.
 *
 * The frame must prefer the newest source in that case, and the older site
 * must still be named rather than silently dropped — it is up, it is theirs,
 * and people have the address. */
has(
  /&& liveIsCurrent \? \(/.test(panel),
  "and does not point the frame at a site that is behind the newest build",
  "an edit that is stored but not published must not be invisible in the preview",
);

has(
  /!liveIsCurrent \? \(/.test(panel) && /live site is behind this preview/i.test(panel),
  "and says so, rather than quietly hiding the site that is up",
);

has(
  /const current = Boolean\(/.test(deployApi) && /\bcurrent,/.test(deployApi),
  "the server decides whether the live address is current, and reports it",
  "the browser cannot know which build is deployed",
);

has(
  /deployed && building \?/.test(panel) && /Building your app/.test(panel),
  "while showing the address, which is the thing somebody wants to copy",
);

console.log(failed === 0 ? "\nall good" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
