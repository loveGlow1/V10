/* The tables an application needs, written by the model and checked by us.
 *
 * dataModelFor beside this is a set of deterministic models, one per kind: a
 * store has products, orders and stock, a publication has posts and
 * categories. They are right because those kinds ARE their tables — every
 * store has a basket, and guessing is not involved.
 *
 * `webapp` has no such shape, and that is not an oversight in dataModelFor. A
 * CRM's tables are leads and accounts; a task tracker's are projects and tasks;
 * a members portal's are documents and grants. There is no set of tables that
 * is "a web app", so a deterministic model for the kind could only ever have
 * been a generic one — a `records` table with a jsonb column, which is a
 * database in the same sense that a cardboard box is a filing cabinet.
 *
 * So dataModelFor answered with nothing, and an application got a schema
 * holding `profiles` and, without accounts, holding nothing at all. That is
 * the whole of "the app is a demo": lib/supabase.ts was written, the client
 * was pointed at an empty schema, schemaBrief returned the empty string
 * because there were no tables to describe, and the model was told to write an
 * application and given nowhere to put anything. What comes back then is a
 * working interface over hardcoded arrays.
 *
 * ── The model proposes; this file decides ─────────────────────────────────
 *
 * Everything below the call is the important half. What comes back is JSON
 * from a language model and it is on its way into a migration that will be run
 * by a machine against a database holding somebody's real rows — so it is
 * treated as what it is, which is untrusted input that happens to be
 * well-intentioned.
 *
 * Nothing is repaired. A proposal that breaks a rule is REFUSED whole, with
 * the reason, and the build carries on with whatever dataModelFor gave it:
 * a table that is nearly right is worse than no table, because the app will be
 * written against it and the defect is found by a customer rather than here.
 *
 * The rules are schema.ts's own, restated as checks rather than as convention:
 * every table carries RLS and at least one policy behind it (toSql refuses
 * otherwise, and a table reaching Postgres without one is readable by anybody
 * who opens the network tab), identifiers are identifiers, and no expression
 * may carry a statement separator or a comment opener into SQL that is
 * assembled by string concatenation. provision.ts then reads the rendered
 * migration for destructive verbs before a connection is opened, which is the
 * second gate and stays exactly as it is.
 */

import type { ArchitectureManifest } from "./architecture";
import type { Column, ColumnType, DataModel, Policy, Table } from "./schema";

/* Sonnet rather than Haiku, and this is the one place in the builder where
   that is not about quality of prose. A schema is the one artefact in a
   project that cannot be edited afterwards without a migration — every file
   above it can be rewritten for free, and a column named wrong is somebody's
   data in the wrong shape forever. It is also a small call: a dozen tables of
   JSON, once per build. */
const SCHEMA_MODEL = "claude-sonnet-5";

const MAX_TOKENS = 4000;

/* Bounds, all of them chosen to be far above a real application and far below
   anything that could be an attack or a runaway. An app needing more than this
   is one somebody should be talking to us about. */
const MAX_TABLES = 12;
const MAX_COLUMNS = 24;
const MAX_POLICIES = 6;
const MAX_EXPRESSION = 400;

/** Identifiers, as Postgres and as we are willing to emit them unquoted. */
const IDENTIFIER = /^[a-z][a-z0-9_]{0,61}$/;

const COLUMN_TYPES: ReadonlySet<string> = new Set<ColumnType>([
  "uuid",
  "text",
  "integer",
  "bigint",
  "numeric",
  "boolean",
  "timestamptz",
  "jsonb",
]);

const POLICY_ACTIONS: ReadonlySet<string> = new Set(["select", "insert", "update", "delete", "all"]);
const POLICY_ROLES: ReadonlySet<string> = new Set(["anon", "authenticated"]);

/* Names dataModelFor writes itself. A proposal reusing one would collide with
   the table this platform already creates — and `profiles` in particular is
   the identity table, whose policies are the reason a role cannot be
   self-granted. It is not up for redefinition. */
const RESERVED_TABLES: ReadonlySet<string> = new Set([
  "profiles",
  "media",
  "categories",
  "products",
  "orders",
  "order_items",
  "posts",
]);

export type AuthoredSchema =
  | { ok: true; tables: Table[]; why: string }
  /* Every failure is a reason rather than an exception, like provisioning
     beside it: a build whose schema could not be authored is still a build,
     and the reason belongs in the step list rather than in a stack trace. */
  | { ok: false; reason: string };

/* ── What the model is asked for ──────────────────────────────────────────
 *
 * Domain columns ONLY. `id`, `created_at` and `updated_at` are added here
 * afterwards, the same three every table in schema.ts carries — asking for
 * them invites a proposal that gets one of them subtly wrong (a text id, a
 * created_at with no default) in the one place a mistake is permanent.
 *
 * The policy rules are stated as requirements rather than as advice because
 * they are the security model. A table whose rows belong to somebody carries
 * `owner_id` and policies that compare it to auth.uid(); a table of reference
 * data readable by everybody says so explicitly. There is no third option, and
 * "no policy" is refused by the validator below and by toSql after it. */
const SYSTEM = `You design Postgres schemas for generated applications on Supabase.

You answer with JSON and nothing else. No prose, no markdown fence, no explanation outside the JSON.

Shape:
{
  "why": "one sentence on what these tables are for",
  "tables": [
    {
      "name": "snake_case_plural",
      "what": "one sentence, emitted as a table comment",
      "columns": [
        { "name": "snake_case", "type": "uuid|text|integer|bigint|numeric|boolean|timestamptz|jsonb",
          "nullable": true, "default": "raw SQL", "unique": true,
          "references": { "table": "other_table|auth.users", "column": "id", "onDelete": "cascade" },
          "check": "expression without the surrounding CHECK()" }
      ],
      "indexes": [{ "on": ["column_name"] }],
      "policies": [
        { "name": "table_action_scope", "for": "select|insert|update|delete|all",
          "to": ["authenticated"], "using": "row test", "check": "incoming row test",
          "why": "one sentence, on one line" }
      ]
    }
  ]
}

RULES — a proposal breaking any of these is discarded whole:

1. Do NOT include id, created_at or updated_at. They are added for you: id uuid primary key default gen_random_uuid(), created_at and updated_at timestamptz default now().
2. Every table MUST have at least one policy. Row-level security is the only thing protecting this data — the app has no server-side secret and the anon key is public.
3. Rows belonging to a person carry owner_id uuid references auth.users, and their policies compare owner_id = auth.uid(). Never write a policy that lets one person read another's rows unless the data is genuinely public.
4. Reference data everybody may read gets a select policy to ["anon","authenticated"] with using "true", and NO insert, update or delete policy — generated apps do not let visitors write reference data.
5. Expressions in using/check are single expressions. No semicolons, no SQL comments, no statement of any kind.
6. Names are lowercase snake_case, start with a letter, and are at most 63 characters.
7. references.table names another table in this proposal, or exactly "auth.users".
8. Model the application that was described and nothing else. No speculative tables, no "settings" table nobody asked for, no analytics.
9. At most ${MAX_TABLES} tables, ${MAX_COLUMNS} columns each.`;

function prompt(brief: string, manifest: ArchitectureManifest): string {
  const layers = [
    manifest.authentication ? "People sign in. A `profiles` table already exists (id references auth.users, email, full_name, avatar_url, role) — do NOT propose it, and reference auth.users for ownership." : "Nobody signs in. There are no accounts, so ownership cannot be by auth.uid() — model this as data the app reads and writes without an identity behind it, and say so in the policies.",
    manifest.storage ? "Files are uploaded. A `media` table already exists — do not propose it, but reference it where a row points at a file." : null,
    manifest.payments ? "Money changes hands, so what was paid for has to be recorded as rows." : null,
    manifest.admin ? "There is an admin side. `is_admin()` is available in policies." : null,
  ].filter((line): line is string => typeof line === "string");

  return `What was asked for:

${brief.trim().slice(0, 4000)}

What this project has:
${layers.map((line) => `- ${line}`).join("\n")}

Design the tables this application needs to actually work. Answer with the JSON and nothing else.`;
}

/* The JSON out of an answer that may be wrapped despite being asked not to.
 *
 * A fence is the one deviation worth surviving rather than refusing: it is
 * formatting, it changes nothing about what was proposed, and refusing a
 * correct schema over three backticks would throw away the call. Anything else
 * that does not parse is refused. */
function jsonFrom(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  const body = fenced ? fenced[1] : trimmed;

  try {
    return JSON.parse(body);
  } catch {
    /* An object that begins somewhere in a sentence. Last resort, and still a
       parse rather than a repair: if the braces do not enclose valid JSON this
       fails like anything else. */
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/* An expression on its way into `using (...)` or `with check (...)`, which
   schema.ts assembles by concatenation. Everything refused here is something
   that would end the expression and begin something else. */
function expressionProblem(value: unknown, where: string): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return `${where} is empty`;
  }
  if (value.length > MAX_EXPRESSION) return `${where} is longer than an expression should be`;
  if (value.includes(";")) return `${where} contains a statement separator`;
  if (value.includes("--") || value.includes("/*") || value.includes("*/")) {
    return `${where} contains a SQL comment`;
  }
  /* Balanced parentheses, because an unbalanced one silently swallows the rest
     of the statement that schema.ts wraps around it. */
  let depth = 0;
  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) return `${where} closes a bracket it never opened`;
  }
  if (depth !== 0) return `${where} leaves a bracket open`;

  return null;
}

/* A sentence on its way into a `-- comment` line above a policy. One line, or
   it stops being a comment halfway through. */
function sentence(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 240);
}

function readColumn(raw: unknown, tableNames: Set<string>, table: string): Column | string {
  if (!raw || typeof raw !== "object") return `${table} has a column that is not an object`;
  const it = raw as Record<string, unknown>;

  const name = typeof it.name === "string" ? it.name.trim().toLowerCase() : "";
  if (!IDENTIFIER.test(name)) return `${table}.${name || "?"} is not a usable column name`;

  /* Silently dropped rather than refused: the model was told not to send these
     and sending them anyway is it agreeing with us about what a table needs.
     They are added by the caller, correctly, either way. */
  if (name === "id" || name === "created_at" || name === "updated_at") return `__skip__`;

  const type = typeof it.type === "string" ? it.type.trim().toLowerCase() : "";
  if (!COLUMN_TYPES.has(type)) return `${table}.${name} has an unknown type "${type}"`;

  const column: Column = { name, type: type as ColumnType };

  if (it.nullable === true) column.nullable = true;
  if (it.unique === true) column.unique = true;

  if (typeof it.default === "string" && it.default.trim().length > 0) {
    const problem = expressionProblem(it.default, `${table}.${name} default`);
    if (problem) return problem;
    column.default = it.default.trim();
  }

  if (typeof it.check === "string" && it.check.trim().length > 0) {
    const problem = expressionProblem(it.check, `${table}.${name} check`);
    if (problem) return problem;
    column.check = it.check.trim();
  }

  if (it.references && typeof it.references === "object") {
    const ref = it.references as Record<string, unknown>;
    const target = typeof ref.table === "string" ? ref.table.trim().toLowerCase() : "";

    /* auth.users, or a table in this same proposal. A reference to anything
       else is a foreign key to a table that will not exist when the migration
       runs, which fails the whole migration rather than one table. */
    const known = target === "auth.users" || tableNames.has(target) || RESERVED_TABLES.has(target);
    if (!known) return `${table}.${name} references "${target}", which is not a table here`;

    const referenceColumn =
      typeof ref.column === "string" && IDENTIFIER.test(ref.column.trim().toLowerCase())
        ? ref.column.trim().toLowerCase()
        : "id";

    const onDelete = ref.onDelete === "cascade" || ref.onDelete === "set null" ? ref.onDelete : undefined;

    column.references = { table: target, column: referenceColumn, ...(onDelete ? { onDelete } : {}) };
  }

  return column;
}

function readPolicy(raw: unknown, table: string): Policy | string {
  if (!raw || typeof raw !== "object") return `${table} has a policy that is not an object`;
  const it = raw as Record<string, unknown>;

  const name = typeof it.name === "string" ? it.name.trim().toLowerCase() : "";
  if (!IDENTIFIER.test(name)) return `${table} has a policy named "${name || "?"}", which is not usable`;

  const action = typeof it.for === "string" ? it.for.trim().toLowerCase() : "";
  if (!POLICY_ACTIONS.has(action)) return `${table}.${name} is for "${action}", which is not an action`;

  const to = Array.isArray(it.to)
    ? it.to
        .map((role) => (typeof role === "string" ? role.trim().toLowerCase() : ""))
        .filter((role) => POLICY_ROLES.has(role))
    : [];
  if (to.length === 0) return `${table}.${name} applies to nobody`;

  const policy: Policy = {
    name,
    for: action as Policy["for"],
    to: to as Policy["to"],
    why: sentence(it.why, "No reason was given for this policy."),
  };

  if (typeof it.using === "string" && it.using.trim().length > 0) {
    const problem = expressionProblem(it.using, `${table}.${name} using`);
    if (problem) return problem;
    policy.using = it.using.trim();
  }

  if (typeof it.check === "string" && it.check.trim().length > 0) {
    const problem = expressionProblem(it.check, `${table}.${name} check`);
    if (problem) return problem;
    policy.check = it.check.trim();
  }

  /* A policy that tests nothing allows everything, which for an insert or an
     update is a table anybody may write. Postgres permits it; this does not. */
  if (!policy.using && !policy.check) {
    return `${table}.${name} tests nothing, so it would allow everything`;
  }

  return policy;
}

/** The three columns every table in schema.ts carries, added rather than asked for. */
function base(): Column[] {
  return [
    { name: "id", type: "uuid", primaryKey: true, default: "gen_random_uuid()" },
    { name: "created_at", type: "timestamptz", default: "now()" },
    { name: "updated_at", type: "timestamptz", default: "now()" },
  ];
}

/**
 * Turns a proposal into tables, or says why it will not.
 *
 * Exported for its own sake: this is the half worth testing without a network,
 * and tools/check-app-schema.mjs runs it over proposals that are wrong in each
 * of the ways that matter.
 */
export function readProposal(parsed: unknown): AuthoredSchema {
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "the answer was not an object" };
  const body = parsed as Record<string, unknown>;

  const raw = Array.isArray(body.tables) ? body.tables : null;
  if (!raw || raw.length === 0) return { ok: false, reason: "no tables were proposed" };
  if (raw.length > MAX_TABLES) return { ok: false, reason: `${raw.length} tables is more than an app needs` };

  /* Names first, so a reference from the first table to the last one resolves.
     Read in two passes for exactly that reason. */
  const names = new Set<string>();
  for (const entry of raw) {
    const name =
      entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string"
        ? (entry as { name: string }).name.trim().toLowerCase()
        : "";
    if (!IDENTIFIER.test(name)) return { ok: false, reason: `"${name || "?"}" is not a usable table name` };
    if (RESERVED_TABLES.has(name)) {
      return { ok: false, reason: `"${name}" is a table this platform writes itself` };
    }
    if (names.has(name)) return { ok: false, reason: `"${name}" was proposed twice` };
    names.add(name);
  }

  const tables: Table[] = [];

  for (const entry of raw) {
    const it = entry as Record<string, unknown>;
    const name = (it.name as string).trim().toLowerCase();

    const columnsRaw = Array.isArray(it.columns) ? it.columns : [];
    if (columnsRaw.length > MAX_COLUMNS) {
      return { ok: false, reason: `${name} has more columns than a table should` };
    }

    const columns: Column[] = base();
    const seen = new Set(columns.map((column) => column.name));

    for (const rawColumn of columnsRaw) {
      const column = readColumn(rawColumn, names, name);
      if (typeof column === "string") {
        if (column === "__skip__") continue;
        return { ok: false, reason: column };
      }
      if (seen.has(column.name)) return { ok: false, reason: `${name}.${column.name} appears twice` };
      seen.add(column.name);
      columns.push(column);
    }

    /* A table of nothing but the three columns every table has is not a table
       anybody asked for — it is the model agreeing that something belongs here
       without saying what. */
    if (columns.length === base().length) {
      return { ok: false, reason: `${name} has no columns of its own` };
    }

    const policiesRaw = Array.isArray(it.policies) ? it.policies : [];
    if (policiesRaw.length === 0) {
      /* THE ONE. toSql refuses this too, and it is caught here so the reason
         names the table rather than arriving as a thrown migration error. */
      return { ok: false, reason: `${name} has no policy, so nothing would protect its rows` };
    }
    if (policiesRaw.length > MAX_POLICIES) {
      return { ok: false, reason: `${name} has more policies than it can need` };
    }

    const policies: Policy[] = [];
    const policyNames = new Set<string>();
    for (const rawPolicy of policiesRaw) {
      const policy = readPolicy(rawPolicy, name);
      if (typeof policy === "string") return { ok: false, reason: policy };
      if (policyNames.has(policy.name)) {
        return { ok: false, reason: `${name} has two policies called ${policy.name}` };
      }
      policyNames.add(policy.name);
      policies.push(policy);
    }

    const indexes = Array.isArray(it.indexes)
      ? it.indexes
          .map((index) => {
            const on = index && typeof index === "object" ? (index as { on?: unknown }).on : null;
            const columnsOn = Array.isArray(on)
              ? on
                  .map((column) => (typeof column === "string" ? column.trim().toLowerCase() : ""))
                  .filter((column) => seen.has(column))
              : [];
            return columnsOn.length > 0 ? { on: columnsOn } : null;
          })
          .filter((index): index is { on: string[] } => index !== null)
      : [];

    tables.push({
      name,
      what: sentence(it.what, `Rows for ${name}.`),
      columns,
      ...(indexes.length > 0 ? { indexes } : {}),
      policies,
    });
  }

  return { ok: true, tables, why: sentence(body.why, "The tables this application needs.") };
}

/**
 * Asks the model for this application's tables.
 *
 * Never throws. Every failure is a reason, and the caller carries on with
 * whatever dataModelFor already gave it — which for a web app is `profiles` or
 * nothing, exactly as before this existed. A build that loses its domain
 * tables is a worse build; a build that dies over them is not a build.
 */
export async function authorSchema(input: {
  brief: string;
  manifest: ArchitectureManifest;
}): Promise<AuthoredSchema> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, reason: "this workspace has no ANTHROPIC_API_KEY, so no schema could be designed" };
  }
  if (!input.brief || input.brief.trim().length === 0) {
    return { ok: false, reason: "there is nothing describing what this app is" };
  }

  try {
    /* Imported here rather than at the top of the file, the same way
       provision.ts imports `pg`: everything above this function is pure — the
       validator, the bounds, the rules — and it is the half worth reading and
       testing on its own. A static import of the SDK and of the model
       catalogue would make that impossible, which is exactly what
       tools/check-app-schema.mjs found when it could not load this module to
       check a refusal. */
    const [{ default: Anthropic }, { modelById }] = await Promise.all([
      import("@anthropic-ai/sdk"),
      import("@/app/dashboard/models"),
    ]);

    const answer = await new Anthropic().messages.create({
      model: modelById(SCHEMA_MODEL).apiId ?? SCHEMA_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt(input.brief, input.manifest) }],
    });

    const text = answer.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    if (!text) return { ok: false, reason: "the schema request came back empty" };

    const parsed = jsonFrom(text);
    if (parsed === null) return { ok: false, reason: "the schema came back as something other than JSON" };

    return readProposal(parsed);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "the schema could not be designed",
    };
  }
}

/** The authored tables merged into whatever dataModelFor already produced. */
export function withAuthored(model: DataModel, tables: Table[]): DataModel {
  /* dataModelFor's tables win on a collision. They are the deterministic ones —
     `profiles` above all — and their policies are the reason a role cannot be
     self-granted. RESERVED_TABLES refuses these upstream, so this is the belt
     to that braces. */
  const held = new Set(model.tables.map((table) => table.name));
  return {
    ...model,
    tables: [...model.tables, ...tables.filter((table) => !held.has(table.name))],
  };
}
