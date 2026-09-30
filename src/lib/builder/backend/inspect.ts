/* Reading somebody's own Supabase before touching it, and again after.
 *
 * A migration written for an empty database meets a database that is not
 * empty. `create table if not exists products` finds the customer's own
 * `products` — different columns, their rows, their policies — skips it, and
 * then creates OUR policies on THEIR table. Policies are permissive and OR'd,
 * so "anyone may read active products" added to their table can publish rows
 * they never meant to. And the app that was generated expects columns that are
 * not there, so it breaks too. Both halves of that are silent.
 *
 * So the database is read first, and three rules decide what happens:
 *
 *   1. NOTHING OF THEIRS IS EVER TOUCHED. A table, function or storage bucket
 *      this platform did not make is not altered, not given a policy, not
 *      granted anything. Ours are recognised by OWNED_MARK on their comment.
 *
 *   2. A COLLISION MOVES US, NOT THEM. If any of the app's tables would land on
 *      one of theirs, the whole app goes into a schema of its own — decided
 *      before the code is written, so the app is written against it. Moving it
 *      needs that schema exposed to the API, which only a Supabase connected
 *      by sign-in can do; where it cannot be done, the collision is reported
 *      and the migration does not run.
 *
 *   3. A SCHEMA ONCE USED STAYS. A project whose tables already exist is never
 *      moved by a later build, because moving it would leave its data behind.
 *
 * And after the migration, the same scan again: every table, column, policy and
 * grant the app relies on is checked to be there. "Database ready" is said
 * because it was looked at, not because a statement returned.
 *
 * Pure, apart from the SQL it writes: no connection, no fetch. The runner that
 * sends the SQL lives in provision.ts, so all of this can be tested offline.
 */

import { grantsFor, type Column, type DataModel } from "../schema";

/* The same marker schema.ts writes. Repeated rather than imported so this file
   stays loadable on its own by the offline check; tools/check-schema-scan.mjs
   asserts the two agree. */
const OWNED_MARK = "QuickStark:";

export type ExistingColumn = {
  name: string;
  /** Postgres's own spelling, from format_type: "text", "numeric", "timestamp with time zone". */
  type: string;
  notNull: boolean;
  hasDefault: boolean;
};

export type ExistingTable = {
  schema: string;
  name: string;
  comment: string | null;
  rls: boolean;
  policies: string[];
  columns: ExistingColumn[];
  anonSelect: boolean;
  authenticatedSelect: boolean;
  /** Every table command each role holds. Absent on a snapshot read before it was collected. */
  privileges?: { anon: string[]; authenticated: string[] };
};

export type Snapshot = {
  schemas: string[];
  tables: ExistingTable[];
  functions: { schema: string; name: string; comment: string | null }[];
  buckets: { id: string; public: boolean }[];
};

/* ── Reading ─────────────────────────────────────────────────────────────── */

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * One query that returns the whole picture as a single JSON value.
 *
 * Read-only: catalogue selects and privilege checks, nothing else. It runs
 * through the Management API or a Postgres connection, and both return the
 * one row with the one column, `snapshot`.
 */
export function snapshotSql(schemas: string[]): string {
  const list = [...new Set(schemas)].map(literal).join(", ");
  return `select json_build_object(
  'schemas', coalesce((select json_agg(nspname) from pg_namespace where nspname in (${list})), '[]'::json),
  'tables', coalesce((
    select json_agg(json_build_object(
      'schema', n.nspname,
      'name', c.relname,
      'comment', obj_description(c.oid, 'pg_class'),
      'rls', c.relrowsecurity,
      'policies', (select coalesce(json_agg(p.polname order by p.polname), '[]'::json) from pg_policy p where p.polrelid = c.oid),
      'columns', (
        select coalesce(json_agg(json_build_object(
          'name', a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'notNull', a.attnotnull,
          'hasDefault', a.atthasdef
        ) order by a.attnum), '[]'::json)
        from pg_attribute a
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      ),
      'anonSelect', has_table_privilege('anon', c.oid, 'select'),
      'authenticatedSelect', has_table_privilege('authenticated', c.oid, 'select'),
      'privileges', json_build_object(
        'anon', (select coalesce(json_agg(cmd), '[]'::json) from unnest(array['select', 'insert', 'update', 'delete']) as cmd where has_table_privilege('anon', c.oid, cmd)),
        'authenticated', (select coalesce(json_agg(cmd), '[]'::json) from unnest(array['select', 'insert', 'update', 'delete']) as cmd where has_table_privilege('authenticated', c.oid, cmd))
      )
    ))
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname in (${list})
  ), '[]'::json),
  'functions', coalesce((
    select json_agg(json_build_object('schema', n.nspname, 'name', p.proname, 'comment', obj_description(p.oid, 'pg_proc')))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in (${list}) and p.proname = 'is_admin'
  ), '[]'::json),
  'buckets', coalesce((select json_agg(json_build_object('id', id, 'public', public)) from storage.buckets), '[]'::json)
) as snapshot;`;
}

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * The query's answer, however it arrived.
 *
 * pg hands back the json column already parsed; the Management API hands back
 * rows whose json columns may be parsed or may be a string. Both, and a row
 * array or a bare row, are accepted — and anything unrecognisable is null, not
 * an empty database, because "we could not read it" must never be mistaken for
 * "there is nothing there to collide with".
 */
export function parseSnapshot(result: unknown): Snapshot | null {
  let value: unknown = result;
  if (Array.isArray(value)) value = value[0];
  if (value && typeof value === "object" && "snapshot" in (value as object)) {
    value = (value as { snapshot: unknown }).snapshot;
  }
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || !Array.isArray((value as { tables?: unknown }).tables)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  return {
    schemas: asArray(raw.schemas).map(asString).filter((name): name is string => Boolean(name)),
    tables: asArray(raw.tables).map((entry) => {
      const table = asRecord(entry);
      return {
        schema: asString(table.schema) ?? "",
        name: asString(table.name) ?? "",
        comment: asString(table.comment),
        rls: table.rls === true,
        policies: asArray(table.policies).map(asString).filter((name): name is string => Boolean(name)),
        columns: asArray(table.columns).map((item) => {
          const column = asRecord(item);
          return {
            name: asString(column.name) ?? "",
            type: asString(column.type) ?? "",
            notNull: column.notNull === true,
            hasDefault: column.hasDefault === true,
          };
        }),
        anonSelect: table.anonSelect === true,
        authenticatedSelect: table.authenticatedSelect === true,
        ...(table.privileges && typeof table.privileges === "object"
          ? {
              privileges: {
                anon: asArray(asRecord(table.privileges).anon).map(asString).filter((c): c is string => Boolean(c)),
                authenticated: asArray(asRecord(table.privileges).authenticated)
                  .map(asString)
                  .filter((c): c is string => Boolean(c)),
              },
            }
          : {}),
      };
    }),
    functions: asArray(raw.functions).map((entry) => {
      const fn = asRecord(entry);
      return { schema: asString(fn.schema) ?? "", name: asString(fn.name) ?? "", comment: asString(fn.comment) };
    }),
    buckets: asArray(raw.buckets).map((entry) => {
      const bucket = asRecord(entry);
      return { id: asString(bucket.id) ?? "", public: bucket.public === true };
    }),
  };
}

/* ── Deciding ────────────────────────────────────────────────────────────── */

/** Whether a comment says this platform made the thing it is on. */
export function isOurs(comment: string | null, legacyWhat?: string): boolean {
  if (!comment) return false;
  /* Before the marker existed the comment was the table's description alone,
     and those tables are ours too — they were made by a build of this project. */
  return comment.startsWith(OWNED_MARK) || (legacyWhat !== undefined && comment === legacyWhat);
}

/* Postgres's spelling of each of the model's types. format_type says
   "timestamp with time zone" for timestamptz, and so on. */
const PG_TYPE: Record<Column["type"], string[]> = {
  uuid: ["uuid"],
  text: ["text", "character varying"],
  integer: ["integer"],
  bigint: ["bigint"],
  numeric: ["numeric"],
  boolean: ["boolean"],
  timestamptz: ["timestamp with time zone"],
  jsonb: ["jsonb"],
};

function sameType(model: Column["type"], existing: string): boolean {
  const bare = existing.replace(/\(.*\)$/, "").trim();
  return PG_TYPE[model].includes(bare);
}

export type Collision = {
  kind: "table" | "function" | "bucket";
  name: string;
  /** Written for the owner of the database, not for a log. */
  why: string;
};

export type SchemaPlan = {
  /** Where the app's tables go. `public`, or a schema of the app's own. */
  schema: string;
  /** Moved out of `public` because something of theirs was in the way. */
  isolated: boolean;
  /** Needs this schema added to the API's exposed list before the app can read it. */
  exposeSchema: boolean;
  create: string[];
  reuse: string[];
  /** Columns to add to tables of ours that are missing them. */
  extend: Record<string, Column[]>;
  /** What of theirs was found in the way — and avoided, if `isolated`. */
  collisions: Collision[];
  /* What stops the migration running at all. Empty is the ordinary case. A
     non-empty list means applying it would touch something of theirs or could
     not succeed, and the build reports it instead. */
  blocked: string[];
};

/**
 * A schema name for an app that has to move out of `public`.
 *
 * Readable in their dashboard — `qs_bakery` rather than a UUID — with enough of
 * the project id to be unique if two apps share one Supabase.
 */
export function isolatedSchemaFor(projectName: string, projectId: string): string {
  const name = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const id = projectId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
  return `qs_${name ? `${name}_` : ""}${id}`;
}

function assess(model: DataModel, snapshot: Snapshot, bucketsAreOurs: boolean) {
  const collisions: Collision[] = [];
  const create: string[] = [];
  const reuse: string[] = [];
  const extend: Record<string, Column[]> = {};
  const unfixable: string[] = [];

  for (const table of model.tables) {
    const found = snapshot.tables.find((t) => t.schema === model.schema && t.name === table.name);
    if (!found) {
      create.push(table.name);
      continue;
    }

    if (!isOurs(found.comment, table.what)) {
      collisions.push({
        kind: "table",
        name: `${model.schema}.${table.name}`,
        why: `You already have a table called ${table.name}, and it is not one this app made.`,
      });
      continue;
    }

    reuse.push(table.name);

    for (const column of table.columns) {
      const existing = found.columns.find((c) => c.name === column.name);
      if (!existing) {
        (extend[table.name] ??= []).push(column);
        continue;
      }
      if (!sameType(column.type, existing.type)) {
        unfixable.push(
          `${table.name}.${column.name} is ${existing.type} in the database and this app expects ${column.type}. ` +
            "Nothing was changed — converting a column can lose data, so that is yours to decide.",
        );
      }
    }
  }

  if (model.tables.some((table) => table.name === "profiles")) {
    const fn = snapshot.functions.find((f) => f.schema === model.schema && f.name === "is_admin");
    if (fn && !isOurs(fn.comment)) {
      collisions.push({
        kind: "function",
        name: `${model.schema}.is_admin()`,
        why: "You already have a function called is_admin(), and this app would replace it.",
      });
    }
  }

  if (!bucketsAreOurs) {
    for (const bucket of model.buckets) {
      if (snapshot.buckets.some((b) => b.id === bucket.name)) {
        collisions.push({
          kind: "bucket",
          name: bucket.name,
          why: `You already have a storage bucket called ${bucket.name}, and this app would add access rules to it.`,
        });
      }
    }
  }

  return { collisions, create, reuse, extend, unfixable };
}

/**
 * Where this project's tables should go in a database that may not be empty.
 *
 * `model` is the model as it would be built in its current schema. When that
 * collides with the owner's own things and the project has no tables yet, the
 * plan moves it to `isolatedSchema` — the caller rebuilds the model there with
 * schema.ts `withSchema` and writes the app against that.
 */
export function planSchema(
  model: DataModel,
  snapshot: Snapshot,
  options: {
    /** This project's tables already exist where they are — never move them. */
    settled: boolean;
    /** Where to go if `public` is taken. */
    isolatedSchema: string;
    /** Whether the API's exposed schemas can be changed for them (sign-in connections). */
    canExpose: boolean;
  },
): SchemaPlan {
  const here = assess(model, snapshot, options.settled);

  const needsToMove =
    here.collisions.length > 0 && !options.settled && model.schema === "public" && options.canExpose;

  if (needsToMove) {
    const moved: DataModel = { ...model, schema: options.isolatedSchema };
    const there = assess(moved, snapshot, true);
    return {
      schema: options.isolatedSchema,
      isolated: true,
      exposeSchema: true,
      create: there.create,
      reuse: there.reuse,
      extend: there.extend,
      /* Reported so the owner can see why the app is not in `public` — these
         are what was avoided, not what is wrong. */
      collisions: here.collisions,
      blocked: [...there.collisions.map((c) => c.why), ...there.unfixable],
    };
  }

  const blocked = [...here.unfixable];
  if (here.collisions.length > 0) {
    blocked.push(
      ...here.collisions.map((c) => c.why),
      model.schema === "public" && !options.canExpose
        ? "Connect this Supabase with the Connect Supabase button and the app will be given a schema of its own instead, leaving yours alone."
        : "Rename or remove the conflicting item, then build again. Nothing of yours has been changed.",
    );
  }

  return {
    schema: model.schema,
    isolated: model.schema !== "public",
    exposeSchema: model.schema !== "public" && options.canExpose,
    create: here.create,
    reuse: here.reuse,
    extend: here.extend,
    collisions: here.collisions,
    blocked,
  };
}

/* ── Checking ────────────────────────────────────────────────────────────── */

export type SchemaCheck = {
  ok: boolean;
  /** How many things were looked at, for "12 checks passed". */
  checked: number;
  problems: string[];
};

/**
 * Whether what the app needs is actually in the database, after the migration.
 *
 * Every table, every column with a compatible type, row-level security on,
 * every policy by name, the select grant for signed-in users (and for visitors
 * where a policy lets them in), the admin function, and every bucket.
 */
export function verifySchema(model: DataModel, snapshot: Snapshot): SchemaCheck {
  const problems: string[] = [];
  let checked = 0;

  if (model.schema !== "public" && model.tables.length > 0) {
    checked += 1;
    if (!snapshot.schemas.includes(model.schema)) problems.push(`the schema ${model.schema} does not exist`);
  }

  for (const table of model.tables) {
    checked += 1;
    const found = snapshot.tables.find((t) => t.schema === model.schema && t.name === table.name);
    if (!found) {
      problems.push(`table ${table.name} is missing`);
      continue;
    }

    for (const column of table.columns) {
      checked += 1;
      const existing = found.columns.find((c) => c.name === column.name);
      if (!existing) problems.push(`${table.name}.${column.name} is missing`);
      else if (!sameType(column.type, existing.type)) {
        problems.push(`${table.name}.${column.name} is ${existing.type}, expected ${column.type}`);
      }
    }

    checked += 1;
    if (!found.rls) problems.push(`row-level security is off on ${table.name}`);

    for (const policy of table.policies) {
      checked += 1;
      if (!found.policies.includes(policy.name)) problems.push(`policy ${policy.name} on ${table.name} is missing`);
    }

    /* The grants the policies need, per role — no more is expected, because
       toSql grants no more. A table visitors may only add to is not a table
       visitors must be able to read. */
    for (const role of ["authenticated", "anon"] as const) {
      const who = role === "anon" ? "visitors" : "signed-in users";
      for (const command of grantsFor(table, role)) {
        checked += 1;
        const held = found.privileges
          ? found.privileges[role].includes(command)
          : command === "select"
            ? role === "anon"
              ? found.anonSelect
              : found.authenticatedSelect
            : true;
        if (!held) {
          problems.push(
            command === "select"
              ? `${who} cannot read ${table.name}`
              : `${who} cannot ${command} ${command === "insert" ? "into" : "on"} ${table.name}`,
          );
        }
      }
    }
  }

  if (model.tables.some((table) => table.name === "profiles")) {
    checked += 1;
    if (!snapshot.functions.some((f) => f.schema === model.schema && f.name === "is_admin")) {
      problems.push("the is_admin() function is missing");
    }
  }

  for (const bucket of model.buckets) {
    checked += 1;
    if (!snapshot.buckets.some((b) => b.id === bucket.name)) problems.push(`storage bucket ${bucket.name} is missing`);
  }

  return { ok: problems.length === 0, checked, problems };
}

/** The scan and check, as the owner reads them. */
export function describeCheck(check: SchemaCheck, plan?: SchemaPlan): string {
  const where = plan?.isolated
    ? ` in its own schema, ${plan.schema}, because your Supabase already had ${plan.collisions
        .map((c) => c.name)
        .join(", ")}`
    : "";
  if (check.ok) return `Database ready — ${check.checked} checks passed${where}.`;
  const shown = check.problems.slice(0, 3).join("; ");
  const more = check.problems.length > 3 ? ` (and ${check.problems.length - 3} more)` : "";
  return `Database check found ${check.problems.length} ${check.problems.length === 1 ? "problem" : "problems"}: ${shown}${more}.`;
}
