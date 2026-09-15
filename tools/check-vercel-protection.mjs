#!/usr/bin/env node
/* Deployment Protection, turned off on the way in — and the alias that follows.
 *
 *   npm run check:vercel-protection
 *
 * A Vercel TEAM account protects new projects by default: every deployment
 * answers 401 to anybody not signed in to the team. That produced the failure
 * reported twice from real projects — the document loads for whoever is signed
 * in and the stylesheets it asks for do not, so the page renders completely
 * unstyled; and inside an iframe it is a blank white rectangle. A 401 on a
 * subresource is silent, so nothing anywhere says what went wrong.
 *
 * What is pinned here is the SHAPE OF THE REQUESTS, because that is the part
 * that is invisible until it is wrong in production:
 *
 *   The protection fields must be an explicit `null`. Vercel reads null as
 *   "off" and an ABSENT key as "leave it alone" — so a payload that merely
 *   omits them is a payload that changes nothing, and would look exactly like
 *   this fix while doing none of it.
 *
 *   Every call must carry the team query. Without it the call acts on the
 *   personal account rather than the team, which is a different Vercel and
 *   would silently do nothing to the project in hand.
 *
 *   None of it may fail a deployment. A token without project-write scope, a
 *   team policy, a bad minute at Vercel: the customer still gets their build.
 *   A site they must unprotect by hand is worth strictly more than no site.
 *
 * No network: fetch is stubbed and every request is recorded.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-vercel-protection");
mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify(
    {
      extends: join(root, "tsconfig.json"),
      compilerOptions: {
        noEmit: false, outDir: out, rootDir: join(root, "src"),
        module: "commonjs", moduleResolution: "node",
        declaration: false, incremental: false, plugins: [],
        baseUrl: root, paths: { "@/*": ["src/*"] },
      },
      include: [join(root, "src/lib/publish/vercel-deploy.ts")],
    },
    null,
    2,
  ),
);
try {
  execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { stdio: ["ignore", "ignore", "pipe"] });
} catch {}
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));
const shim = join(out, "node_modules");
mkdirSync(shim, { recursive: true });
try { symlinkSync(out, join(shim, "@"), "dir"); } catch {}

process.env.VERCEL_API_TOKEN = "test-token";
process.env.VERCEL_TEAM_ID = "team_abc";

const require = createRequire(import.meta.url);
const mod = require(join(out, "lib/publish/vercel-deploy.js"));
const { clearProtection, aliasDeployment, previewAliasFor, vercelCredentials } = mod;

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

/* ── A recording fetch ───────────────────────────────────────────────────── */

let calls = [];
function stubFetch(responder) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init.method ?? "GET", body, headers: init.headers ?? {} });
    const answer = responder(String(url), init) ?? { status: 200, body: {} };
    return {
      ok: answer.status < 400,
      status: answer.status,
      headers: { get: () => "application/json" },
      async json() { return answer.body ?? {}; },
      async text() { return JSON.stringify(answer.body ?? {}); },
    };
  };
}

const creds = vercelCredentials();
has(creds !== null, "credentials are read from the environment");
has(creds.teamQuery.includes("team_abc"), "and carry the team", creds.teamQuery);

/* ── The happy path ──────────────────────────────────────────────────────── */

{
  stubFetch(() => ({ status: 200, body: {} }));
  const result = await clearProtection("my-app", creds);

  has(result.cleared === true, "protection is reported cleared");
  has(result.note === null, "with nothing to tell the customer");

  const create = calls.find((c) => c.method === "POST");
  const patch = calls.find((c) => c.method === "PATCH");

  has(Boolean(create), "the project is created explicitly");
  has(create && create.url.includes("/v10/projects"), "at /v10/projects", create?.url);
  has(create && create.body.name === "my-app", "under the name the deployment will use");
  has(create && create.body.framework === "nextjs", "declared as a Next.js project");

  has(Boolean(patch), "and patched afterwards as a safety net");
  has(patch && patch.url.includes("/v9/projects/my-app"), "at /v9/projects/{name}", patch?.url);

  /* The heart of it: null, not absent. */
  for (const [label, call] of [["create", create], ["patch", patch]]) {
    has(
      call && "ssoProtection" in call.body && call.body.ssoProtection === null,
      `the ${label} sends ssoProtection as an explicit null`,
      JSON.stringify(call?.body),
    );
    has(
      call && "passwords" in call.body && call.body.passwords === null,
      `the ${label} sends passwords as an explicit null`,
    );
  }

  has(
    calls.every((c) => c.url.includes("teamId=team_abc")),
    "every call carries the team, or it acts on the wrong account",
    calls.map((c) => c.url).join("\n        "),
  );
  has(
    calls.every((c) => String(c.headers.Authorization ?? "").includes("test-token")),
    "and the token",
  );
}

/* ── The project already exists, which is every build after the first ────── */

{
  stubFetch((url, init) =>
    init.method === "POST" ? { status: 409, body: { error: { message: "already exists" } } } : { status: 200, body: {} },
  );
  const result = await clearProtection("my-app", creds);
  has(result.cleared === true, "a 409 on create is not a failure — the patch decides");
  has(calls.some((c) => c.method === "PATCH"), "and the patch still runs, which is the point of it");
}

/* ── It must never cost a deployment ─────────────────────────────────────── */

{
  stubFetch(() => ({ status: 403, body: { error: { message: "not authorized" } } }));
  const result = await clearProtection("my-app", creds);
  has(result.cleared === false, "a refusal is reported honestly");
  has(
    result.note && /Settings → Deployment Protection/.test(result.note),
    "with the place a person can go and fix it by hand",
    result.note,
  );
  has(
    result.note && /will build/.test(result.note),
    "and says the site still builds, because it does",
  );
}

{
  stubFetch(() => { throw new Error("network down"); });
  let threw = null;
  let result = null;
  try { result = await clearProtection("my-app", creds); } catch (e) { threw = e; }
  has(!threw, "a network failure does not throw out of it", threw ? String(threw) : "");
  has(result && result.cleared === false, "and is reported as not cleared");
}

/* ── The alias ───────────────────────────────────────────────────────────── */

{
  delete process.env.QUICKSTARK_PREVIEW_DOMAIN;
  has(previewAliasFor("my-app") === null, "with no base domain configured, no alias is attempted");

  process.env.QUICKSTARK_PREVIEW_DOMAIN = "preview.quickstark.tech";
  has(
    previewAliasFor("my-app") === "my-app.preview.quickstark.tech",
    "configured, the alias is the slug under the base",
    String(previewAliasFor("my-app")),
  );
  has(
    previewAliasFor("Nova Estates!") === "nova-estates.preview.quickstark.tech",
    "and the name is slugged into something a DNS label can be",
    String(previewAliasFor("Nova Estates!")),
  );
}

{
  stubFetch(() => ({ status: 200, body: { alias: "my-app.preview.quickstark.tech" } }));
  const result = await aliasDeployment("dpl_123", "my-app.preview.quickstark.tech", creds);
  has(result.ok === true, "an alias is assigned");
  const call = calls[0];
  has(
    call.url.includes("/v2/deployments/dpl_123/aliases"),
    "against the deployment, at the documented endpoint",
    call.url,
  );
  has(call.method === "POST", "as a POST");
  has(call.body.alias === "my-app.preview.quickstark.tech", "carrying the alias");
  has(call.url.includes("teamId=team_abc"), "and the team");
}

{
  /* The common refusal: the wildcard is not a verified domain on the account. */
  stubFetch(() => ({ status: 403, body: { error: { message: "domain not found" } } }));
  const result = await aliasDeployment("dpl_123", "x.preview.quickstark.tech", creds);
  has(result.ok === false, "a refused alias is reported, not thrown");
  has(result.reason.length > 0, "with a reason", result.ok ? "" : result.reason);
}

console.log(failed === 0 ? "\nAll Vercel protection checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
