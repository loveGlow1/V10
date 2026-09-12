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
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-deploy");
mkdirSync(out, { recursive: true });

/* Compiled through the project's own tsconfig rather than a handful of CLI
   flags, because the module under test imports a type across the `@/` alias
   and is written for strict mode. A looser standalone compile does not just
   fail to resolve the path — it widens the `ok: true | false` discriminants to
   boolean and stops narrowing the result union, so the file would be checked
   under rules it is not written against. */
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  extends: join(process.cwd(), "tsconfig.json"),
  compilerOptions: {
    noEmit: false,
    outDir: out,
    rootDir: join(process.cwd(), "src"),
    module: "esnext",
    moduleResolution: "bundler",
    declaration: false,
    incremental: false,
    plugins: [],
  },
  include: [join(process.cwd(), "src/lib/publish/vercel-deploy.ts")],
}, null, 2));

execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

const { deploymentFiles, deploymentName, deploymentsConfigured } =
  await import(join(out, "lib/publish/vercel-deploy.js"));

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

// ── Configuration ─────────────────────────────────────────────────────────

const had = process.env.VERCEL_API_TOKEN;
delete process.env.VERCEL_API_TOKEN;
has(deploymentsConfigured() === false, "without a token, deployment reports itself unconfigured");
if (had !== undefined) process.env.VERCEL_API_TOKEN = had;

console.log(failed === 0 ? "\nall good" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
