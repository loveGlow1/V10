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
  | { ok: true; applied: true; tables: number; ms: number }
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
    return {
      ok: false,
      applied: false,
      reason:
        connection.kind === "shared"
          ? "this deployment has no SUPABASE_DB_URL, so it cannot create schemas"
          : "no connection string was stored for this Supabase, so its tables cannot be created",
    };
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

    await service
      .from("project_backends")
      .upsert(
        {
          project_id: projectId,
          kind: connection.kind,
          url: connection.url,
          anon_key: connection.anonKey,
          schema_name: connection.schema,
          applied_at: new Date().toISOString(),
        },
        { onConflict: "project_id" },
      );

    return { ok: true, applied: true, tables: model.tables.length, ms: Date.now() - started };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      /* The rollback failing means the connection is already gone, which means
         the transaction is already rolled back. Nothing to report that the
         error below does not say better. */
    }

    return {
      ok: false,
      applied: false,
      reason: error instanceof Error ? error.message : "the migration could not be applied",
    };
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
    return `${outcome.tables} ${outcome.tables === 1 ? "table" : "tables"} created, row-level security on every one`;
  }
  if (outcome.ok) return "no database needed";
  return `the tables are not there yet — ${outcome.reason}`;
}
