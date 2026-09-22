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
import { type BackendMode, type BackendWeight, isBackendMode } from "@/lib/builder/backend/modes";
import {
  configureAuth,
  configured as managedConfigured,
  provisionProject,
} from "@/lib/builder/backend/managed";
import { PUBLISH_SUBDOMAIN, SITE_URL } from "@/lib/site";
import { publishedUrl } from "@/lib/publish/naming";

/* Kept as the column's old name and meaning. `mode` is the one to read — see
   modes.ts, which has the value this could never express ("none") and the one
   it conflated with a schema on our instance ("quickstark_managed"). */
export type BackendKind = "shared" | "own";

export type BackendConnection = {
  kind: BackendKind;
  /* Which of the four this is. The field every caller should branch on: `kind`
     cannot distinguish a database of the project's own from a schema on ours,
     and has no way at all to say there is no database. */
  mode: BackendMode;
  /* Supabase's own project ref, for a managed backend. Null for every other
     mode — a schema on the shared instance is not a project and does not have
     one. */
  managedRef: string | null;
  /* When this server last reached that Supabase and was answered. Null means
     nobody has ever checked, which is not the same as broken and is exactly
     what "connected" used to mean. See verify.ts. */
  verifiedAt: string | null;
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
  mode: string | null;
  managed_ref: string | null;
  url: string | null;
  anon_key: string | null;
  schema_name: string | null;
  applied_at: string | null;
  verified_at: string | null;
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
  const { data, error } = await service
    .from("project_backends")
    .select(
      "project_id, kind, mode, managed_ref, url, anon_key, schema_name, applied_at, verified_at",
    )
    .eq("project_id", projectId)
    .maybeSingle<BackendRow>();

  /* ── A read that FAILED is not a project with no link ──────────────────
   *
   * The error used to be discarded, so the two were indistinguishable and both
   * fell through to the shared instance below. That is the quiet version of
   * the worst thing this module can do: a transient failure reading
   * project_backends silently moved somebody's project off their own Supabase
   * and onto ours for the length of one build — provisioning their schema
   * here, and deploying their app against our database.
   *
   * Null instead, which every caller already handles as "no database this
   * time": the build carries on, the migration is skipped and said to be
   * pending, and no .env.production is written. A build that does less is
   * recoverable. A build that quietly points at the wrong database is not. */
  if (error) {
    // eslint-disable-next-line no-console
    console.error(`resolveBackend: could not read the backend for ${projectId}:`, error.message);
    return null;
  }

  const stored = isBackendMode(data?.mode) ? data.mode : null;

  /* No database at all, decided and written down. Previously this was the
     ABSENCE of a row, which is indistinguishable from a row that failed to
     write — so a frontend-only project and a bookkeeping failure produced the
     same answer, and that answer was "put it on the shared instance". */
  if (stored === "none") return null;

  /* A database of this project's own, or the customer's. Both are real Supabase
     projects with `public` as their schema, and both are read the same way —
     the difference is whose account pays for it, which matters everywhere
     except here. */
  if ((stored === "own" || stored === "quickstark_managed") && data?.url && data.anon_key) {
    return {
      kind: stored === "own" ? "own" : "shared",
      mode: stored,
      managedRef: data.managed_ref ?? null,
      url: data.url,
      anonKey: data.anon_key,
      schema: data.schema_name?.trim() || "public",
      ready: Boolean(data.applied_at),
      verifiedAt: data.verified_at ?? null,
    };
  }

  /* ── CHOSEN THEIRS, AND NOT CONNECTED YET ───────────────────────────────
   *
   * An `own` row with no url and no anon key is somebody who has answered
   * "connect my own backend" and not yet pasted their credentials. Until this
   * existed it fell through every branch below and landed on the shared
   * instance — so a person who explicitly declined this platform's
   * infrastructure had a schema created on it anyway, their app built against
   * it, and their data written into an account they do not own. That is the
   * one outcome the question was added to prevent, arriving through the
   * fallback underneath it.
   *
   * Null instead, which every caller already handles as "no database this
   * time": the build carries on, no .env.production is written, the migration
   * is skipped and reported pending. They connect their Supabase under Backend
   * and the next build has somewhere to put it. A build that does less is
   * recoverable; a build that put their rows somewhere they did not choose is
   * not. */
  if (stored === "own") return null;

  /* Rows written before `mode` existed. `kind` is all there is, and it means
     what it always meant. */
  if (!stored && data?.kind === "own" && data.url && data.anon_key) {
    return {
      kind: "own",
      mode: "own",
      managedRef: null,
      url: data.url,
      anonKey: data.anon_key,
      schema: data.schema_name?.trim() || "public",
      ready: Boolean(data.applied_at),
      verifiedAt: data.verified_at ?? null,
    };
  }

  const shared = sharedCredentials();
  if (!shared) return null;

  /* The transitional preview instance. Reached by saying nothing, which is why
     it is still the fallback — but it is a preview, and isProductionGrade is
     what the interface asks before somebody publishes a shop onto it. */
  return {
    kind: "shared",
    mode: "shared",
    managedRef: null,
    url: shared.url,
    anonKey: shared.anonKey,
    schema: schemaNameFor(projectId),
    ready: Boolean(data?.applied_at),
    verifiedAt: data?.verified_at ?? null,
  };
}

/* ── Making sure a project has a backend fit for what it is ───────────────
 *
 * resolveBackend READS. This is the one function that may write, and it exists
 * because reading alone had a gap the size of the product: a project with
 * nothing linked falls through to the shared preview instance, and nothing in
 * the build path ever asked for anything better. modeFor has declared managed
 * the intended default since it was written, and the only caller was the
 * backend panel's recommendation — so a generated application got a schema on
 * a shared instance unless its owner went and pressed a button, which nobody
 * told them about.
 *
 * ── The split, which is the whole point ───────────────────────────────────
 *
 *   SIMPLE (a table or two, nobody signs in) stays on the shared instance and
 *   should. Its disqualifying flaw is the common `auth.users` pool, and a
 *   backend with no accounts never touches it. A contact form does not need a
 *   Supabase project of its own, and giving it one is a monthly bill against a
 *   table nobody will open a dashboard to look at.
 *
 *   HEAVY (accounts, an admin, uploads, money) gets a project of its own. Not
 *   a preference: identities are per Supabase project, so accounts on the
 *   shared instance are accounts in a pool shared with strangers.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * It never overrules an owner. A project whose row already names a mode has
 * been decided — by them in the panel, or by an earlier build — and this
 * returns that untouched. It only ever fills in a project that has said
 * nothing, and it only ever moves UP: nothing here relocates data that exists.
 *
 * Never throws, and every failure degrades to what resolveBackend would have
 * returned anyway. A Supabase that would not create a project is a build that
 * carries on against the shared schema and says so — the same degradation the
 * rest of provisioning already has, and for the same reason: a project whose
 * database is plainer is worth having, and a build that dies over it is not.
 */
export async function ensureBackendFor(
  service: SupabaseClient,
  input: {
    projectId: string;
    userId: string;
    /** Only used to name the Supabase project readably. See managedName. */
    projectName: string;
    /* `weight` used to live here and decided whether a project of its own was
       owed. That decision is the customer's now — they are asked, and the
       answer is recorded — so nothing in this function reads it. weightOf
       still exists and still describes a manifest; it simply no longer
       overrules somebody who asked for a database. */
  },
): Promise<BackendConnection | null> {
  const existing = await resolveBackend(service, input.projectId);

  /* No database wanted, or the read failed. Both are already handled correctly
     by every caller and neither is this function's business — see the note in
     resolveBackend about why a failed read must not become a fallback. */
  if (!existing) return null;

  /* ── A database is never given to somebody who was not asked ──────────
   *
   * This used to provision on mode `shared` plus a heavy manifest: a project
   * whose brief obviously needed data got a Supabase project created for it
   * and a credit spent, and nothing anywhere had put the question. The
   * architecture question was only asked when the decision was UNCERTAIN, and
   * a brief that plainly needs a database is the certain case — which is
   * exactly when this fired. The clearer the need, the less likely anybody was
   * asked.
   *
   * So the gate is now the recorded decision rather than the manifest.
   * `quickstark_managed` is written by the build route when somebody chooses
   * it, and nothing else reaches the provisioning below:
   *
   *   own    theirs. Never ours to create, and resolveBackend already refuses
   *          to hand ours over while they connect it.
   *   none   they said no database.
   *   shared the fallback NOBODY chose. Not consent, and the one state that
   *          must not be built on. The build carries on against the shared
   *          schema, which is what it would have had anyway and is fine for a
   *          preview — it simply does not spend a credit to get there.
   */
  if (existing.mode !== "quickstark_managed") return existing;

  /* Chosen and already provisioned. A ref is what says so. */
  if (existing.managedRef) return existing;

  /* Asked for, so provisioned — however small it is.
   *
   * `weight` used to gate this: a light manifest kept its tables on the shared
   * schema, on the reasoning that a table or two belongs where it already is.
   * That reasoning was sound while this ran on a GUESS, because the cost of
   * guessing wrong was an empty Supabase project nobody opened.
   *
   * It is wrong now that it runs on an ANSWER. Somebody who chose a managed
   * database and spent a credit on it has said what they want, and a two-table
   * app on the shared preview schema is a two-table app that cannot have real
   * customers — which is the whole of what they were buying. Small is not the
   * same as temporary, and deciding it is for them is how you deliver less
   * than was asked for while reporting success.
   *
   * weight is still what decides whether to OFFER one; it no longer overrides
   * somebody who took the offer. */

  if (!managedConfigured()) {
    /* The operator's half. Logged once rather than surfaced: the build is
       about to carry on against a working schema, and "your app is on a shared
       database because this deployment has no SUPABASE_MANAGEMENT_TOKEN" is a
       sentence for whoever runs the platform, not for the customer. */
    // eslint-disable-next-line no-console
    console.warn(
      `backend: ${input.projectId} needs a database of its own and this deployment cannot provision one`,
    );
    return existing;
  }

  const provisioned = await provisionProject({
    projectName: input.projectName,
    projectId: input.projectId,
  });

  if (!provisioned.ok) {
    /* Recorded against the project, not just logged. "Why is my app on a
       shared database" is asked hours later and somewhere else — the same
       argument project_backends.verification_error already carries. */
    await service
      .from("project_backends")
      .upsert(
        {
          project_id: input.projectId,
          user_id: input.userId,
          kind: "shared",
          mode: "shared",
          verification_error: provisioned.reason,
        },
        { onConflict: "project_id" },
      )
      .then(
        () => undefined,
        () => undefined,
      );

    // eslint-disable-next-line no-console
    console.error(`backend: ${input.projectId} could not be given its own database: ${provisioned.reason}`);
    return existing;
  }

  const { error } = await service.from("project_backends").upsert(
    {
      project_id: input.projectId,
      user_id: input.userId,
      kind: "shared",
      mode: "quickstark_managed",
      managed_ref: provisioned.project.ref,
      url: provisioned.project.url,
      anon_key: provisioned.project.anonKey,
      /* `public`, because a project of its own has nothing to share a schema
         namespace with. The same value the backend panel writes. */
      schema_name: provisioned.project.schema,
      applied_at: null,
      verified_at: new Date().toISOString(),
      verification_error: null,
    },
    { onConflict: "project_id" },
  );

  if (error) {
    /* The Supabase project EXISTS and we have just failed to write down where.
       An orphan in the organisation dashboard is somebody's monthly bill, so
       the operator is told plainly. The build carries on against the shared
       schema, which is what it would have had anyway. */
    // eslint-disable-next-line no-console
    console.error(
      `backend: provisioned ${provisioned.project.ref} for ${input.projectId} and could not record it:`,
      error.message,
    );
    return existing;
  }

  /* And point its auth at where the app will actually live.
   *
   * Without this the project keeps Supabase's defaults — site_url
   * http://localhost:3000, an empty redirect allow-list, email confirmation on
   * — and the result does not look like an auth problem at all. The database
   * answers, the tables read, the app is plainly wired; sign-up even appears to
   * work. Then the confirmation email's link points at localhost, the account
   * is never confirmed, and sign-in fails for good.
   *
   * After the row is written rather than before, and never fatal: a project
   * whose auth settings did not take still has a working database, and that is
   * worth strictly more than a build that failed here. The operator is told;
   * the customer is not, because there is nothing for them to do about it.
   *
   * AND site_url IS PASSED, which it was not when this was written. The
   * reasoning then was that a wildcarded allow-list permits every address, and
   * auto-confirmed sign-up needs no link to land anywhere — both true, and
   * both about SIGN-UP. Password recovery is the other email, it is not
   * auto-anything, and its link goes to site_url. Left at Supabase's default
   * that is http://localhost:3000, so "reset my password" mailed a link to the
   * customer's own machine. Sign-in worked and recovery was broken, which is a
   * worse failure than both being broken because nobody looks for it.
   *
   * The project's own published address, from its slug. The slug is reserved
   * before a build gets this far in the ordinary case; where it is not, the
   * platform address is still a real page rather than a loopback, and publish
   * is where it becomes exact. */
  const auth = await configureAuth(provisioned.project.ref, await recoveryAddress(service, input.projectId));
  if (!auth.ok) {
    // eslint-disable-next-line no-console
    console.error(
      `backend: provisioned ${provisioned.project.ref} for ${input.projectId} but its auth settings did not take: ${auth.reason}`,
    );
  }

  return {
    kind: "shared",
    mode: "quickstark_managed",
    managedRef: provisioned.project.ref,
    url: provisioned.project.url,
    anonKey: provisioned.project.anonKey,
    schema: provisioned.project.schema,
    /* Nothing has been migrated into it yet — that is the caller's next step. */
    ready: false,
    verifiedAt: new Date().toISOString(),
  };
}

/* Where a password-recovery link should land.
 *
 * The project's own published address when it has a slug — that is the site
 * whose user is resetting a password, and the only address the link makes
 * sense at. Without one yet, this app's address: not correct, but a real page
 * on the internet rather than localhost, which is what "no site_url" means.
 *
 * Read rather than derived. addressFor() can compute a slug from a name, but
 * the one a project actually answers on is settled by the database, and a
 * recovery link sent to a computed-but-unreserved address is a link to
 * nothing. */
async function recoveryAddress(service: SupabaseClient, projectId: string): Promise<string> {
  try {
    const { data } = await service.from("projects").select("slug").eq("id", projectId).maybeSingle();
    const slug = (data as { slug?: string | null } | null)?.slug;
    return slug ? publishedUrl(slug) : SITE_URL;
  } catch {
    return SITE_URL;
  }
}

/* ── The half we cannot do for somebody ───────────────────────────────────
 *
 * On `own`, the customer's Supabase is theirs: we hold a URL and an anon key,
 * which authorise reading and writing under their policies and authorise
 * NOTHING about their project's configuration. So the redirect allow-list that
 * configureAuth sets on a managed project cannot be set here, and sign-in on
 * their deployed app fails in exactly the way described above — silently, and
 * looking like our bug.
 *
 * Saying so is the whole of what we can do, and it was not being said. This is
 * the sentence, with the values already filled in, so it can be pasted rather
 * than worked out. */
export function describeOwnAuthSetup(publishedAddress?: string | null): string {
  const ours = PUBLISH_SUBDOMAIN.replace(/^\./, "");
  return [
    "Your own Supabase needs two settings before sign-in works on the deployed app.",
    "In the Supabase dashboard, under Authentication → URL Configuration:",
    `- Redirect URLs: add https://*.${ours}/** (and http://localhost:3000/** if you run it locally)`,
    `- Site URL: ${publishedAddress ?? `https://<your-project>.${ours}`}`,
    "Until that redirect URL is there, sign-up succeeds and sign-in never does — the link in the confirmation email points somewhere else.",
  ].join("\n");
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
    connection.mode === "own"
      ? `your own Supabase (${new URL(connection.url).hostname})`
      : connection.mode === "quickstark_managed"
        ? `a Supabase project of its own (${new URL(connection.url).hostname})`
        : "QuickStark's shared preview Supabase";

  return connection.ready
    ? `Data lives in ${where}, schema ${connection.schema}.`
    : `Data will live in ${where}, schema ${connection.schema} — not created yet.`;
}
