/* Making a generated project a running site.
 *
 * A build that produces a Next.js project produces `.tsx`, and `.tsx` is not
 * something a browser can be shown. Until this file there was nowhere in the
 * system that could turn it into HTML: the preview fell back to a written
 * summary (see builder/project-summary.ts, which argues correctly that a
 * mock-up would be worse), and publishing could only ever serve the single
 * `html` column. So a customer who asked for an app got a receipt for one.
 *
 * The missing step is a build, and the cheapest correct place to do a Next.js
 * build is Vercel, which already does exactly this and is already a dependency
 * of this deployment for custom domains. The files go up, Vercel installs,
 * builds and hosts them, and the deployment URL is the preview — not a picture
 * of the app, the app.
 *
 * ── The environment goes in the FILES, not in the API call ────────────────
 *
 * A generated project needs three values to reach its database:
 * NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
 * NEXT_PUBLIC_SUPABASE_SCHEMA. All three are NEXT_PUBLIC_, which means Next
 * inlines them at BUILD time and ships them to every visitor — they are public
 * by construction, and the generated README says so.
 *
 * They are therefore written into the uploaded tree as `.env.production`
 * rather than passed as deployment environment variables. Partly because the
 * build needs them at build time and a file is unambiguous about that; mostly
 * because `files` is the mechanism this was written against and verified, and
 * an integration that depends on a field nobody checked is an integration that
 * fails in production for a reason nobody can see.
 *
 * NOTHING SECRET MAY BE ADDED TO THAT FILE. It is compiled into the site. A
 * service-role key or a Postgres URL written here would be handed to every
 * visitor of every generated app, which is why writeEnvFile below takes a
 * fixed set of three keys rather than a record.
 *
 * ── Failure is ordinary ───────────────────────────────────────────────────
 *
 * Every path returns a reason rather than throwing. No token configured, a
 * refused request, a build that fails to compile: all of them leave the caller
 * free to fall back to the summary, which is a worse preview but an honest one.
 * A deployment that could not happen must never take the build down with it —
 * the files are still worth having and the customer still paid for them.
 */

import type { FileTree } from "@/lib/builder/tree";
import { splitClientRoutes } from "@/lib/builder/client-routes";
import { NEXT_VERSION } from "@/lib/builder/scaffold";

const API = "https://api.vercel.com";

/* One request. Generous next to the domain client's ten seconds because this
   one carries the whole project in its body. */
const REQUEST_TIMEOUT_MS = 30_000;

/* How long to wait for Vercel to install and compile. A small Next.js project
   is usually well inside a minute; past three the answer the customer needs is
   "it is still building", not a spinner that never resolves. */
const BUILD_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;

/* Vercel derives the deployment's hostname from this, so it has to survive
   being put in one: lowercase, alphanumeric and dashes, no leading or trailing
   dash, and short enough to leave room for the suffixes Vercel appends. */
const MAX_NAME_LENGTH = 52;

export type DeployTarget = {
  /** Names the Vercel project. One per generated project, stable across builds. */
  name: string;
  /* THE GENERATED APP'S OWN BACKEND, and never this platform's.
   *
   * These three were read straight off `process.env` at both call sites, which
   * is the bug that made "connect your own Supabase" a lie: the schema came
   * from the project's resolved backend and the URL and key came from
   * QuickStark's, so a customer who linked their own database was deployed
   * pointing at OURS, with schema `public`, querying the platform's own
   * tables with the platform's anon key.
   *
   * They are supplied by the caller now, from envFor(resolveBackend(...)) —
   * see src/lib/builder/backend/connection.ts, which is the one place that
   * knows whether a project is on the shared instance or its owner's.
   *
   * Absent means the project HAS NO BACKEND, which is the ordinary case for
   * every frontend-only build. No .env.production is written at all then,
   * rather than one carrying credentials the app has no client to use and no
   * business holding. */
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** The generated app's own Postgres schema. */
  supabaseSchema?: string;
};

export type DeployOutcome =
  | { ok: true; url: string; deploymentId: string }
  /* `reason` is written to be shown to the person who asked for the build, so
     it says what failed and what it means for them rather than echoing a
     status code. */
  | { ok: false; reason: string };

function credentials(): { token: string; teamQuery: string } | null {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) return null;

  /* VERCEL_PROJECT_ID is deliberately NOT read here. That variable names the
     Vercel project this platform is deployed as; a generated app is its own
     project, created by name on first deploy. Reusing the platform's id would
     deploy a customer's app over this one. */
  const teamId = process.env.VERCEL_TEAM_ID;
  return { token, teamQuery: teamId ? `?teamId=${encodeURIComponent(teamId)}` : "" };
}

/** Whether generated projects can be deployed at all in this deployment. */
export function deploymentsConfigured(): boolean {
  return credentials() !== null;
}

/**
 * The same credentials, for the callers outside this module that need them.
 *
 * Exported rather than each caller reading the environment for itself: the team
 * query is the part that is easy to get wrong, and a call made without it acts
 * on the personal account rather than the team — which is a different Vercel
 * entirely and would silently do nothing to the project in hand.
 */
export function vercelCredentials(): { token: string; teamQuery: string } | null {
  return credentials();
}

/**
 * A Vercel project name derived from whatever the customer called their
 * project. Never throws and never returns empty: a name that cannot be
 * salvaged becomes its fallback, because refusing to deploy over a project
 * title is not a trade anybody would choose.
 */
export function deploymentName(projectName: string, projectId: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_LENGTH);

  /* The project id's first segment, so two projects with the same title are
     still two sites. */
  const suffix = projectId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  const base = slug || "app";
  return `${base}-${suffix}`.slice(0, MAX_NAME_LENGTH).replace(/-+$/g, "");
}

/**
 * The tree as Vercel wants it, plus the environment the build needs.
 *
 * Exported for its own sake: the payload is the part of this worth testing
 * without a network, and a caller that wants to see what would be uploaded
 * should not have to attempt a deployment to find out.
 */
/* The framework version the platform stands behind, forced on the way out.
 *
 * A tree carries whatever package.json it was generated with, and a build from
 * last month pins whatever was current last month. When that version is later
 * deprecated for a CVE, every one of those trees becomes undeployable —
 * Vercel refuses the deployment outright, AFTER a clean compile, with
 * "Vulnerable version of Next.js detected". That is what happened here: the
 * stored tree pinned 15.5.4, the scaffold had already been patched to 15.5.25,
 * and the only way out looked like regenerating the project and paying for it
 * again.
 *
 * It is not a fair thing to charge somebody for. The framework version is
 * infrastructure this platform chooses — the same argument that makes
 * lib/supabase.ts and next.config.mjs PLATFORM_OWNED in scaffold.ts — so the
 * deployment carries the current pin whatever the tree says.
 *
 * Only `next`, and only in dependencies. Everything else the model or the
 * scaffold put in that manifest is left exactly as it is, because a deploy
 * quietly rewriting somebody's dependency list is its own kind of bug.
 *
 * Unparseable JSON is left alone rather than repaired. A malformed
 * package.json fails the build loudly, which is the right failure; a deploy
 * step that silently rewrites one hides a real problem. */
function withCurrentFramework(file: { file: string; data: string; encoding: "utf-8" }) {
  if (file.file !== "package.json") return file;

  try {
    const manifest = JSON.parse(file.data) as { dependencies?: Record<string, string> };
    if (!manifest.dependencies?.next || manifest.dependencies.next === NEXT_VERSION) return file;

    manifest.dependencies.next = NEXT_VERSION;
    return { ...file, data: `${JSON.stringify(manifest, null, 2)}\n` };
  } catch {
    return file;
  }
}

/**
 * The three values a generated app needs to reach its database.
 *
 * One definition, because they now go to Vercel twice: written into the upload
 * as `.env.production`, which is what the BUILD reads, and set on the Vercel
 * project itself, which is what every LATER deployment reads. Two copies of
 * this list is two chances for them to disagree.
 *
 * Null when the project has no backend. The generated tree then has no
 * lib/supabase.ts either — scaffold.ts writes one only when the manifest says
 * database — so there is nothing to configure, and writing a file full of
 * somebody else's credentials to satisfy a template would be handing them to
 * every visitor of a site that never asked for a database.
 */
export function projectEnvironment(target: DeployTarget): Record<string, string> | null {
  if (!target.supabaseUrl || !target.supabaseAnonKey || !target.supabaseSchema) return null;
  return {
    NEXT_PUBLIC_SUPABASE_URL: target.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: target.supabaseAnonKey,
    NEXT_PUBLIC_SUPABASE_SCHEMA: target.supabaseSchema,
  };
}

export function deploymentFiles(tree: FileTree, target: DeployTarget) {
  /* Written rather than appended to whatever the generator emitted: a
     generated .env.production would be the model's guess at these values, and
     the project's resolved backend is the correct one. Last writer wins below.

     Null when this project has no backend. The generated tree then has no
     lib/supabase.ts either — scaffold.ts writes one only when the manifest
     says database — so there is nothing to configure, and writing a file full
     of somebody else's credentials to satisfy a template would be handing them
     to every visitor of a site that never asked for a database. */
  const variables = projectEnvironment(target);
  const env = variables
    ? `${Object.entries(variables).map(([key, value]) => `${key}=${value}`).join("\n")}\n`
    : null;

  /* Repaired on the way out, for the same reason the framework pin is: every
     project ever generated is still sitting in the database, and a tree stored
     before completeTree learned to split these would otherwise need generating
     a second time — and charging for a second time — to become deployable.
     Applied at BOTH ends deliberately: completeTree fixes what gets stored, so
     the download compiles too, and this fixes what already was. It finds
     nothing to do on a tree that has been through the other one. */
  const files = splitClientRoutes(tree)
    .filter((file) => file.path !== ".env.production" && file.path !== ".env.local")
    .map((file) => ({ file: file.path, data: file.content, encoding: "utf-8" as const }));

  if (env) files.push({ file: ".env.production", data: env, encoding: "utf-8" as const });
  return files.map(withCurrentFramework);
}

type Called = { ok: true; status: number; body: unknown } | { ok: false; reason: string };

async function call(path: string, init: RequestInit, token: string): Promise<Called> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return { ok: true, status: response.status, body };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, reason: aborted ? "Vercel did not answer in time" : "could not reach Vercel" };
  } finally {
    clearTimeout(timer);
  }
}

/* Vercel puts the reason a request was refused in the body. A status on its
   own tells the customer nothing they can act on. */
function refusal(body: unknown, status: number): string {
  const message =
    body && typeof body === "object" && "error" in body
      ? (body as { error?: { message?: string } }).error?.message
      : undefined;
  return message ? `Vercel refused the deployment: ${message}` : `Vercel answered ${status}`;
}

function readDeployment(
  body: unknown,
): { id: string; url: string; state: string; inspect: string | null; aliases: string[] } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as {
    id?: unknown;
    url?: unknown;
    readyState?: unknown;
    status?: unknown;
    inspectorUrl?: unknown;
    alias?: unknown;
    automaticAliases?: unknown;
  };
  if (typeof record.id !== "string" || typeof record.url !== "string") return null;
  /* readyState is the documented field; status appears alongside it on some
     responses. Either is enough to know whether to keep waiting. */
  const state =
    typeof record.readyState === "string"
      ? record.readyState
      : typeof record.status === "string"
        ? record.status
        : "QUEUED";
  /* Vercel's own page for this deployment, with the full build log on it.
     Carried through so a failure can point at it: whatever this module puts in
     a card is a tail, and the tail is not always where the reason is. */
  /* Every name this deployment answers to, as opposed to the one it was born
     with. See stableHost. */
  const aliases = [record.alias, record.automaticAliases]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  return {
    id: record.id,
    url: record.url,
    state,
    inspect: typeof record.inspectorUrl === "string" ? record.inspectorUrl : null,
    aliases,
  };
}

/* ── The address to give somebody ──────────────────────────────────────────
 *
 * Vercel hands back two different kinds of hostname and they are not
 * interchangeable:
 *
 *   nova-estates-038f1129-6dj1ceo99-neuralis-systems-ai.vercel.app
 *     The DEPLOYMENT url. Immutable, unique to this one build, and different
 *     after the next one. It is the right thing to link from a build log and
 *     the wrong thing to call somebody's app.
 *
 *   nova-estates-038f1129.vercel.app
 *     The PRODUCTION alias. Stable across deployments, which is the entire
 *     property that makes an address worth giving to anybody.
 *
 * This returned the first one and called it live. Somebody who bookmarked it,
 * or sent it to a colleague, had a link that silently stopped being their
 * latest app the moment they changed anything.
 *
 * A custom domain wins outright when one is attached, because that is what
 * somebody actually wants people to see. Otherwise the shortest .vercel.app
 * name, which is the production alias by construction: the deployment url is
 * the same project name plus a build hash plus the team slug, so it is always
 * longer than the alias it sits under.
 */
export function stableHost(
  aliases: string[],
  deploymentHost: string,
  /* The Vercel PROJECT name, when the caller knows it. See productionDomain:
     this is what makes an answer possible before Vercel has reported an alias,
     which is every deployment at the moment it is created. */
  projectName?: string,
): string {
  const custom = aliases
    .filter((host) => !host.endsWith(".vercel.app"))
    .sort((a, b) => a.length - b.length)[0];
  if (custom) return custom;

  const vercel = aliases
    .filter((host) => host.endsWith(".vercel.app"))
    .sort((a, b) => a.length - b.length)[0];
  if (vercel) return vercel;

  /* ── Derived, rather than waited for ─────────────────────────────────────
   *
   * The reason this exists: at the moment a deployment is CREATED, Vercel's
   * response often carries no aliases at all. Falling back to the deployment
   * host there hands back the per-build address — project name, build hash,
   * team slug — and on a team account that one is behind Deployment
   * Protection. It answers 401 to everybody who is not signed in to the team,
   * which is every customer, and inside an iframe that is a blank white
   * rectangle. "Deployment links only really open on Vercel. Only domain links
   * open in any browser" is exactly right, and it is the whole of this bug.
   *
   * The production domain is not a guess. Vercel gives a project the domain
   * `<project>.vercel.app` and points it at that project's newest production
   * deployment; these are all created with target: "production". So the name
   * we chose for the project IS the address, and it is knowable before the
   * build finishes, before any alias is reported, and without a second API
   * call. */
  if (projectName) return productionDomain(projectName);

  return deploymentHost;
}

/**
 * The domain a Vercel project answers on, from its name.
 *
 * `<project>.vercel.app` — the production alias Vercel assigns every project
 * and re-points at each new production deployment. Stable across builds, which
 * is what makes it the address worth giving somebody: the per-deployment host
 * changes every time and is protected besides.
 */
export function productionDomain(projectName: string): string {
  return `${projectName}.vercel.app`;
}

/**
 * The address to show a customer, whatever is stored on the row.
 *
 * stableHost already chooses correctly at the moment a deployment is created,
 * and every address written from now on is the production alias. This is for
 * everything already in the database, and for any path that has not been found
 * yet — because the cost of one leaking through is not cosmetic.
 *
 * A per-deployment host (`<project>-<hash>-<team>.vercel.app`) on a team
 * account sits behind Deployment Protection. Signed in, it opens; signed out,
 * and for every subresource fetched without the team's cookie, it does not —
 * which is how a customer comes to be looking at their own site with every
 * stylesheet missing, fully rendered and completely unstyled, while the same
 * project on its production alias is perfect. Two addresses for one build, and
 * the workspace was handing out the wrong one.
 *
 * So the address is DERIVED rather than read. The Vercel project name is
 * recorded when the project is first deployed (see existingVercelProject) and
 * `<project>.vercel.app` is the alias Vercel points at its newest production
 * deployment — knowable without an API call and correct for every build.
 *
 * A custom domain still wins: if what is stored is not a vercel.app at all,
 * somebody has attached their own domain and that is the address they want
 * people to see. And with no project name to derive from, whatever is stored is
 * better than nothing.
 */
export function publicAddress(
  stored: string | null | undefined,
  vercelProject: string | null | undefined,
): string | null {
  const held = typeof stored === "string" && stored.length > 0 ? stored : null;

  if (held) {
    let host: string;
    try {
      host = new URL(held).hostname;
    } catch {
      return held;
    }
    /* Their own domain. Nothing here improves on that. */
    if (!host.endsWith(".vercel.app")) return held;
  }

  if (vercelProject) return `https://${productionDomain(vercelProject)}`;
  return held;
}

/* ── Deployment Protection, turned off on the way in ──────────────────────
 *
 * A Vercel TEAM account protects new projects by default: every deployment
 * answers 401 to anybody not signed in to the team. That is a sensible default
 * for a team's own staging and exactly wrong for this platform, where the whole
 * point of a deployment is that a customer — and their customers — can open it.
 *
 * Left on, it produces the failure that has been reported twice: the document
 * loads for whoever is signed in and the stylesheets it then asks for do not,
 * so the page renders completely unstyled; and in an iframe it is a blank white
 * rectangle. Neither says what is wrong, because a 401 on a subresource is
 * silent.
 *
 * TWO CALLS, DELIBERATELY. The project is created explicitly rather than being
 * conjured by the first deployment, so the protection fields can be set at
 * birth — there is no window in which a protected project exists. The PATCH
 * after it is the safety net for the project that already existed, which is
 * every project after its first build, and for the case where Vercel applies a
 * team default over what was asked for.
 *
 * Neither is allowed to fail the deployment. A token without project-write
 * scope, a team policy that forbids it, a Vercel that is having a bad minute:
 * all of those should still get the customer their build. The cost of not
 * clearing protection is a site they have to unprotect by hand, which is worth
 * strictly more than no site at all. */
export type ProtectionResult = {
  /** Whether protection is known to be off. False includes "could not tell". */
  cleared: boolean;
  /** What happened, for the build's diagnostics. Null when it simply worked. */
  note: string | null;
};

/* The two fields that gate a deployment. Null is Vercel's "off" — an absent key
   means "leave as it is", which is not the same thing and is what makes this an
   explicit null rather than a missing property. */
const UNPROTECTED = { ssoProtection: null, passwords: null } as const;

/* The prefix Next.js inlines into the bundle. The single fact everything about
   secrets on this platform turns on. */
const PUBLISHED = /^NEXT_PUBLIC_/;

/* Where a secret is readable, and nowhere else.
 *
 * `development` is left off deliberately: it exists for `vercel dev` on
 * somebody's laptop, which is not a thing that happens to a generated project,
 * and a secret present in a place nothing uses is a place it can leak from for
 * no benefit. The three published values keep all three targets — they are not
 * secret and a preview deployment without them cannot reach its database. */
const SECRET_TARGETS = ["production", "preview"] as const;

/* Vercel's shape for one variable, from a plain key/value map.
 *
 * `plain` rather than `encrypted`, and that is a statement about these values
 * rather than a shortcut. Every one of them is NEXT_PUBLIC_, which Next inlines
 * into the bundle at build time and serves to every visitor of the site.
 * Marking as secret a value we publish in the next breath would be a lie told
 * to whoever opens the Vercel dashboard looking for the real ones.
 *
 * All three targets, because a preview deployment of somebody's app is as
 * useless without a database as a production one. */
function environmentPayload(environment: Record<string, string>) {
  return Object.entries(environment)
    .filter(([key, value]) => key.length > 0 && typeof value === "string" && value.length > 0)
    .map(([key, value]) => ({
      key,
      value,
      /* Decided from the NAME, so this door cannot publish a secret however it
         is called. NEXT_PUBLIC_ is plain because it is inlined into the bundle
         and served to visitors — marking it secret would mislead whoever reads
         the Vercel dashboard looking for the real ones. Anything else is
         encrypted, because anything else might be a key, and the failure of
         guessing wrong is asymmetric: a plain value that should have been
         encrypted is a leak, and an encrypted one that need not have been
         costs nothing at all. */
      type: PUBLISHED.test(key) ? ("plain" as const) : ("encrypted" as const),
      target: ["production", "preview", "development"] as const,
    }));
}

/**
 * Sets the project's environment variables on Vercel itself.
 *
 * ── Why, when the upload already carries `.env.production` ────────────────
 *
 * Because a file only exists in the deployment that carried it, and the
 * variables are a fact about the PROJECT. A customer's store proved the
 * difference: its database credentials were wiped by a failed re-provision, the
 * next deploy therefore resolved no backend, wrote no env file, and the build
 * died — on the /_not-found page, for want of two strings that had been correct
 * an hour earlier and were still correct in the database they came from.
 *
 * Set here they persist. Any later deployment — from this platform, from a
 * redeploy button in Vercel's own dashboard, from a rollback — is built with
 * them whether or not whatever started it could look them up. The file stays as
 * well: it is what makes a DOWNLOADED project runnable, and it is the copy the
 * build is guaranteed to see even if this call is refused.
 *
 * Upserted, so this is the same call on the first deploy and the hundredth.
 * Never fatal, for the same reason as clearProtection above: an app that
 * deploys with an environment we could not update is worth more than no app.
 */
export async function setProjectEnvironment(
  name: string,
  environment: Record<string, string>,
  creds: { token: string; teamQuery: string },
): Promise<{ set: boolean; note: string | null }> {
  const payload = environmentPayload(environment);
  if (payload.length === 0) return { set: true, note: null };

  const query = creds.teamQuery ? `${creds.teamQuery}&upsert=true` : "?upsert=true";
  const written = await call(
    `/v10/projects/${encodeURIComponent(name)}/env${query}`,
    { method: "POST", body: JSON.stringify(payload) },
    creds.token,
  );

  if (written.ok && written.status < 400) return { set: true, note: null };

  const why = written.ok ? refusal(written.body, written.status) : written.reason;
  return {
    set: false,
    note:
      `The project's environment variables could not be set on Vercel (${why}). ` +
      "This build carries them in its own .env.production and is unaffected; a " +
      "deployment started from Vercel's dashboard rather than from here may not have them.",
  };
}

/* ── Keys that must never reach a browser ─────────────────────────────────
 *
 * A server-mode project can hold a real secret — a Stripe secret key, an
 * OpenAI key, a webhook signing secret. Those go to Vercel and nowhere else.
 *
 * QUICKSTARK DOES NOT STORE THEM. Not encrypted, not hashed, not at all: the
 * value is taken from the person, sent to Vercel, and dropped. Vercel encrypts
 * it at rest and decrypts it into the build and the running function, which is
 * exactly the job — and a copy held here would be a second place to breach for
 * no benefit, in a database whose whole purpose is holding other things.
 *
 * What is read back is the LIST OF NAMES, from Vercel, because Vercel is the
 * only thing that knows. That also means the list is true: it says what is
 * really set on the project rather than what we remember setting.
 */

/** Why this key cannot be used as a secret, or null when it can. */
export function secretKeyProblem(key: string): string | null {
  const name = key.trim();

  if (name.length === 0) return "Give the key a name.";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return "An environment variable's name can only be letters, numbers and underscores, and cannot start with a number.";
  }
  if (name.length > 256) return "That name is too long for an environment variable.";

  /* The one that matters. NEXT_PUBLIC_ is not a namespace for secrets, it is
     the opposite: Next inlines anything with that prefix into the JavaScript
     bundle and serves it to every visitor. Accepting one here would take a
     Stripe secret key, mark it encrypted on Vercel, and then publish it on the
     customer's own website — with this platform having told them it was
     safe. */
  if (/^NEXT_PUBLIC_/.test(name)) {
    return "A name starting with NEXT_PUBLIC_ is published to every visitor's browser, so it cannot hold a secret. Use a name without that prefix.";
  }

  /* Managed by this platform. Letting somebody overwrite them by hand is how a
     project ends up pointed at a database that is not its own. */
  if (["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_SCHEMA"].includes(name)) {
    return "That variable is set for you from the project's own database and cannot be overwritten here.";
  }

  return null;
}

export type SecretResult = { ok: true } | { ok: false; reason: string };

/**
 * Puts one secret on the Vercel project, creating the project if it is new.
 *
 * Encrypted rather than plain, which is the whole difference from the three
 * public values beside it: Vercel stores it encrypted, never shows it again,
 * and hands it only to the build and the running function.
 *
 * The project is ensured first, so a key can be set before the first
 * deployment — which is the ordinary case, because somebody adds their Stripe
 * key and then publishes.
 */
export async function setProjectSecret(
  name: string,
  key: string,
  value: string,
  creds: { token: string; teamQuery: string },
): Promise<SecretResult> {
  const problem = secretKeyProblem(key);
  if (problem) return { ok: false, reason: problem };
  if (value.trim().length === 0) return { ok: false, reason: "Paste the value for that key." };

  await clearProtection(name, creds);

  const query = creds.teamQuery ? `${creds.teamQuery}&upsert=true` : "?upsert=true";
  const written = await call(
    `/v10/projects/${encodeURIComponent(name)}/env${query}`,
    {
      method: "POST",
      body: JSON.stringify({
        key: key.trim(),
        value,
        type: "encrypted",
        target: SECRET_TARGETS,
      }),
    },
    creds.token,
  );

  if (!written.ok) return { ok: false, reason: written.reason };
  if (written.status >= 400) return { ok: false, reason: refusal(written.body, written.status) };
  return { ok: true };
}

/** What is set on this project, by name. Values are never returned — see above. */
export async function projectSecretNames(
  name: string,
  creds: { token: string; teamQuery: string },
): Promise<string[]> {
  const read = await call(
    `/v9/projects/${encodeURIComponent(name)}/env${creds.teamQuery}`,
    {},
    creds.token,
  );

  if (!read.ok || read.status >= 400) return [];

  const body = read.body as { envs?: { key?: unknown; type?: unknown }[] } | null;
  return (body?.envs ?? [])
    .filter((entry) => entry.type === "encrypted" || entry.type === "sensitive")
    .map((entry) => (typeof entry.key === "string" ? entry.key : ""))
    .filter((key) => key.length > 0 && secretKeyProblem(key) === null)
    .sort();
}

/** Takes one off the project. Removing what is not there is not an error. */
export async function removeProjectSecret(
  name: string,
  key: string,
  creds: { token: string; teamQuery: string },
): Promise<SecretResult> {
  const read = await call(
    `/v9/projects/${encodeURIComponent(name)}/env${creds.teamQuery}`,
    {},
    creds.token,
  );

  if (!read.ok) return { ok: false, reason: read.reason };
  if (read.status >= 400) return { ok: false, reason: refusal(read.body, read.status) };

  const body = read.body as { envs?: { id?: unknown; key?: unknown }[] } | null;
  const found = (body?.envs ?? []).find((entry) => entry.key === key);
  if (!found || typeof found.id !== "string") return { ok: true };

  const removed = await call(
    `/v9/projects/${encodeURIComponent(name)}/env/${encodeURIComponent(found.id)}${creds.teamQuery}`,
    { method: "DELETE" },
    creds.token,
  );

  if (!removed.ok) return { ok: false, reason: removed.reason };
  if (removed.status >= 400) return { ok: false, reason: refusal(removed.body, removed.status) };
  return { ok: true };
}

export async function clearProtection(
  name: string,
  creds: { token: string; teamQuery: string },
  /* Set on the project at the moment it is CREATED, so the very first
     deployment of a new project has them before anything else runs. The upsert
     above covers every project that already existed. Optional because the
     callers that only want protection cleared should not have to say so. */
  environment: Record<string, string> = {},
): Promise<ProtectionResult> {
  /* Created with protection already off. A 409 means it was there already,
     which is the ordinary case for every build after the first and is not a
     failure of anything. */
  /* Result deliberately unread on the happy path: a 409 (already exists) and a
     201 (just created) are both fine, and the PATCH below is what actually
     decides. It is awaited rather than fired and forgotten so that a project
     created here exists before the deployment that names it. */
  await call(
    `/v10/projects${creds.teamQuery}`,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        framework: "nextjs",
        ...UNPROTECTED,
        ...(environmentPayload(environment).length > 0
          ? { environmentVariables: environmentPayload(environment) }
          : {}),
      }),
    },
    creds.token,
  );

  /* And cleared again on the project that already existed. Runs whatever the
     create said, including when it said 409: that is precisely the path where
     the create changed nothing. */
  const patched = await call(
    `/v9/projects/${encodeURIComponent(name)}${creds.teamQuery}`,
    { method: "PATCH", body: JSON.stringify(UNPROTECTED) },
    creds.token,
  );

  if (patched.ok && patched.status < 400) return { cleared: true, note: null };

  const why = patched.ok ? refusal(patched.body, patched.status) : patched.reason;
  return {
    cleared: false,
    note:
      `Deployment Protection could not be turned off automatically (${why}). ` +
      "The site will build, but Vercel may ask visitors to sign in before they can see it — " +
      "turn it off under the project's Settings → Deployment Protection.",
  };
}

/* ── A clean address of our own ───────────────────────────────────────────
 *
 * `<slug>.preview.quickstark.tech` rather than `<project>.vercel.app`: one
 * domain this platform controls, which can be pointed anywhere later and reads
 * as part of the product rather than as somebody else's hosting.
 *
 * REQUIRES the wildcard to exist. `*.preview.quickstark.tech` has to be a
 * verified domain on the Vercel account and its DNS has to point at Vercel, or
 * the alias call is refused — so this is best effort and says so, and the
 * vercel.app alias goes on working either way. Nothing downstream depends on it
 * landing. */
export function previewDomainBase(): string | null {
  const configured = process.env.QUICKSTARK_PREVIEW_DOMAIN?.trim();
  return configured && configured.length > 0 ? configured.replace(/^\.+|\.+$/g, "") : null;
}

/** `<slug>.preview.quickstark.tech`, or null when no base domain is configured. */
export function previewAliasFor(projectName: string): string | null {
  const base = previewDomainBase();
  if (!base) return null;
  const slug = projectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `${slug}.${base}` : null;
}

export type AliasResult = { ok: true; alias: string } | { ok: false; reason: string };

/**
 * Points an alias at a deployment that has finished building.
 *
 * Only ever called once a deployment is READY, because an alias on a build that
 * has not compiled points the customer's clean address at a failure.
 */
export async function aliasDeployment(
  deploymentId: string,
  alias: string,
  creds: { token: string; teamQuery: string },
): Promise<AliasResult> {
  const assigned = await call(
    `/v2/deployments/${encodeURIComponent(deploymentId)}/aliases${creds.teamQuery}`,
    { method: "POST", body: JSON.stringify({ alias }) },
    creds.token,
  );

  if (!assigned.ok) return { ok: false, reason: assigned.reason };
  if (assigned.status >= 400) return { ok: false, reason: refusal(assigned.body, assigned.status) };
  return { ok: true, alias };
}

export type Started =
  | {
      ok: true;
      deploymentId: string;
      url: string;
      inspect: string | null;
      /* Set only when Deployment Protection could not be turned off, which is
         the difference between a site anybody can open and one Vercel asks
         visitors to sign in to. Carried rather than logged, because the person
         who needs to read it is the customer whose site it is. */
      protectionNote?: string | null;
    }
  | { ok: false; reason: string };

/**
 * Uploads a generated project and returns as soon as Vercel has accepted it.
 *
 * THE HALF THAT DOES NOT WAIT, and the reason it exists is arithmetic. A
 * Next.js install-and-compile takes one to three minutes; `deployProject`
 * below polls for up to 180 seconds; and both call sites run in a serverless
 * function that this account's plan stops at 60. So any project slow enough to
 * be interesting was created, built and hosted correctly, and then lost its
 * address — because the function holding the poll was killed and nothing had
 * written the deployment id down.
 *
 * Vercel gives the id and the hostname in the response to the upload itself,
 * before a line of the build has run. Both are recorded here, and something
 * that is not on the end of an HTTP request finds out how it went. See
 * deploymentState below and /api/cron/deployments.
 */
export async function startDeployment(tree: FileTree, target: DeployTarget): Promise<Started> {
  const creds = credentials();
  if (!creds) {
    return { ok: false, reason: "this deployment has no VERCEL_API_TOKEN, so it cannot build projects" };
  }
  if (tree.length === 0) return { ok: false, reason: "there are no files to deploy" };

  /* Before the upload, so there is no window in which a protected project
     exists, and so a project created here is created carrying the environment
     its build is about to need. Never fatal — see clearProtection and
     setProjectEnvironment. */
  const variables = projectEnvironment(target) ?? {};
  const protection = await clearProtection(target.name, creds, variables);

  /* And on the project that already existed, which the create above left
     untouched. Best effort: the upload below carries .env.production either
     way, so a refusal here costs later deployments rather than this one. */
  const environment = await setProjectEnvironment(target.name, variables, creds);
  if (!environment.set && environment.note) {
    // eslint-disable-next-line no-console
    console.warn(`deploy: ${target.name} — ${environment.note}`);
  }

  const created = await call(
    `/v13/deployments${creds.teamQuery}`,
    {
      method: "POST",
      body: JSON.stringify({
        name: target.name,
        files: deploymentFiles(tree, target),
        projectSettings: {
          framework: "nextjs",
          buildCommand: null,
          installCommand: null,
          outputDirectory: null,
          devCommand: null,
        },
        target: "production",
      }),
    },
    creds.token,
  );

  if (!created.ok) return { ok: false, reason: created.reason };
  if (created.status >= 400) return { ok: false, reason: refusal(created.body, created.status) };

  const deployment = readDeployment(created.body);
  if (!deployment) {
    return { ok: false, reason: "Vercel accepted the upload but did not say where it went" };
  }

  /* ── The address a stranger can open ─────────────────────────────────────
   *
   * `deployment.url` is the host this BUILD was born with — the project name,
   * a build hash and the team slug. On a Vercel team account that host is
   * behind Deployment Protection by default: it answers 401 to anyone who is
   * not signed in to the team, which in an iframe is a blank white rectangle
   * and nothing else. The customer is told "your app is live", given a link,
   * and shown an empty box.
   *
   * The production alias — the same name without the hash — is not protected,
   * and it is assigned when the deployment is CREATED, not when it finishes
   * building, because this is created with target: "production". readDeployment
   * has been reading those aliases all along and this returned the raw host
   * anyway, so the one address that works was parsed and dropped on the floor.
   *
   * stableHost is the same choice the polling path already makes (see
   * deploymentState): a custom domain if there is one, else the shortest
   * .vercel.app name, which is the alias by construction. Falling back to the
   * deployment host when Vercel sends no aliases keeps this no worse than it
   * was. */
  return {
    ok: true,
    deploymentId: deployment.id,
    protectionNote: protection.cleared ? null : protection.note,
    url: `https://${stableHost(deployment.aliases, deployment.url, target.name)}`,
    inspect: deployment.inspect,
  };
}

export type DeploymentState =
  | { state: "queued" }
  | { state: "ready"; url: string }
  | { state: "error" | "cancelled"; reason: string }
  /* Vercel could not be reached. Distinct from "error" on purpose: a
     deployment whose STATUS could not be read has not failed, and marking it
     failed would take down a site that is very likely live. The caller leaves
     it pending and asks again. */
  | { state: "unknown"; reason: string };

/**
 * How a deployment is getting on, asked from anywhere and at any time.
 *
 * The other half of the split. Takes an id rather than a closure over a
 * request, so the thing that started a deployment and the thing that finds out
 * how it went do not have to be the same process — which is the whole point,
 * because on this platform the first one is usually gone.
 */
export async function deploymentState(
  id: string,
  /* The Vercel project this deployment belongs to, when the caller has it.
     Lets the address resolve to the project's own domain rather than to the
     per-build host on a deployment Vercel reports no aliases for — see
     stableHost. */
  projectName?: string,
): Promise<DeploymentState> {
  const creds = credentials();
  if (!creds) return { state: "unknown", reason: "no VERCEL_API_TOKEN" };

  const polled = await call(
    `/v13/deployments/${encodeURIComponent(id)}${creds.teamQuery}`,
    {},
    creds.token,
  );

  if (!polled.ok) return { state: "unknown", reason: polled.reason };
  if (polled.status >= 400) return { state: "unknown", reason: refusal(polled.body, polled.status) };

  const deployment = readDeployment(polled.body);
  if (!deployment) return { state: "unknown", reason: "Vercel answered with no deployment in it" };

  if (deployment.state === "READY") {
    /* The stable alias, not the hostname this one build was born with. The
       split flow arrived alongside stableHost and reached READY by its own
       route, so it had its own copy of the same mistake: `deployment.url`
       carries a build hash and stops being the customer's app after the next
       deploy. See stableHost. */
    const address = `https://${stableHost(deployment.aliases, deployment.url, projectName)}`;

    /* And built is still not reachable. A deployment behind Vercel's
       Deployment Protection is READY, correct, and answers every stranger
       with a sign-in wall — which is the white rectangle in the preview pane.
       Checked here as well as in waitForBuild because on this platform this
       is the path that usually gets there: the function that started the
       deployment is long gone and the cron is what finds it finished. */
    const reached = await reachable(address);
    if (!reached.ok) {
      return { state: "error", reason: `${reached.reason}\n\nThe build itself succeeded: ${address}` };
    }

    return { state: "ready", url: address };
  }

  if (deployment.state === "ERROR" || deployment.state === "CANCELED") {
    const log = await settledLog(id, creds);
    const what =
      deployment.state === "CANCELED"
        ? "the deployment was cancelled"
        : "Vercel could not finish the deployment";
    const tail = log ? `${what}:\n${log}` : `${what} — its build reported ${deployment.state}`;
    return {
      state: deployment.state === "CANCELED" ? "cancelled" : "error",
      reason: deployment.inspect ? `${tail}\n\nFull build log: ${deployment.inspect}` : tail,
    };
  }

  return { state: "queued" };
}

/**
 * Uploads a generated project and waits for Vercel to build it.
 *
 * Resolves with the deployment's URL once it is READY, or with a reason. Never
 * throws: see the note at the top of the file about why a failed deployment
 * must not be able to fail the build it came from.
 *
 * KEPT FOR CALLERS THAT GENUINELY WAIT — the CLI, a test, anything with no
 * sixty-second ceiling over it. Everything on a request path should use
 * startDeployment and let the worker do the waiting.
 */
export async function deployProject(tree: FileTree, target: DeployTarget): Promise<DeployOutcome> {
  const creds = credentials();
  if (!creds) {
    return { ok: false, reason: "this deployment has no VERCEL_API_TOKEN, so it cannot build projects" };
  }
  if (tree.length === 0) {
    return { ok: false, reason: "there are no files to deploy" };
  }

  const created = await call(
    `/v13/deployments${creds.teamQuery}`,
    {
      method: "POST",
      body: JSON.stringify({
        name: target.name,
        files: deploymentFiles(tree, target),
        /* framework: "nextjs" is what tells Vercel to run `next build` and to
           host the result rather than serving the source as static files.
           The nulls are Vercel's own defaults for the framework and are sent
           explicitly so a project setting left over from an earlier deploy of
           the same name cannot override them. */
        projectSettings: {
          framework: "nextjs",
          buildCommand: null,
          installCommand: null,
          outputDirectory: null,
          devCommand: null,
        },
        target: "production",
      }),
    },
    creds.token,
  );

  if (!created.ok) return { ok: false, reason: created.reason };
  if (created.status >= 400) return { ok: false, reason: refusal(created.body, created.status) };

  const deployment = readDeployment(created.body);
  if (!deployment) return { ok: false, reason: "Vercel accepted the upload but did not say where it went" };

  const ready = await waitForBuild(deployment.id, deployment.url, creds, target.name);
  return ready;
}


/* What the build actually said.
 *
 * "The project did not compile" is true and nearly useless. The thing that
 * would fix the project is the compiler's own line — the file, the line
 * number, the type that did not match — and Vercel has it, on the deployment's
 * event stream, for the asking.
 *
 * So a failed build is asked. The alternative was a person opening the Vercel
 * dashboard, finding a project named after their app among the others, opening
 * the failed deployment and scrolling its log; that is a reasonable thing to
 * ask of the engineer who built this platform and not of somebody who typed a
 * sentence into it.
 *
 * Best effort. This runs after a failure and must not become a second one, so
 * anything unexpected leaves the plain reason standing.
 *
 * Capped, because the destination is a column in a table and a card in a
 * preview rather than a log viewer — but raised from 12 lines and 1200
 * characters, which was tuned for a filtered log and is too tight for an
 * unfiltered one. A `next build` that fails prints the failing file, the line,
 * the code around it and then a summary, and twelve lines lands in the middle
 * of that. Thirty reaches the start of it. */
const LOG_LINES = 30;
const LOG_CHARS = 3000;

async function buildLog(
  id: string,
  creds: { token: string; teamQuery: string },
): Promise<string | null> {
  const joiner = creds.teamQuery ? "&" : "?";
  const events = await call(
    `/v2/deployments/${encodeURIComponent(id)}/events${creds.teamQuery}${joiner}builds=1&limit=200`,
    {},
    creds.token,
  );

  if (!events.ok || events.status >= 400 || !Array.isArray(events.body)) return null;

  /* ── The tail of the log, not a search through it ────────────────────────
   *
   * This used to keep only lines that were stderr or matched
   * /error|failed|cannot|expected|Type '/ — the theory being that a failed
   * `next build` puts its diagnosis in one of those and the rest is install
   * chatter.
   *
   * What that actually produced, on a real failed deployment, was this, in
   * full, as the entire explanation given to the customer:
   *
   *     Vercel could not finish the deployment:
   *     Vercel CLI 59.11.7
   *
   * Fifty-eight characters. The CLI banner goes to stderr, so it matched; the
   * build output that said what went wrong went to stdout and did not contain
   * any of those five words, so every line of it was discarded. The deployment
   * failed for a reason that was sitting right there and got filtered out on
   * the way to the one person who needed it.
   *
   * A filter that decides in advance which words a failure will use is a
   * filter that hides the failures nobody predicted — and those are exactly
   * the ones worth reading. The last lines of a build that stopped are what
   * anybody would look at, so that is what this returns: all of them, in
   * order, tail-first-out. Noisier by design. Noise can be read; a discarded
   * diagnosis cannot. */
  const lines: string[] = [];
  for (const entry of events.body as { type?: unknown; payload?: unknown }[]) {
    const payload = entry?.payload as { text?: unknown } | undefined;
    const text = typeof payload?.text === "string" ? payload.text.trimEnd() : "";
    /* Blank lines are dropped, and nothing else is. A build log is mostly
       vertical whitespace and it is the one thing that costs a line of the
       tail without ever carrying a reason. */
    if (text.trim()) lines.push(text);
  }

  if (lines.length === 0) return null;
  return lines.slice(-LOG_LINES).join("\n").slice(-LOG_CHARS);
}

/* ── Asking again, because the last lines arrive last ──────────────────────
 *
 * The deployment's state flips to ERROR before its final log events are
 * readable, and reading them immediately gets the log as it was a moment
 * before it failed. On a real failure that produced this, ending mid-sentence
 * exactly where the reason was about to be:
 *
 *     ✓ Compiled successfully in 11.3s
 *     Linting and checking validity of types ...
 *
 * The compile had succeeded, the type check had not, and the line naming the
 * file and the error had not been written yet. Everything the customer needed
 * was in the two lines after the last one we fetched.
 *
 * So it is fetched again, twice, a second apart, and the longest answer wins.
 * Longer is the right test rather than newer: these events only ever accrue,
 * so the fullest log is the latest one, and a request that comes back short
 * because it raced is never mistaken for the truth.
 *
 * Two seconds in the worst case, spent only on builds that already failed.
 * That is a cheap price for the difference between a diagnosis and a
 * cliffhanger. */
const LOG_SETTLE_TRIES = 3;
const LOG_SETTLE_MS = 1_000;

async function settledLog(
  id: string,
  creds: { token: string; teamQuery: string },
): Promise<string | null> {
  let best: string | null = null;

  for (let attempt = 0; attempt < LOG_SETTLE_TRIES; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, LOG_SETTLE_MS));

    const log = await buildLog(id, creds);
    if (log && (!best || log.length > best.length)) best = log;
  }

  return best;
}

/* Whether a person with no Vercel account can actually open this.
 *
 * Deliberately NOT using `call` above: that one attaches the API token, and a
 * request carrying a token proves only that WE can reach the site. The whole
 * question here is what a stranger gets, so this goes out bare.
 *
 * Generous about what counts as working. A 404 on `/` would be odd but a 404
 * anywhere else is a normal thing for a site to say, and a redirect is how
 * half the internet answers. What is being looked for is the small set of
 * answers that mean nobody can see the app at all. */
const HEALTH_TIMEOUT_MS = 15_000;

async function reachable(address: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(address, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "QuickStark-deploy-check" },
    });

    /* The one that matters, and the one that was being reported as success.
       Vercel answers a protected deployment with 401, or 403 once it has
       decided who you are not. */
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        reason:
          "The app built and deployed, but Vercel is not letting the public see it — " +
          "the address answers with a sign-in wall rather than the site. This is " +
          "Deployment Protection, which is on by default on some Vercel accounts. " +
          "Turn it off for this project (Vercel → the project → Settings → Deployment " +
          "Protection) and the same deployment becomes public with nothing to rebuild.",
      };
    }

    if (response.status >= 500) {
      return {
        ok: false,
        reason:
          `The app deployed but answers ${response.status} when it is opened, so the ` +
          "build succeeded and the running site is failing. The deployment's own logs " +
          "on Vercel say why.",
      };
    }

    return { ok: true };
  } catch (error) {
    /* A network failure here is about OUR ability to reach it, which is not
       quite the customer's question — so it is reported as what it is rather
       than as the app being broken. */
    return {
      ok: false,
      reason:
        "The app deployed, but this server could not open it to check that it " +
        `works (${error instanceof Error ? error.message : "the request failed"}). ` +
        "It may well be fine — try the address yourself.",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForBuild(
  id: string,
  url: string,
  creds: { token: string; teamQuery: string },
  /* The project's own name, so the address resolves to its domain rather than
     to this build's protected host. See stableHost. */
  projectName?: string,
): Promise<DeployOutcome> {
  const deadline = Date.now() + BUILD_TIMEOUT_MS;

  for (;;) {
    const polled = await call(`/v13/deployments/${encodeURIComponent(id)}${creds.teamQuery}`, {}, creds.token);

    if (polled.ok && polled.status < 400) {
      const state = readDeployment(polled.body)?.state ?? "QUEUED";

      if (state === "READY") {
        /* The name it will still answer to after the next deploy, not the one
           this build was born with. See stableHost. */
        const host = stableHost(readDeployment(polled.body)?.aliases ?? [], url, projectName);
        const address = `https://${host}`;

        /* ── Built is not the same as reachable ───────────────────────────
         *
         * READY means Vercel finished building. It does not mean anybody can
         * open the thing, and the difference is what produced a preview pane
         * showing a large white rectangle under the words "your app is live".
         *
         * The commonest cause is Deployment Protection, which is ON by default
         * for some accounts: the build is perfect, the URL is correct, and
         * every request that is not carrying a Vercel session gets a login
         * page or a 401. Saying "live" over that is telling somebody their app
         * works when what they will see is a wall.
         *
         * So it is fetched, once, before the word "live" is used anywhere. */
        const reached = await reachable(address);
        if (!reached.ok) {
          return { ok: false, reason: `${reached.reason}\n\nThe build itself succeeded: ${address}` };
        }

        return { ok: true, url: address, deploymentId: id };
      }

      if (state === "ERROR" || state === "CANCELED") {
        /* NOT necessarily a compile failure, and this used to say it was.
         *
         * The first real deployment reported ERROR with a log that ended
         * "Build Completed in /vercel/output [39s]" — the compile had
         * succeeded and the message blamed the generated code anyway. A
         * deployment can be refused after a clean build: the last line before
         * that one was Vercel's own "Vulnerable version of Next.js detected".
         *
         * So the state is reported as what it is — Vercel would not finish the
         * deployment — and the log says why. Guessing at a cause and being
         * wrong sent an hour looking for a type error that was never there. */
        const log = await settledLog(id, creds);
        const what = state === "CANCELED" ? "the deployment was cancelled" : "Vercel could not finish the deployment";
        /* The whole log lives on Vercel's own page for this deployment. What
           is quoted below is the tail of it, and a tail is not always where
           the reason is — so the address goes with it rather than leaving
           somebody to find a failed deployment by its name. */
        const where = readDeployment(polled.body)?.inspect;
        const tail = log ? `${what}:\n${log}` : `${what} — its build reported ${state}`;
        return { ok: false, reason: where ? `${tail}\n\nFull build log: ${where}` : tail };
      }
    }

    if (Date.now() >= deadline) {
      /* Still building is not the same as broken, and the URL is real whether
         or not this call waited long enough to see it finish. */
      return { ok: false, reason: "the build is taking longer than expected and is still running" };
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
