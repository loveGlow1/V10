/* Making the database real.
 *
 * Everything upstream of this file decides what a project's database should be:
 * the manifest says it has one, schema.ts says what is in it and emits the SQL.
 * None of that is worth anything until the SQL has actually run somewhere. A
 * generated store whose products table does not exist is the same store with a
 * longer error message, and "here is the schema, paste it into the SQL editor"
 * is the fake back end this whole arrangement was built to stop being.
 *
 * So this applies it.
 *
 * ── Why a Postgres connection rather than the Supabase client ─────────────
 *
 * supabase-js speaks PostgREST, which is a data API: it selects, inserts,
 * updates and deletes rows in tables that already exist. It has no way to say
 * `create schema`, and no way to say `create policy`. DDL needs a database
 * connection, so there is one.
 *
 * The credential is therefore the strongest one in the system — a Postgres
 * superuser connection string, RLS irrelevant, every table in reach. It is
 * held in exactly two places, both server-only: SUPABASE_DB_URL for the shared
 * instance, and the write-only db_url column of project_backends for somebody's
 * own. It never reaches a build prompt, a generated file, or the browser.
 *
 * ── Idempotent, because this runs again on every rebuild ──────────────────
 *
 * A project is built more than once. The second build applies the same
 * migration to a schema that already has half of it, which is why every
 * statement schema.ts emits is `if not exists` or a drop-then-create. This
 * file's only contribution to that is the transaction: the whole migration
 * lands or none of it does, so a failure halfway through leaves the schema as
 * it was rather than half-migrated, which is the state nobody can reason about.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BackendConnection } from "@/lib/builder/backend/connection";
import { type DataModel, toSql } from "@/lib/builder/schema";

export type ProvisionOutcome =
  /* `recorded` is whether project_backends remembers this run, and it is
     separate from `applied` because the two can genuinely differ: the migration
     commits over a Postgres connection, and the row is written through
     PostgREST afterwards. Tables that exist are reported as created even when
     the bookkeeping failed — the alternative is a step that says the database
     was not made while the person is looking at it. */
  | { ok: true; applied: true; recorded: boolean; tables: number; ms: number }
  /* Nothing to do, and that is a success rather than a skip: a landing page has
     no database and a build that reported a failed provisioning step for one
     would be wrong. */
  | { ok: true; applied: false; reason: "no-database" }
  /* Configured to run and could not — no connection string, or the database
     refused. The build continues: a project whose schema is pending is still
     worth previewing, and the reason travels with it so the workspace can say
     what is missing rather than leaving somebody to discover it through a
     runtime error in their own app. */
  | { ok: false; applied: false; reason: string };

/**
 * The connection string for this project's database, or null.
 *
 * Null is an ordinary answer rather than an error. A deployment that has not
 * set SUPABASE_DB_URL cannot create schemas, and the honest response to that is
 * a build that says its tables are pending — not a crash, and certainly not a
 * generated app that pretends the tables are there.
 */
async function connectionStringFor(
  service: SupabaseClient,
  connection: BackendConnection,
  projectId: string,
): Promise<string | null> {
  if (connection.kind === "shared") {
    return process.env.SUPABASE_DB_URL ?? null;
  }

  /* Read with the service client, which is the only reader there is: the column
     is revoked from anon and authenticated, so the owner's own browser cannot
     read back what it wrote. */
  const { data } = await service
    .from("project_backends")
    .select("db_url")
    .eq("project_id", projectId)
    .maybeSingle<{ db_url: string | null }>();

  return data?.db_url ?? null;
}


/* Why the tables are not there, written where somebody can find it later.
 *
 * A provisioning failure has always been reported — once, in the build's step
 * list, in a conversation that scrolls away. The question it answers ("my app
 * says the database is pending, why") is asked hours later and somewhere else,
 * and until now the honest reply was to rebuild and watch. So the reason is
 * kept.
 *
 * Best effort throughout. This runs on a path that has already failed, and a
 * failure to record a failure must not become the thing the caller sees. */
async function recordFailure(
  service: SupabaseClient,
  projectId: string,
  userId: string,
  connection: BackendConnection,
  reason: string,
): Promise<void> {
  try {
    await service.from("project_backends").upsert(
      {
        project_id: projectId,
        user_id: userId,
        kind: connection.kind,
        schema_name: connection.schema,
        last_error: reason,
      },
      { onConflict: "project_id" },
    );
  } catch {
    /* Deliberately silent. See above. */
  }
}

/**
 * Applies this project's schema to its database.
 *
 * Never throws. Every failure here is a build that should carry on without a
 * database rather than a build that dies — the page still renders, the files
 * are still worth having, and the reason is reported where somebody can act on
 * it. A thrown exception in the middle of the build route would lose all three.
 */
export async function provision(
  service: SupabaseClient,
  connection: BackendConnection,
  model: DataModel,
  projectId: string,
  /* The project's owner. project_backends.user_id is not null and has no
     default — the row cannot be inserted without it — and it is what the
     table's owner-scoped policies match on, so a row carrying the wrong id
     would be invisible to the person whose database it describes. It comes
     from the caller's own session, which is also what proved the project was
     theirs to build. */
  userId: string,
): Promise<ProvisionOutcome> {
  if (model.tables.length === 0) {
    return { ok: true, applied: false, reason: "no-database" };
  }

  let sql: string;
  try {
    sql = toSql(model);
  } catch (error) {
    /* toSql refuses a table with row-level security on and no policy behind it.
       That is a bug in this repository rather than a runtime condition, and it
       is reported as one instead of being applied. */
    return {
      ok: false,
      applied: false,
      reason: error instanceof Error ? error.message : "the schema could not be written",
    };
  }

  const dsn = await connectionStringFor(service, connection, projectId);
  if (!dsn) {
    const reason =
      connection.kind === "shared"
        ? "this deployment has no SUPABASE_DB_URL, so it cannot create schemas"
        : "no connection string was stored for this Supabase, so its tables cannot be created";
    await recordFailure(service, projectId, userId, connection, reason);
    return { ok: false, applied: false, reason };
  }

  const started = Date.now();

  /* Imported here rather than at the top of the file. `pg` is a Node module
     with a native path; a static import would pull it into every bundle that
     touches the builder, including the ones Next tries to trace for the edge.
     This is the only function that needs it and it is the only place it is
     loaded. */
  const { Client } = await import("pg");

  const client = new Client({
    connectionString: dsn,
    /* Supabase terminates TLS with a certificate chain Node does not carry, and
       the alternative to this is bundling their CA and rotating it. The
       connection is still encrypted; what is not verified is the identity of
       the host, which is one already named by a connection string held only on
       this server. */
    ssl: { rejectUnauthorized: false },
    /* A migration that hangs must not hold the build open until the platform
       kills the whole function — that failure arrives as a gateway error with
       nothing to read. */
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });

  try {
    await client.connect();
    /* One transaction. A migration that stops halfway leaves a schema with some
       of its policies, which is worse than one with none: the tables exist, so
       the next run's `if not exists` skips them, and the missing policies stay
       missing forever. */
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");

    const { error: recordError } = await service
      .from("project_backends")
      .upsert(
        {
          project_id: projectId,
          user_id: userId,
          kind: connection.kind,
          url: connection.url,
          anon_key: connection.anonKey,
          schema_name: connection.schema,
          applied_at: new Date().toISOString(),
          /* Cleared, not left. A stale reason beside a schema that now exists
             is worse than no reason at all — it sends whoever reads it after
             something that has already been fixed. */
          last_error: null,
        },
        { onConflict: "project_id" },
      );

    /* Logged rather than returned as a failure, and never thrown. The tables
       are there; what is missing is the note saying so, and the consequence is
       bounded — the next build reads no applied_at, decides the schema is
       pending and runs the same migration again, which every statement in it
       is written to survive. Silence here is what made this worth fixing: the
       error was discarded, so a row that never landed looked exactly like one
       that did. */
    if (recordError) {
      // eslint-disable-next-line no-console
      console.error("provision: the schema was applied but not recorded:", recordError);
    }

    return {
      ok: true,
      applied: true,
      recorded: !recordError,
      tables: model.tables.length,
      ms: Date.now() - started,
    };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      /* The rollback failing means the connection is already gone, which means
         the transaction is already rolled back. Nothing to report that the
         error below does not say better. */
    }

    /* The commonest shape of this in production is a connection that never
       opens: Supabase's DIRECT database host is IPv6-only and a Vercel
       function has no IPv6 egress, so the pooler is the one that works. See
       docs/BACKEND.md. Recorded verbatim rather than interpreted — a guess
       written down as a diagnosis is worse than the driver's own words. */
    const reason = error instanceof Error ? error.message : "the migration could not be applied";
    await recordFailure(service, projectId, userId, connection, reason);
    return { ok: false, applied: false, reason };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * What the step list says about a provisioning run.
 *
 * A failure is written as what is missing rather than as what went wrong with
 * us, because the person reading it is looking at their own half-built store
 * and needs to know whether to wait or to do something.
 */
export function describeProvision(outcome: ProvisionOutcome): string {
  if (outcome.applied) {
    const made = `${outcome.tables} ${outcome.tables === 1 ? "table" : "tables"} created, row-level security on every one`;
    /* Worth saying out loud rather than hiding behind a success: the tables are
       real, and the next build will make them again because nothing wrote down
       that this one had. */
    return outcome.recorded ? made : `${made} — but this run could not be recorded, so the next build will apply the schema again`;
  }
  if (outcome.ok) return "no database needed";
  return `the tables are not there yet — ${outcome.reason}`;
}
