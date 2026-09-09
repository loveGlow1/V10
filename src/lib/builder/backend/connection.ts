/* Which Supabase a generated project talks to.
 *
 * Two answers, and the difference between them is whose account the data is in.
 *
 *   SHARED — the default, and what a project gets by saying nothing. The data
 *   lives on QuickStark's own Supabase instance, in a schema named for the
 *   project (see schemaNameFor). Nothing to sign up for, nothing to paste, and
 *   the build can create the tables itself, so a store is a working store the
 *   first time it is previewed.
 *
 *   OWN — the project points at a Supabase the person owns. Their instance,
 *   their tables, their auth users, their bill, their data. The generated app
 *   is identical; only the URL and the key it is built with change.
 *
 * ── Why "own" has to exist ────────────────────────────────────────────────
 *
 * The shared instance is a convenience with a real ceiling, and it is honest
 * about where the ceiling is:
 *
 *   auth.users is one table per Supabase project, not one per schema. So every
 *   app on the shared instance draws its accounts from the same pool. They
 *   cannot read each other's rows — a policy in app_a never matches a row in
 *   app_b, and the role that makes somebody an admin is written in the app's
 *   own profiles table rather than on the auth user — but the identities are
 *   not separate, and somebody running a real business with real customers
 *   should not be sharing an identity pool with strangers.
 *
 *   The data is in somebody else's account. That is fine for a preview and
 *   wrong for a company's orders. Exporting it, backing it up, pointing another
 *   tool at it, or leaving QuickStark entirely are all things an owner is
 *   entitled to do, and none of them work if the database is not theirs.
 *
 * So linking your own is not an upgrade tier, it is the exit. A project can be
 * built on the shared instance, looked at, and then pointed at the owner's
 * Supabase with the same schema applied to it.
 *
 * ── What is stored, and what is deliberately not ──────────────────────────
 *
 * The URL and the anon key are stored in the clear, because they are public by
 * design: they are compiled into the generated app's JavaScript and served to
 * every visitor. Treating them as secrets would be theatre.
 *
 * The connection string is a real secret — it is the database, without RLS in
 * front of it — and it is write-only at the column level, the same way
 * mcp_connections.api_key is. It can be set and replaced by its owner and read
 * back by nobody, including them. It exists for one purpose: applying this
 * project's migration to their instance. See provision.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { schemaNameFor } from "@/lib/builder/schema";

export type BackendKind = "shared" | "own";

export type BackendConnection = {
  kind: BackendKind;
  /** The Supabase project URL the generated app is built against. */
  url: string;
  /** Public by design — it identifies the project, it authorises nothing. */
  anonKey: string;
  /* Which Postgres schema this project's tables are in. A schema of its own on
     the shared instance; `public` on somebody's own, where there is nothing to
     share it with and `public` is what every other tool expects. */
  schema: string;
  /** Whether the migration has actually been applied to it. */
  ready: boolean;
};

/** A row of project_backends, as the service client reads it. */
type BackendRow = {
  project_id: string;
  kind: string | null;
  url: string | null;
  anon_key: string | null;
  schema_name: string | null;
  applied_at: string | null;
};

/* The shared instance, from the environment this app already runs on.
 *
 * Read at call time rather than at module scope: this module is imported by the
 * build route, and a missing key should fail that one build with a sentence
 * somebody can act on rather than take the process down at boot. */
function sharedCredentials(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

/**
 * Where this project's data lives.
 *
 * Falls back to the shared instance whenever there is no link — including when
 * the lookup itself fails. That is deliberate: a project whose backend row
 * cannot be read is a project that should still build, on the instance it was
 * built on before, rather than one that fails with a database error about the
 * database. A link that exists but is unreadable is reported by the caller when
 * the migration fails to apply, which is the point where it actually matters.
 */
export async function resolveBackend(
  service: SupabaseClient,
  projectId: string,
): Promise<BackendConnection | null> {
  const { data } = await service
    .from("project_backends")
    .select("project_id, kind, url, anon_key, schema_name, applied_at")
    .eq("project_id", projectId)
    .maybeSingle<BackendRow>();

  if (data && data.kind === "own" && data.url && data.anon_key) {
    return {
      kind: "own",
      url: data.url,
      anonKey: data.anon_key,
      schema: data.schema_name?.trim() || "public",
      ready: Boolean(data.applied_at),
    };
  }

  const shared = sharedCredentials();
  if (!shared) return null;

  return {
    kind: "shared",
    url: shared.url,
    anonKey: shared.anonKey,
    schema: schemaNameFor(projectId),
    ready: Boolean(data?.applied_at),
  };
}

/**
 * The environment a generated project is built with.
 *
 * Three variables rather than two. The schema is one of them because the
 * generated client has to be pointed at it — a shared-instance app querying
 * `public` would be querying QuickStark's own tables, which RLS would refuse
 * and which would be a very bad thing to get right by accident.
 *
 * All three are NEXT_PUBLIC_. Nothing here is a secret, and the naming says so:
 * a variable that reaches the browser and is not marked as reaching the browser
 * is how a service key ends up in a bundle.
 */
export function envFor(connection: BackendConnection): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: connection.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: connection.anonKey,
    NEXT_PUBLIC_SUPABASE_SCHEMA: connection.schema,
  };
}

/**
 * Whether a URL is a Supabase project someone could actually have.
 *
 * Checked before anything is stored, because the failure otherwise arrives much
 * later and looks like a build problem: a typo'd host is a generated app whose
 * every query fails at runtime, in somebody's browser, with a DNS error.
 *
 * Deliberately not a network call. This is a shape check — that the address is
 * https and is a Supabase host — and the real test is the migration, which
 * either applies or does not.
 */
export function isSupabaseUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  /* Hosted projects are <ref>.supabase.co. A self-hosted instance is any host
     at all, so this cannot be an allowlist without locking out the people most
     likely to be running their own — it rejects the shapes that are certainly
     wrong (a path, a query, a bare hostname with no dot) and lets the migration
     be the judge of the rest. */
  return parsed.hostname.includes(".") && parsed.pathname === "/" && parsed.search === "";
}

/**
 * Whether a value is a key safe to compile into a public bundle.
 *
 * This one matters more than it looks. The publishable key and the secret key
 * sit next to each other in the Supabase dashboard, so pasting the wrong one is
 * not an unlikely accident — it is the likely one. The publishable key in the
 * wrong field breaks the app; the SECRET key in this field gets compiled into a
 * static bundle and served to every visitor, handing each of them full read and
 * write over every table with RLS bypassed. Only one of those two mistakes can
 * be noticed later, so both are refused here.
 *
 * ── Two formats, because Supabase changed theirs ──────────────────────────
 *
 * LEGACY. Both keys were JWTs, distinguishable only by the `role` claim in the
 * payload: `anon` or `service_role`. So the role is read out and anything that
 * is not `anon` is refused. Not verified — there is no key here to verify
 * against, and that is fine: this is a guard against a mistake, not against an
 * attacker, and an attacker who forges a token to put their own credentials
 * into their own project has achieved nothing.
 *
 * CURRENT. Supabase now issues `sb_publishable_…` and `sb_secret_…`, which are
 * not JWTs at all — no dots, no payload, nothing to decode. The prefix IS the
 * role, and it is a better signal than the old one because it cannot be forged
 * into looking like the other.
 *
 * Only the legacy branch was here, and that was a real fault rather than an
 * omission: every Supabase project created recently issues the new format, so
 * somebody linking their own database was told their key was not an anon key
 * while holding a perfectly valid one. The feature was broken for new users and
 * worked for nobody but the earliest.
 */
export function isAnonKey(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const key = value.trim();
  if (!key) return false;

  /* The current format. Checked first and checked exactly: `sb_secret_` must
     never pass, and a prefix test loose enough to accept "sb_publishable" as a
     substring anywhere would be a worse guard than none. */
  if (key.startsWith("sb_")) {
    return key.startsWith("sb_publishable_") && key.length > "sb_publishable_".length;
  }

  const parts = key.split(".");
  if (parts.length !== 3) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { role?: unknown };

    return payload.role === "anon";
  } catch {
    return false;
  }
}

/**
 * The link, as the project owner is told about it.
 *
 * Says which instance and whether the tables are actually there, because those
 * are the two things that go wrong and they go wrong differently: a project
 * pointed at the right database with no schema in it looks exactly like one
 * pointed at the wrong database.
 */
export function describeBackend(connection: BackendConnection): string {
  const where =
    connection.kind === "own"
      ? `your own Supabase (${new URL(connection.url).hostname})`
      : "QuickStark's Supabase";

  return connection.ready
    ? `Data lives in ${where}, schema ${connection.schema}.`
    : `Data will live in ${where}, schema ${connection.schema} — not created yet.`;
}
