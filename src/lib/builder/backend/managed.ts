/* A Supabase project per generated app.
 *
 * This is Option 1 — "QuickStark Managed" — built as the architecture asks for
 * it rather than as the shared instance pretended to be it. Customer A gets
 * Supabase Project A; Customer B gets Supabase Project B; neither can see the
 * other's auth.users, and neither is in QuickStark's production database.
 *
 * ── Why the shared instance could never be this ───────────────────────────
 *
 * It is worth restating, because "a schema per project" looks like isolation
 * and is not:
 *
 *   auth.users is one table per Supabase PROJECT. Every app on the shared
 *   instance draws accounts from one pool. Their rows are separated by policy;
 *   their identities are not separated at all.
 *
 *   PostgREST serves only the schemas on its exposed list, and that list cannot
 *   be written ahead of time because the name contains a project id that does
 *   not exist yet. The tables get created and the app cannot read them —
 *   PGRST106, on every query.
 *
 *   And the data sits in somebody else's account, so exporting it, backing it
 *   up or leaving are things the owner cannot do.
 *
 * A project of its own fixes all three at once, and it costs a real amount of
 * money per project, which is why it is gated rather than automatic.
 *
 * ── Configuration, and what happens without it ────────────────────────────
 *
 *   SUPABASE_MANAGEMENT_TOKEN   a personal access token from the Supabase
 *                               dashboard. Server-only, and the strongest
 *                               credential in the system after SUPABASE_DB_URL
 *                               — it can create and DELETE projects.
 *   SUPABASE_ORG_ID             which organisation to create them in, and
 *                               therefore which billing account pays.
 *   SUPABASE_MANAGED_REGION     optional; defaults to eu-west-2.
 *
 * With none of it set, `configured()` is false and modeFor falls back to the
 * shared preview instance — which is a DEGRADATION and is described as one
 * rather than being passed off as the same thing. Nothing here throws for a
 * missing variable: a deployment that cannot provision is an ordinary state.
 *
 * ── Untested against the live API ─────────────────────────────────────────
 *
 * Written from Supabase's Management API documentation and exercised only
 * against tools/check-managed.mjs, which stubs fetch. No project has been
 * created by this code, because doing so needs a token, an organisation and a
 * billing decision that are not this repository's to make. The shapes are
 * asserted; the behaviour is not. Treat the first real run as a test.
 */

import { SITE_URL } from "@/lib/site";
import { AUTH_REDIRECT_GLOB } from "@/lib/publish/naming";

const API = "https://api.supabase.com";

/* Creating a project is a slow call — Supabase provisions a Postgres instance
   behind it — and this is the one place a generous timeout is correct, because
   giving up does not cancel anything. A project created after we stopped
   waiting is a project we are paying for and cannot find. */
const CREATE_TIMEOUT_MS = 60_000;
const POLL_TIMEOUT_MS = 15_000;

export type ManagedProject = {
  /** Supabase's project ref — the `<ref>` in `<ref>.supabase.co`. */
  ref: string;
  url: string;
  anonKey: string;
  /** Where the migration is applied. Always `public` on a project of its own. */
  schema: "public";
};

export type Provisioned =
  | { ok: true; project: ManagedProject }
  /* Every failure is a reason rather than an exception, for the same reason
     deployment failures are: a build whose database could not be provisioned is
     still a build worth having, and the reason belongs in front of the person
     rather than in a stack trace. */
  | { ok: false; reason: string };

function credentials(): { token: string; org: string; region: string } | null {
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN;
  const org = process.env.SUPABASE_ORG_ID;
  if (!token || !org) return null;
  return { token, org, region: process.env.SUPABASE_MANAGED_REGION || "eu-west-2" };
}

/** Whether this deployment can give a project a database of its own. */
export function configured(): boolean {
  return credentials() !== null;
}

/**
 * Why it cannot, for an operator reading /api/health.
 *
 * Named exactly. "Managed backends are unavailable" sends somebody to support
 * for a missing environment variable they could set in a minute.
 */
export function unconfiguredReason(): string | null {
  if (configured()) return null;
  const missing = [
    process.env.SUPABASE_MANAGEMENT_TOKEN ? null : "SUPABASE_MANAGEMENT_TOKEN",
    process.env.SUPABASE_ORG_ID ? null : "SUPABASE_ORG_ID",
  ].filter(Boolean);
  return `managed backends need ${missing.join(" and ")}`;
}

async function call(
  path: string,
  init: RequestInit,
  token: string,
  timeoutMs: number,
): Promise<{ ok: true; status: number; body: unknown } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    return {
      ok: false,
      reason: aborted ? "Supabase did not answer in time" : "could not reach Supabase",
    };
  } finally {
    clearTimeout(timer);
  }
}

/* Supabase puts the reason a request was refused in the body, and a status on
   its own tells an operator nothing they can act on — an org over its project
   limit and an expired token both arrive as 4xx. */
function refusal(body: unknown, status: number): string {
  const message =
    body && typeof body === "object" && "message" in body
      ? String((body as { message?: unknown }).message ?? "")
      : "";
  return message ? `Supabase refused it: ${message}` : `Supabase answered ${status}`;
}

/**
 * A project name Supabase will accept, derived from what the customer called
 * theirs.
 *
 * Prefixed, because these projects appear in an organisation dashboard beside
 * whatever else is in it and "shop" tells nobody where it came from. The
 * project id's first segment is carried so two customers who both called theirs
 * "Store" are still two distinguishable projects.
 */
export function managedName(projectName: string, projectId: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const suffix = projectId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  return `qs-${slug || "app"}-${suffix}`;
}

/**
 * A database password nothing has to remember.
 *
 * Supabase requires one at creation and this code never uses it again: the
 * migration goes over the connection string the API returns, and the generated
 * app uses the anon key. So it is made, sent and forgotten deliberately —
 * storing it would be keeping a credential with no reader, which is a liability
 * rather than a feature. An owner who needs it resets it in the dashboard,
 * which is the only place that can prove who they are.
 */
function databasePassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Creates a Supabase project for one generated app.
 *
 * Never throws. A failure here leaves the build to carry on without a database
 * and to say so — the same degradation every other part of provisioning
 * already has, and the same reasoning: a project whose schema is pending is
 * worth previewing, and a build that dies because a database could not be made
 * is not.
 */
export async function provisionProject(input: {
  projectName: string;
  projectId: string;
}): Promise<Provisioned> {
  const creds = credentials();
  if (!creds) {
    return { ok: false, reason: unconfiguredReason() ?? "managed backends are not configured" };
  }

  const created = await call(
    "/v1/projects",
    {
      method: "POST",
      body: JSON.stringify({
        name: managedName(input.projectName, input.projectId),
        organization_id: creds.org,
        region: creds.region,
        db_pass: databasePassword(),
      }),
    },
    creds.token,
    CREATE_TIMEOUT_MS,
  );

  if (!created.ok) return { ok: false, reason: created.reason };
  if (created.status >= 400) return { ok: false, reason: refusal(created.body, created.status) };

  const ref =
    created.body && typeof created.body === "object" && "id" in created.body
      ? String((created.body as { id?: unknown }).id ?? "")
      : "";

  if (!ref) {
    /* The dangerous case, and the one worth naming. Supabase may well have
       created a project; we simply cannot address it. Saying so plainly is the
       difference between an operator finding an orphan in the dashboard and
       wondering where it came from. */
    return {
      ok: false,
      reason:
        "Supabase accepted the request but did not return a project ref. " +
        "A project may have been created — check the organisation dashboard before retrying.",
    };
  }

  const keys = await anonKeyFor(ref, creds.token);
  if (!keys.ok) return keys;

  return {
    ok: true,
    project: {
      ref,
      url: `https://${ref}.supabase.co`,
      anonKey: keys.anonKey,
      /* `public`, always, and this is the point of the whole module. A project
         of its own has nothing to share a schema namespace with, so the tables
         go where PostgREST already serves them — which is what the shared
         instance could never arrange. */
      schema: "public",
    },
  };
}

/** The publishable key for a project, which is what the generated app is built with. */
async function anonKeyFor(
  ref: string,
  token: string,
): Promise<{ ok: true; anonKey: string } | { ok: false; reason: string }> {
  const keys = await call(`/v1/projects/${encodeURIComponent(ref)}/api-keys`, {}, token, POLL_TIMEOUT_MS);

  if (!keys.ok) return { ok: false, reason: keys.reason };
  if (keys.status >= 400) return { ok: false, reason: refusal(keys.body, keys.status) };

  const list = Array.isArray(keys.body) ? (keys.body as { name?: unknown; api_key?: unknown }[]) : [];
  const anon = list.find((entry) => entry.name === "anon" || entry.name === "publishable");
  const value = typeof anon?.api_key === "string" ? anon.api_key : "";

  if (!value) {
    return {
      ok: false,
      reason:
        "The project was created but its anon key could not be read. It is usually available a " +
        "moment later — the project exists and can be retried rather than recreated.",
    };
  }
  return { ok: true, anonKey: value };
}

/**
 * Whether a managed project has finished starting up.
 *
 * A project is returned before its Postgres is accepting connections, so a
 * migration run immediately after creation fails for a reason that has nothing
 * to do with the migration. The build does not wait on this — it carries on and
 * reports the schema as pending, which is already how every provisioning
 * failure behaves — but the worker can ask again.
 */
export async function projectReady(ref: string): Promise<boolean> {
  const creds = credentials();
  if (!creds) return false;

  const got = await call(`/v1/projects/${encodeURIComponent(ref)}`, {}, creds.token, POLL_TIMEOUT_MS);
  if (!got.ok || got.status >= 400) return false;

  const status =
    got.body && typeof got.body === "object" && "status" in got.body
      ? String((got.body as { status?: unknown }).status ?? "")
      : "";

  return status === "ACTIVE_HEALTHY";
}

/**
 * The connection string for applying a migration to a managed project.
 *
 * Server-only and never stored: it is fetched when a migration needs to run and
 * dropped afterwards. The same rule as project_backends.db_url, which is
 * write-only at the column level — a credential with no reader is a liability,
 * and this one can be asked for again whenever it is genuinely needed.
 */
export async function connectionStringFor(ref: string): Promise<string | null> {
  const creds = credentials();
  if (!creds) return null;

  const got = await call(
    `/v1/projects/${encodeURIComponent(ref)}/config/database/pooler`,
    {},
    creds.token,
    POLL_TIMEOUT_MS,
  );
  if (!got.ok || got.status >= 400) return null;

  /* The SESSION pooler, not the direct connection. The direct host resolves to
     IPv6 only and a Vercel function has no IPv6 egress, so it never opens at
     all — see docs/BACKEND.md, where this cost a deployment's worth of silent
     "schema pending" before anybody worked out why. */
  const entries = Array.isArray(got.body)
    ? (got.body as { database_type?: unknown; connection_string?: unknown }[])
    : [];
  const session = entries.find((entry) => entry.database_type === "PRIMARY");
  return typeof session?.connection_string === "string" ? session.connection_string : null;
}

/* ── Auth, which nothing configured until now ─────────────────────────────
 *
 * A provisioned project had its database, its schema, its policies and its
 * pooler set up, and its AUTH left on Supabase's defaults. Those defaults are
 * `site_url: http://localhost:3000`, an empty redirect allow-list and email
 * confirmation on — which is right for somebody running Supabase locally and
 * wrong for every project this platform creates.
 *
 * What that produced is the failure worth describing, because it does not look
 * like an auth failure. The database works: queries with the anon key answer,
 * tables read, the app is plainly wired. Sign-up even appears to succeed. Then
 * Supabase sends a confirmation email whose link points at localhost, the
 * account is never confirmed, and sign-in fails for good. The app was fine and
 * the project it was pointed at had never been told where it lived.
 *
 * MANAGED ONLY, and that is a hard limit rather than an omission. This works
 * because these projects are in our organisation and SUPABASE_MANAGEMENT_TOKEN
 * authorises them. For a customer's own Supabase we hold a URL and an anon
 * key — which authorise nothing — so their auth cannot be configured from
 * here at all, and the honest thing is to tell them the two values to paste.
 * See describeOwnAuthSetup in connection.ts.
 */

/* A wildcard rather than one project's address, so this is set ONCE at
   provision and covers every address the project will ever answer on: its
   published subdomain, a rebuild under a different slug, and the preview.
   Waiting for the exact address would mean a second Management API call at
   deploy time, at the one moment a build is already slow, and a project whose
   auth silently lagged a rename. */
function allowList(): string {
  return [
    AUTH_REDIRECT_GLOB,
    `${SITE_URL}/**`,
    /* The downloaded project, run locally. The generated README tells people to
       do exactly this, and it is the one address Supabase's own default got
       right. */
    "http://localhost:3000/**",
  ].join(",");
}

/**
 * Points a managed project's auth at where the app actually lives.
 *
 * Never throws and never blocks a build: a project with unconfigured auth is
 * worse than one with configured auth, and both are better than a build that
 * failed. The reason comes back for the caller to log.
 *
 * `siteUrl` is where a confirmation or recovery link lands when Supabase has no
 * better idea — the project's own published address once it has a slug. The
 * allow-list is what actually permits a redirect, and it is wildcarded, so a
 * project that is renamed or published later needs nothing done to it.
 */
export async function configureAuth(
  ref: string,
  siteUrl?: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const creds = credentials();
  if (!creds) return { ok: false, reason: unconfiguredReason() ?? "managed backends are not configured" };

  const got = await call(
    `/v1/projects/${encodeURIComponent(ref)}/config/auth`,
    {
      method: "PATCH",
      body: JSON.stringify({
        /* Straight in on sign-up. A generated app is shown to people within
           minutes of being built, and a confirmation email is a dependency on
           Supabase's shared mailer — rate-limited, and on a fresh project it
           lands in spam more often than not. The cost is that an address is
           unverified, which is the right trade for an app at this stage and
           the wrong one for a bank. */
        mailer_autoconfirm: true,
        ...(siteUrl ? { site_url: siteUrl } : {}),
        uri_allow_list: allowList(),
      }),
    },
    creds.token,
    POLL_TIMEOUT_MS,
  );

  if (!got.ok) return { ok: false, reason: got.reason };
  if (got.status >= 400) {
    return { ok: false, reason: `Supabase refused the auth settings (${got.status})` };
  }
  return { ok: true };
}
