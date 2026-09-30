/* Scan, create, check — the three things a build does to a database.
 *
 * inspect.ts decides; this carries it out against a real database. It picks
 * how to reach the database (the Management API where somebody connected
 * Supabase by signing in, a Postgres connection where they pasted one), reads
 * what is there before anything is written, moves the app into a schema of its
 * own if `public` is taken, and after the migration reads it all again to prove
 * every table, column, policy and grant the app relies on is there.
 *
 * Every function here answers rather than throws. A database that could not be
 * read or checked is a build that says so, not a build that dies.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BackendConnection } from "./connection";
import { withSchema, type DataModel } from "../schema";
import {
  describeCheck,
  isolatedSchemaFor,
  parseSnapshot,
  planSchema,
  snapshotSql,
  verifySchema,
  type SchemaCheck,
  type SchemaPlan,
} from "./inspect";
import { exposeSchema, runQuery } from "./supabase-api";
import { accessTokenFor } from "./supabase-oauth";

export type QueryResult = { ok: true; rows: unknown[] } | { ok: false; reason: string };

export type SqlRunner = {
  via: "management-api" | "postgres";
  /** Whether the API's exposed schemas can be changed through this runner. */
  canExpose: boolean;
  query(sql: string): Promise<QueryResult>;
  expose(schema: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  close(): Promise<void>;
};

type BackendAccessRow = { user_id: string; supabase_ref: string | null; db_url: string | null };

async function accessRow(service: SupabaseClient, projectId: string): Promise<BackendAccessRow | null> {
  const { data } = await service
    .from("project_backends")
    .select("user_id, supabase_ref, db_url")
    .eq("project_id", projectId)
    .maybeSingle<BackendAccessRow>();
  return data ?? null;
}

function managementRunner(token: string, ref: string): SqlRunner {
  return {
    via: "management-api",
    canExpose: true,
    async query(sql) {
      const result = await runQuery(token, ref, sql);
      return result.ok ? { ok: true, rows: result.value } : { ok: false, reason: result.reason };
    },
    async expose(schema) {
      const result = await exposeSchema(token, ref, schema);
      return result.ok ? { ok: true } : { ok: false, reason: result.reason };
    },
    async close() {},
  };
}

/**
 * The Management API runner, where this project's database can be reached
 * through one — a Supabase connected by sign-in, or a managed project in our
 * organisation. Null otherwise, and the caller uses a Postgres connection.
 *
 * Managed projects used to fall through to SUPABASE_DB_URL here — the shared
 * instance — because their BackendConnection carries kind "shared". Routing
 * them through the API with the project's own ref is what puts their tables in
 * their own database.
 */
export async function managementRunnerFor(
  service: SupabaseClient,
  connection: BackendConnection,
  projectId: string,
): Promise<SqlRunner | null> {
  if (connection.mode === "quickstark_managed" && connection.managedRef) {
    const token = process.env.SUPABASE_MANAGEMENT_TOKEN;
    return token ? managementRunner(token, connection.managedRef) : null;
  }

  if (connection.mode === "own") {
    const row = await accessRow(service, projectId);
    if (!row?.supabase_ref) return null;
    const token = await accessTokenFor(service, row.user_id);
    return token ? managementRunner(token, row.supabase_ref) : null;
  }

  return null;
}

/**
 * The Postgres connection string for this project's database, or null.
 *
 * The shared instance's from the environment; somebody's own from the
 * write-only column they set when they pasted it. Read with the service
 * client, the only reader there is.
 */
export async function connectionStringFor(
  service: SupabaseClient,
  connection: BackendConnection,
  projectId: string,
): Promise<string | null> {
  if (connection.mode === "shared") return process.env.SUPABASE_DB_URL ?? null;
  if (connection.mode !== "own") return null;
  const row = await accessRow(service, projectId);
  return row?.db_url ?? null;
}

function postgresRunner(dsn: string): SqlRunner {
  let client: import("pg").Client | null = null;

  async function open() {
    if (client) return client;
    const { Client } = await import("pg");
    client = new Client({
      connectionString: dsn,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000,
    });
    await client.connect();
    return client;
  }

  return {
    via: "postgres",
    canExpose: false,
    async query(sql) {
      try {
        const result = await (await open()).query(sql);
        const last = Array.isArray(result) ? result[result.length - 1] : result;
        return { ok: true, rows: last?.rows ?? [] };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "the query failed" };
      }
    },
    async expose() {
      return { ok: false, reason: "a pasted connection cannot change which schemas Supabase serves" };
    },
    async close() {
      await client?.end().catch(() => {});
      client = null;
    },
  };
}

/** Whichever way this project's database can be reached, or null when it cannot be. */
export async function runnerFor(
  service: SupabaseClient,
  connection: BackendConnection,
  projectId: string,
): Promise<SqlRunner | null> {
  const api = await managementRunnerFor(service, connection, projectId);
  if (api) return api;
  const dsn = await connectionStringFor(service, connection, projectId);
  /* The direct endpoint resolves to IPv6 only and cannot be reached from here;
     provision.ts explains that to the owner. Not worth a scan that will fail. */
  if (!dsn || /@db\.[a-z0-9]+\.supabase\.co(?::|\/|$)/i.test(dsn)) return null;
  return postgresRunner(dsn);
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

async function snapshotOf(runner: SqlRunner, schemas: string[]) {
  const result = await runner.query(snapshotSql(schemas));
  if (!result.ok) return { ok: false as const, reason: result.reason };
  const snapshot = parseSnapshot(result.rows);
  return snapshot ? { ok: true as const, snapshot } : { ok: false as const, reason: "the database answered in a shape that could not be read" };
}

/* ── Before the migration ───────────────────────────────────────────────── */

export type Prepared = {
  /** The model to build and migrate — moved to its own schema if it had to be. */
  model: DataModel;
  plan: SchemaPlan | null;
  /** Why the migration must not run. Empty means go ahead. */
  blocked: string[];
  /** One line for the step list. */
  summary: string;
};

/**
 * Reads the database and decides where the app's tables go, before the app is
 * written against them.
 *
 * Only somebody's own Supabase is scanned for collisions: the shared instance
 * gives every project a schema of its own, and a managed project is a database
 * nobody else has touched. Both still get the post-migration check.
 */
export async function prepareSchema(input: {
  service: SupabaseClient;
  connection: BackendConnection;
  model: DataModel;
  projectId: string;
  projectName: string;
  runner: SqlRunner | null;
}): Promise<Prepared> {
  const { service, connection, model, projectId, projectName, runner } = input;
  const untouched = (summary: string): Prepared => ({ model, plan: null, blocked: [], summary });

  if (model.tables.length === 0) return untouched("no database needed");
  if (connection.mode !== "own") return untouched(`${model.tables.length} tables planned`);
  if (!runner) {
    /* Nothing to read it with, so nothing may be written to it either: a
       migration that has not looked first is the one that lands on their
       tables. Said in terms of what to press. */
    const row = await accessRow(service, projectId);
    const reason = row?.supabase_ref
      ? "QuickStark can no longer reach your Supabase account — the sign-in has expired or was revoked. Open the Database panel and press Connect Supabase again."
      : row?.db_url
        ? "The stored connection string points at Supabase's direct endpoint, which only has an IPv6 address and cannot be reached from here. Press Connect Supabase in the Database panel instead — no connection string needed."
        : "There is no way to reach your database to create this app's tables. Open the Database panel and press Connect Supabase, or run the SQL shown there yourself.";
    return { model, plan: null, blocked: [reason], summary: "your database could not be reached" };
  }

  const isolated = isolatedSchemaFor(projectName, projectId);
  const read = await snapshotOf(runner, [model.schema, isolated, "public"]);
  if (!read.ok) {
    return {
      model,
      plan: null,
      blocked: [`Your database could not be read, so nothing was created in it: ${read.reason}`],
      summary: "could not read your database",
    };
  }

  const plan = planSchema(model, read.snapshot, {
    settled: connection.ready,
    isolatedSchema: isolated,
    canExpose: runner.canExpose,
  });

  let next = model;
  const blocked = [...plan.blocked];

  if (plan.schema !== model.schema && blocked.length === 0) {
    next = withSchema(model, plan.schema);
    const { error } = await service
      .from("project_backends")
      .update({ schema_name: plan.schema, applied_at: null })
      .eq("project_id", projectId);
    if (error) blocked.push(`The new schema could not be recorded: ${error.message}`);
  }

  if (plan.exposeSchema && blocked.length === 0) {
    const exposed = await runner.expose(plan.schema);
    if (!exposed.ok) blocked.push(`The schema ${plan.schema} could not be made visible to your app: ${exposed.reason}`);
  }

  const summary = plan.isolated && plan.collisions.length > 0
    ? `your Supabase already has ${plan.collisions.map((c) => c.name).join(", ")} — this app gets its own schema, ${plan.schema}, and yours are left alone`
    : `${plan.create.length} to create, ${plan.reuse.length} already there${Object.keys(plan.extend).length ? `, ${Object.keys(plan.extend).length} to extend` : ""}`;

  return { model: next, plan, blocked, summary };
}

/* ── After the migration ────────────────────────────────────────────────── */

export type CheckReport = SchemaCheck & { at: string; summary: string };

/**
 * Reads the database again and checks everything the app relies on is there,
 * then records the answer on the project for the Database panel to show.
 */
export async function checkSchema(input: {
  service: SupabaseClient;
  projectId: string;
  model: DataModel;
  plan?: SchemaPlan | null;
  runner: SqlRunner | null;
}): Promise<CheckReport | null> {
  const { service, projectId, model, plan, runner } = input;
  if (!runner || model.tables.length === 0) return null;

  const read = await snapshotOf(runner, [model.schema]);
  const check: SchemaCheck = read.ok
    ? verifySchema(model, read.snapshot)
    : { ok: false, checked: 0, problems: [`the database could not be read back: ${read.reason}`] };

  const report: CheckReport = { ...check, at: new Date().toISOString(), summary: describeCheck(check, plan ?? undefined) };

  await service
    .from("project_backends")
    .update({ schema_report: report })
    .eq("project_id", projectId)
    .then(
      () => undefined,
      () => undefined,
    );

  return report;
}
