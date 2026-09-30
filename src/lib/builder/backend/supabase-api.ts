/* Supabase's Management API, on somebody's behalf.
 *
 * managed.ts speaks this API with OUR token, for projects in our organisation.
 * This speaks it with THEIRS — the access token a person grants when they press
 * Connect Supabase (see supabase-oauth.ts) — for projects in their account.
 * The API is the same one; whose account it acts on is the whole difference,
 * which is why the two are kept apart and nothing here reads an environment
 * variable.
 *
 * What it can do that a URL and an anon key never could, and the reason the
 * sign-in exists at all:
 *
 *   read the project's keys        so nobody copies a key out of a dashboard
 *   run SQL                        so the tables are created without anybody
 *                                  handing over a database password
 *   read and set exposed schemas   so an app can live in a schema of its own
 *                                  when `public` already has their tables
 *   read and set auth settings     so sign-in works on the deployed app
 *                                  without two settings pasted by hand
 *
 * Never throws. Every call answers ok or a reason written for the person whose
 * database it is.
 */

const API = "https://api.supabase.com";
const TIMEOUT_MS = 20_000;
/* Creating a project provisions a Postgres instance behind the call. */
const CREATE_TIMEOUT_MS = 60_000;

export type ApiResult<T> = { ok: true; value: T } | { ok: false; status: number | null; reason: string };

async function call(
  token: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<{ ok: true; status: number; body: unknown } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* Left as text: a refusal that is not JSON is still worth quoting. */
    }
    return { ok: true, status: response.status, body };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, reason: aborted ? "Supabase did not answer in time" : "could not reach Supabase" };
  } finally {
    clearTimeout(timer);
  }
}

function refusal(body: unknown, status: number): string {
  const message =
    body && typeof body === "object" && "message" in body
      ? String((body as { message?: unknown }).message ?? "")
      : typeof body === "string"
        ? body.slice(0, 300)
        : "";
  if (status === 401) return "Supabase no longer accepts QuickStark's access — connect Supabase again.";
  if (status === 403) {
    return `Supabase refused that for this account${message ? `: ${message}` : ""}. The project may belong to an organisation QuickStark was not given access to.`;
  }
  return message ? `Supabase answered ${status}: ${message}` : `Supabase answered ${status}`;
}

async function request<T>(
  token: string,
  path: string,
  read: (body: unknown) => T | null,
  init?: RequestInit,
  timeoutMs?: number,
): Promise<ApiResult<T>> {
  const got = await call(token, path, init, timeoutMs);
  if (!got.ok) return { ok: false, status: null, reason: got.reason };
  if (got.status >= 400) return { ok: false, status: got.status, reason: refusal(got.body, got.status) };
  const value = read(got.body);
  if (value === null) return { ok: false, status: got.status, reason: "Supabase answered in a shape QuickStark did not expect" };
  return { ok: true, value };
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value.filter((entry) => entry && typeof entry === "object") as Record<string, unknown>[]) : [];

/* ── Organisations and projects ─────────────────────────────────────────── */

export type Organization = { id: string; slug: string; name: string };

export type SupabaseProject = {
  ref: string;
  name: string;
  organizationId: string;
  region: string;
  /** ACTIVE_HEALTHY, COMING_UP, INACTIVE (paused), … */
  status: string;
};

export function listOrganizations(token: string): Promise<ApiResult<Organization[]>> {
  return request(token, "/v1/organizations", (body) =>
    list(body).map((org) => ({ id: text(org.id), slug: text(org.slug) || text(org.id), name: text(org.name) })),
  );
}

function toProject(entry: Record<string, unknown>): SupabaseProject {
  return {
    ref: text(entry.ref) || text(entry.id),
    name: text(entry.name),
    organizationId: text(entry.organization_slug) || text(entry.organization_id),
    region: text(entry.region),
    status: text(entry.status),
  };
}

export function listProjects(token: string): Promise<ApiResult<SupabaseProject[]>> {
  return request(token, "/v1/projects", (body) => list(body).map(toProject).filter((project) => project.ref));
}

export function getProject(token: string, ref: string): Promise<ApiResult<SupabaseProject>> {
  return request(token, `/v1/projects/${encodeURIComponent(ref)}`, (body) =>
    body && typeof body === "object" ? toProject(body as Record<string, unknown>) : null,
  );
}

/** A strong database password nobody needs to know: every later step goes through this API. */
function databasePassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function createProject(
  token: string,
  input: { name: string; organizationId: string; region: string },
): Promise<ApiResult<SupabaseProject>> {
  return request(
    token,
    "/v1/projects",
    (body) => (body && typeof body === "object" ? toProject(body as Record<string, unknown>) : null),
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name.slice(0, 64),
        organization_id: input.organizationId,
        region: input.region,
        db_pass: databasePassword(),
      }),
    },
    CREATE_TIMEOUT_MS,
  );
}

/**
 * The key a generated app is built with — the one that is public by design.
 *
 * The new `sb_publishable_…` key where the project has one, else the legacy
 * anon JWT. Never a secret or service_role key: this value is compiled into a
 * static bundle and served to every visitor.
 */
export function publicKey(token: string, ref: string): Promise<ApiResult<string>> {
  return request(token, `/v1/projects/${encodeURIComponent(ref)}/api-keys?reveal=true`, (body) => {
    const keys = list(body);
    const publishable = keys.find((key) => text(key.type) === "publishable" && text(key.api_key).startsWith("sb_publishable_"));
    const anon = keys.find((key) => text(key.name) === "anon" && text(key.api_key));
    const value = text(publishable?.api_key) || text(anon?.api_key);
    return value || null;
  });
}

/* ── SQL ─────────────────────────────────────────────────────────────────── */

/**
 * Runs SQL against the project's database and returns the rows.
 *
 * The statement runs as the database owner, like the SQL editor in their
 * dashboard. Everything sent through here is written by this platform and
 * read before it is sent — see provision.ts, which refuses destructive SQL.
 */
export function runQuery(token: string, ref: string, sql: string): Promise<ApiResult<unknown[]>> {
  return request(
    token,
    `/v1/projects/${encodeURIComponent(ref)}/database/query`,
    (body) => (Array.isArray(body) ? body : body === null ? [] : null),
    { method: "POST", body: JSON.stringify({ query: sql }) },
    60_000,
  );
}

/* ── The API's exposed schemas ──────────────────────────────────────────── */

/** Which schemas PostgREST serves, as Supabase stores them: "public, graphql_public". */
export function exposedSchemas(token: string, ref: string): Promise<ApiResult<string[]>> {
  return request(token, `/v1/projects/${encodeURIComponent(ref)}/postgrest`, (body) => {
    if (!body || typeof body !== "object") return null;
    return text((body as { db_schema?: unknown }).db_schema)
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
  });
}

/**
 * Adds a schema to what the API serves, keeping every schema already there.
 *
 * Read, add, write — never a replacement list, because removing one of theirs
 * would break their other apps. A no-op when it is already exposed.
 */
export async function exposeSchema(token: string, ref: string, schema: string): Promise<ApiResult<string[]>> {
  const current = await exposedSchemas(token, ref);
  if (!current.ok) return current;
  if (current.value.includes(schema)) return current;

  const next = [...current.value, schema];
  return request(
    token,
    `/v1/projects/${encodeURIComponent(ref)}/postgrest`,
    (body) =>
      body && typeof body === "object"
        ? text((body as { db_schema?: unknown }).db_schema)
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean)
        : next,
    { method: "PATCH", body: JSON.stringify({ db_schema: next.join(", ") }) },
  );
}

/* ── Auth settings ───────────────────────────────────────────────────────── */

/**
 * Lets sign-in work on the app's published addresses, without disturbing theirs.
 *
 * Their Supabase may already serve another app, so nothing is replaced: the
 * redirect allow-list gains the entries it lacks and keeps every one it had;
 * the site URL is set only when it is still Supabase's localhost default or
 * empty; and email confirmation is left exactly as they have it — turning it
 * off is a security decision about their users, not ours to make.
 */
export async function allowRedirects(
  token: string,
  ref: string,
  input: { redirects: string[]; siteUrl?: string | null },
): Promise<ApiResult<{ added: string[]; siteUrlSet: boolean }>> {
  const path = `/v1/projects/${encodeURIComponent(ref)}/config/auth`;
  const current = await request(token, path, (body) =>
    body && typeof body === "object" ? (body as Record<string, unknown>) : null,
  );
  if (!current.ok) return current;

  const existing = text(current.value.uri_allow_list)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const added = input.redirects.filter((entry) => !existing.includes(entry));

  const site = text(current.value.site_url);
  const siteIsDefault = !site || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(site);
  const siteUrlSet = Boolean(input.siteUrl && siteIsDefault);

  if (added.length === 0 && !siteUrlSet) return { ok: true, value: { added, siteUrlSet } };

  const patched = await request(
    token,
    path,
    () => true,
    {
      method: "PATCH",
      body: JSON.stringify({
        uri_allow_list: [...existing, ...added].join(","),
        ...(siteUrlSet ? { site_url: input.siteUrl } : {}),
      }),
    },
  );
  if (!patched.ok) return patched;
  return { ok: true, value: { added, siteUrlSet } };
}
