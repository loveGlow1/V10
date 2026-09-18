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
const { appDomainFor, attachProjectDomain, clearProtection, aliasDeployment, deploymentFiles, previewAliasFor,
        projectDomains, projectEnvironment, projectSecretNames, removeProjectSecret, secretKeyProblem,
        setProjectEnvironment, setProjectSecret, vercelCredentials } = mod;

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
    /* The third gate. An IP allow-list answers 403 to everybody who is not the
       team, which on a generated project is everybody it was made for. */
    has(
      call && "trustedIps" in call.body && call.body.trustedIps === null,
      `the ${label} sends trustedIps as an explicit null`,
      JSON.stringify(call?.body),
    );
    /* `passwordProtection`, under the name the v9 project endpoint actually
       reads. This asserted `passwords`, which is not a field Vercel has: the
       key was accepted, ignored, and password protection stayed on — so the
       check passed for years while the thing it was guarding did not work. A
       login box in front of a published site is the visible half of that. */
    has(
      call && "passwordProtection" in call.body && call.body.passwordProtection === null,
      `the ${label} sends passwordProtection as an explicit null`,
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

/* ── The environment, set on the PROJECT and not only in the upload ───────
 *
 * `.env.production` goes up with the files and is what the build reads. It only
 * exists in the deployment that carried it, though, and the variables are a
 * fact about the project rather than about one build of it.
 *
 * A customer's store proved the difference: its database credentials were wiped
 * by a failed re-provision, so the next deploy resolved no backend, wrote no
 * env file, and the build died on /_not-found for want of two strings that were
 * still sitting correct in the database they came from. Set on the project they
 * survive that, and survive a redeploy started from Vercel's own dashboard. */
const TARGET = {
  name: "my-app",
  supabaseUrl: "https://probe.supabase.co",
  supabaseAnonKey: "anon-key",
  supabaseSchema: "app_probe",
};

{
  const vars = projectEnvironment(TARGET);
  has(
    vars && vars.NEXT_PUBLIC_SUPABASE_URL === TARGET.supabaseUrl
      && vars.NEXT_PUBLIC_SUPABASE_ANON_KEY === TARGET.supabaseAnonKey
      && vars.NEXT_PUBLIC_SUPABASE_SCHEMA === TARGET.supabaseSchema,
    "the three variables come from one definition",
    JSON.stringify(vars),
  );
  has(
    projectEnvironment({ name: "my-app" }) === null,
    "a project with no backend has none, rather than three empty ones",
    "writing somebody else's credentials into a site that never asked for a database",
  );
}

{
  stubFetch(() => ({ status: 200, body: {} }));
  await clearProtection("my-app", creds, projectEnvironment(TARGET));
  const create = calls.find((c) => c.method === "POST" && c.url.includes("/v10/projects") && !c.url.includes("/env"));
  const sent = create?.body?.environmentVariables ?? [];

  has(sent.length === 3, "a project is CREATED carrying its environment", `${sent.length} variable(s)`);
  has(
    sent.every((v) => Array.isArray(v.target) && v.target.includes("production")),
    "targeted at production",
  );
  has(
    sent.every((v) => v.type === "plain"),
    "and marked plain, because every one of them is NEXT_PUBLIC_ and is served to visitors",
    "calling a value secret that the bundle publishes is a lie to whoever reads the dashboard",
  );
}

{
  /* The same door, handed something that is not published. It must not be
     written plain whatever the caller believed it was sending: a plain value
     that should have been encrypted is a leak, and an encrypted one that need
     not have been costs nothing. */
  stubFetch(() => ({ status: 200, body: {} }));
  await setProjectEnvironment("my-app", { STRIPE_SECRET_KEY: "sk_live_x" }, creds);
  const written = calls.find((c) => c.url.includes("/env"));
  const entry = Array.isArray(written?.body) ? written.body[0] : null;

  has(
    entry && entry.type === "encrypted",
    "a name without the published prefix is encrypted even through the public door",
    entry?.type,
  );
}

{
  stubFetch(() => ({ status: 200, body: {} }));
  const result = await setProjectEnvironment("my-app", projectEnvironment(TARGET), creds);
  const written = calls.find((c) => c.url.includes("/env"));

  has(result.set === true, "an existing project's environment is updated too");
  has(written && written.method === "POST", "as a POST", written?.method);
  has(
    written && written.url.includes("/v10/projects/my-app/env"),
    "at /v10/projects/{name}/env",
    written?.url,
  );
  has(
    written && written.url.includes("upsert=true"),
    "upserted, so the hundredth deploy is the same call as the first",
    written?.url,
  );
  has(written && written.url.includes("team_abc"), "and carries the team", written?.url);
  has(Array.isArray(written?.body) && written.body.length === 3, "with all three variables");
}

{
  /* Refused. The upload still carries .env.production, so this build is fine
     and the cost is borne by later ones — which is what the note has to say. */
  stubFetch((url) => (url.includes("/env") ? { status: 403, body: { error: { message: "no access" } } } : { status: 200, body: {} }));
  const result = await setProjectEnvironment("my-app", projectEnvironment(TARGET), creds);

  has(result.set === false, "a refusal is reported rather than thrown");
  has(/unaffected/.test(result.note ?? ""), "and says this build is unaffected", result.note);
}

{
  /* Nothing to set is not a failure, and must not spend a request. */
  stubFetch(() => ({ status: 200, body: {} }));
  const result = await setProjectEnvironment("my-app", {}, creds);
  has(result.set === true && calls.length === 0, "a project with no environment makes no call at all");
}

/* ── Server keys: the ones that must never reach a browser ────────────────
 *
 * A server-mode project can hold a real secret. It goes to Vercel and nowhere
 * else — QuickStark stores no copy, encrypted or otherwise — and it is written
 * `encrypted` rather than `plain`, which is the whole difference from the three
 * public values above.
 *
 * The rule worth a check of its own is the NEXT_PUBLIC_ refusal. Next inlines
 * anything with that prefix into the bundle and serves it to every visitor, so
 * accepting one here would mark a Stripe secret key encrypted on Vercel and
 * then publish it on the customer's own website, having told them it was safe.
 * Nothing downstream would catch that: the deployment succeeds. */
{
  has(secretKeyProblem("STRIPE_SECRET_KEY") === null, "an ordinary key name is accepted");
  has(secretKeyProblem("OPENAI_API_KEY") === null, "and another");

  has(
    /published to every visitor/.test(secretKeyProblem("NEXT_PUBLIC_STRIPE_KEY") ?? ""),
    "a NEXT_PUBLIC_ name is refused, and the refusal says why",
    secretKeyProblem("NEXT_PUBLIC_STRIPE_KEY") ?? "accepted",
  );
  has(
    secretKeyProblem("NEXT_PUBLIC_SUPABASE_URL") !== null,
    "the platform's own variables cannot be overwritten by hand",
  );
  has(secretKeyProblem("") !== null, "an empty name is refused");
  has(secretKeyProblem("2FAST") !== null, "and one that could not be an environment variable");
  has(secretKeyProblem("HAS SPACE") !== null, "and one with a space in it");
}

{
  stubFetch(() => ({ status: 200, body: {} }));
  const result = await setProjectSecret("my-app", "STRIPE_SECRET_KEY", "sk_live_x", creds);
  const written = calls.find((c) => c.url.includes("/env") && c.method === "POST");

  has(result.ok === true, "a secret is written to the project");
  has(written && written.body.type === "encrypted", "as encrypted, not as plain", written?.body?.type);
  has(written && written.body.value === "sk_live_x", "carrying the value once");
  has(
    Array.isArray(written?.body?.target)
      && written.body.target.includes("production")
      && written.body.target.includes("preview")
      && !written.body.target.includes("development"),
    "for production and preview, and not for development",
    `${JSON.stringify(written?.body?.target)} — development is \`vercel dev\` on a laptop, which no generated project has`,
  );
  has(
    calls.some((c) => c.method === "POST" && c.url.includes("/v10/projects") && !c.url.includes("/env")),
    "and the project is created first, so a key can be set before the first deploy",
  );
}

{
  /* Refused before the value goes anywhere. The order matters: a bad name must
     not result in a request that carries the secret. */
  stubFetch(() => ({ status: 200, body: {} }));
  const result = await setProjectSecret("my-app", "NEXT_PUBLIC_OOPS", "sk_live_x", creds);
  has(result.ok === false, "a NEXT_PUBLIC_ key is refused by the writer too");
  has(calls.length === 0, "and nothing is sent, so the value never leaves this process", `${calls.length} call(s)`);
}

{
  /* Read back by NAME. Values are not returned by Vercel and are not asked for
     here; a secret readable from the interface that set it is a secret with an
     extra way out. */
  stubFetch(() => ({
    status: 200,
    body: {
      envs: [
        { id: "1", key: "STRIPE_SECRET_KEY", type: "encrypted" },
        { id: "2", key: "NEXT_PUBLIC_SUPABASE_URL", type: "plain" },
        { id: "3", key: "OPENAI_API_KEY", type: "encrypted" },
      ],
    },
  }));
  const names = await projectSecretNames("my-app", creds);

  has(
    names.length === 2 && names[0] === "OPENAI_API_KEY" && names[1] === "STRIPE_SECRET_KEY",
    "the list is the secret names, sorted",
    JSON.stringify(names),
  );
  has(
    !names.includes("NEXT_PUBLIC_SUPABASE_URL"),
    "the published variables are not listed as secrets, because they are not",
  );
}

{
  stubFetch((url, init) =>
    init.method === "DELETE" ? { status: 200, body: {} } : { status: 200, body: { envs: [{ id: "abc", key: "STRIPE_SECRET_KEY", type: "encrypted" }] } },
  );
  const result = await removeProjectSecret("my-app", "STRIPE_SECRET_KEY", creds);
  const deleted = calls.find((c) => c.method === "DELETE");

  has(result.ok === true, "a key can be taken off again");
  has(deleted && deleted.url.includes("/env/abc"), "by the id Vercel gave it", deleted?.url);
}

{
  stubFetch(() => ({ status: 200, body: { envs: [] } }));
  const result = await removeProjectSecret("my-app", "GONE_ALREADY", creds);
  has(result.ok === true && !calls.some((c) => c.method === "DELETE"), "removing one that is not there is not an error");
}

/* ── And none of it reaches the client bundle ─────────────────────────────
 *
 * The other half of "never exposed". `.env.production` is written INTO the
 * upload, so it is part of the project: it ends up in the build, in the
 * download, and in anything a customer opens. Every value in it is therefore
 * published by definition, and the only values that belong there are the three
 * that were already public.
 *
 * A secret is not passed through here and never has been — it goes straight to
 * Vercel — but "it does not happen to today" is not a guarantee, and this is
 * the one file where a mistake would be silent: the deployment succeeds, the
 * site works, and the key is in a text file inside somebody's downloadable
 * project. */
{
  const files = deploymentFiles(
    [{ path: "app/page.tsx", content: "export default function P() { return null; }" }],
    TARGET,
  );
  const env = files.find((f) => f.file === ".env.production");

  has(Boolean(env), "the upload carries .env.production for a project with a backend");

  const names = (env?.data ?? "")
    .split("\n")
    .map((line) => line.split("=")[0].trim())
    .filter((name) => name.length > 0);

  has(names.length === 3, "with three variables in it", names.join(", "));
  has(
    names.every((name) => name.startsWith("NEXT_PUBLIC_")),
    "and every one of them published by name, so nothing secret can be in there",
    names.join(", "),
  );

  const none = deploymentFiles(
    [{ path: "app/page.tsx", content: "export default function P() { return null; }" }],
    { name: "my-app" },
  );
  has(
    !none.some((f) => f.file === ".env.production"),
    "a project with no backend gets no env file at all",
    "a file of somebody else's credentials in a site that never asked for a database",
  );
}

/* ── The customer's own address, bound to the project ────────────────────
 *
 * `<slug>.quickstark.tech` rather than `<slug>.vercel.app`, which is not
 * decoration: the vercel.app address tells every visitor whose hosting this is
 * on a site somebody is about to show a client.
 *
 * WHAT IS PINNED HERE IS THAT IT IS A PROJECT DOMAIN AND NOT A DEPLOYMENT
 * ALIAS, because the two look identical the day they are written and diverge
 * afterwards. An alias points at ONE build, so every publish after it has to
 * re-point the alias or the clean address quietly serves a version from three
 * edits ago — while the vercel.app address moves on. Both addresses work and
 * only one is right, which is the worst shape a bug can have. A domain bound
 * to the PROJECT follows its newest production deployment on its own. */
{
  process.env.QUICKSTARK_APP_DOMAIN = "quickstark.tech";

  has(appDomainFor("acme-store") === "acme-store.quickstark.tech", "a project's domain is its slug under the base");
  has(
    appDomainFor("Acme Store!") === "acme-store.quickstark.tech",
    "and a name with spaces and punctuation still makes a legal host",
    appDomainFor("Acme Store!"),
  );

  delete process.env.QUICKSTARK_APP_DOMAIN;
  has(
    appDomainFor("acme-store") === null,
    "with no base domain configured there is no address to claim",
    "inventing one would point a customer at a host that does not resolve",
  );
  process.env.QUICKSTARK_APP_DOMAIN = "quickstark.tech";
}

{
  stubFetch(() => ({ status: 200, body: { name: "acme.quickstark.tech" } }));
  const bound = await attachProjectDomain("acme", "acme.quickstark.tech", creds);

  has(bound.ok === true, "a domain binds");
  has(bound.already === false, "and says it is new");

  const post = calls.find((c) => c.method === "POST");
  has(
    post && /\/v10\/projects\/acme\/domains/.test(post.url),
    "at POST /v10/projects/{idOrName}/domains — the PROJECT, not a deployment",
    post?.url,
  );
  has(post && post.body.name === "acme.quickstark.tech", "carrying the domain as `name`", JSON.stringify(post?.body));
  has(post && post.url.includes("teamId=team_abc"), "and the team, or it acts on the wrong account");
}

/* ── The second publish, which is every publish after the first ──────────
 *
 * This runs each time a deployment goes live, so it finds the domain already
 * attached and Vercel answers 409. That is not a failure and must never be
 * reported as one — the project's own list is what tells "already ours" apart
 * from "somebody else holds it". */
{
  stubFetch((url, init) =>
    (init.method ?? "GET") === "POST"
      ? { status: 409, body: { error: { code: "domain_already_in_use", message: "in use" } } }
      : { status: 200, body: { domains: [{ name: "acme.quickstark.tech" }] } },
  );

  const again = await attachProjectDomain("acme", "acme.quickstark.tech", creds);
  has(again.ok === true, "A DOMAIN WE ALREADY HOLD IS SUCCESS, NOT A CONFLICT");
  has(again.already === true, "and says so, rather than claiming it just bound it");
  has(
    calls.some((c) => (c.method ?? "GET") === "GET" && /\/domains/.test(c.url)),
    "which it establishes by reading the project's own list",
    "a 409 alone cannot tell our domain from somebody else's",
  );
}

{
  stubFetch((url, init) =>
    (init.method ?? "GET") === "POST"
      ? { status: 409, body: { error: { code: "domain_already_in_use", message: "held elsewhere" } } }
      : { status: 200, body: { domains: [{ name: "something-else.quickstark.tech" }] } },
  );

  const taken = await attachProjectDomain("acme", "acme.quickstark.tech", creds);
  has(taken.ok === false, "but a domain held by somebody ELSE is a real refusal");
  has(
    typeof taken.reason === "string" && taken.reason.length > 0,
    "with a reason, so an operator can act on it",
    JSON.stringify(taken),
  );
}

{
  stubFetch(() => ({ status: 403, body: { error: { message: "not authorised" } } }));
  const refused = await attachProjectDomain("acme", "acme.quickstark.tech", creds);
  has(refused.ok === false, "a token without the scope is a refusal rather than a throw");

  stubFetch(() => ({ status: 500, body: {} }));
  has(
    (await projectDomains("acme", creds)).length === 0,
    "and a list that cannot be read is empty rather than an exception",
    "nothing here may take down a publish that already succeeded",
  );
}

/* ── And the publish path actually calls it ──────────────────────────────── */
{
  const { readFileSync } = await import("node:fs");
  const settle = readFileSync(join(root, "src/lib/publish/settle.ts"), "utf8");

  has(/attachProjectDomain\(/.test(settle), "the settle path binds the domain when a deployment goes live");
  has(
    /await reachable\(`https:\/\/\$\{domain\}`\)/.test(settle),
    "and CONFIRMS IT ANSWERS before storing it as the address",
    "a bind that has not propagated would put a dead URL in front of somebody who just published",
  );
  has(
    /const settled = own \? \{ \.\.\.state, url: own \} : state/.test(settle),
    "storing the vercel.app address when it does not, which works",
  );

  const preview = readFileSync(join(root, "src/app/preview/[projectId]/route.ts"), "utf8");
  /* Built from the project's SLUG, not from the Vercel project name. The two
     differ — `luxury-bakery` against `luxury-bakery-038f1129` — so deriving it
     from the Vercel name had the preview looking up a hostname the publish
     path never binds: the check always failed and the pane fell through to the
     vercel.app address every time. */
  has(
    /appDomainFor\(slug\)/.test(preview),
    "and a server-mode preview points its frame at the published domain first",
  );
  has(
    /canBeFramed\(address, SITE_URL\)/.test(preview),
    "after asking whether it can be framed, never on the assumption that it can",
  );
}

console.log(failed === 0 ? "\nAll Vercel protection checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
