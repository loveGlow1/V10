/* The database debugger: a failed statement read for what actually went
 * wrong, before anything is tried again.
 *
 * A dry run that fails used to be retried once with the raw error pasted
 * back — which repairs a typo and repeats every real mistake. This names the
 * error the way a database engineer would (which object, which kind of
 * problem), says what the fix is and, as importantly, what the fix must
 * never be: RLS is not turned off to get past a policy, and a table is not
 * dropped to get past a conflict. The planner (service.ts planChange) uses
 * it in a bounded loop — at most MAX_REPAIRS attempts, never the same SQL
 * twice — and says plainly when a person is needed.
 *
 * Pure (tools/check-db-agent.mjs). */

export const MAX_REPAIRS = 3;

export type PgDiagnosis = {
  category: string;
  /** The object the error is about, when Postgres names one. */
  object: string | null;
  /** What went wrong, in plain words. */
  cause: string;
  /** What the corrected SQL should do. */
  fix: string;
};

type Rule = { match: RegExp; category: string; cause: (object: string | null) => string; fix: string };

/* Most specific first: "column … of relation …" must be read as a column
   before the relation rules see the word "relation". */
const RULES: Rule[] = [
  { match: /column "([^"]+)"(?: of relation "[^"]+")? does not exist/i, category: "missing column", cause: (o) => `Column ${o ?? ""} does not exist on that table.`, fix: "Use the column's real name from the database map, or add it first with ALTER TABLE … ADD COLUMN IF NOT EXISTS." },
  { match: /column "([^"]+)" of relation "[^"]+" already exists/i, category: "duplicate column", cause: (o) => `Column ${o ?? ""} already exists.`, fix: "Use ADD COLUMN IF NOT EXISTS, or leave the existing column as it is." },
  { match: /relation "([^"]+)" does not exist|table "([^"]+)" does not exist/i, category: "missing relation", cause: (o) => `${o ?? "A table"} does not exist yet — it is referenced before it is created, or under the wrong schema or name.`, fix: "Create the referenced table first in the same migration (order statements by dependency), or reference the existing table by its real schema-qualified name from the database map." },
  { match: /relation "([^"]+)" already exists/i, category: "duplicate table", cause: (o) => `${o ?? "That table"} already exists.`, fix: "Do not recreate it. Use CREATE TABLE IF NOT EXISTS, or ALTER the existing table to add only what is missing. Never drop it." },
  { match: /policy "([^"]+)" for table "[^"]+" already exists/i, category: "duplicate policy", cause: (o) => `Policy ${o ?? ""} already exists.`, fix: "Drop and recreate only that policy with DROP POLICY IF EXISTS … then CREATE POLICY, or give the new policy a different name." },
  { match: /(?:index|constraint|function|type|trigger) "([^"]+)" already exists/i, category: "duplicate object", cause: (o) => `${o ?? "That object"} already exists.`, fix: "Use IF NOT EXISTS / CREATE OR REPLACE where Postgres supports it, or reuse the existing object." },
  { match: /violates foreign key constraint "([^"]+)"/i, category: "foreign key violation", cause: (o) => `Rows would point at rows that do not exist (${o ?? "a foreign key"}).`, fix: "Add the constraint NOT VALID and validate after the data is fixed, or insert the referenced rows first. Never delete existing rows to make it pass." },
  { match: /violates unique constraint "([^"]+)"|could not create unique index "([^"]+)"/i, category: "unique violation", cause: (o) => `Existing rows already repeat the values that ${o ?? "the unique rule"} forbids.`, fix: "Find and report the duplicates rather than deleting them; add the unique rule only on data that satisfies it, or make it unique on a narrower set of columns." },
  { match: /violates not-null constraint|contains null values/i, category: "not-null violation", cause: () => "Existing rows have no value for a column being made required.", fix: "Add the column as nullable with a DEFAULT, backfill it, then set NOT NULL — or keep it optional." },
  { match: /invalid input syntax for type|type "([^"]+)" does not exist|cannot be cast automatically to type/i, category: "invalid type", cause: (o) => `A value or type does not fit (${o ?? "type mismatch"}).`, fix: "Use a real PostgreSQL type (uuid, text, numeric(12,2) for money, timestamptz, jsonb) and an explicit USING cast when changing a column's type." },
  { match: /permission denied for (?:table|schema|relation|function|sequence) ([\w."]+)|must be owner of/i, category: "permission denied", cause: (o) => `The connection is not allowed to change ${o ?? "that object"}.`, fix: "Do not touch objects owned by Supabase (auth, storage); change only the app's own tables. Never disable RLS to get around this." },
  { match: /new row violates row-level security policy|row-level security/i, category: "RLS policy violation", cause: () => "A policy rejected the row.", fix: "Correct the policy's USING / WITH CHECK so the signed-in owner passes. Never disable row-level security." },
  { match: /function ([\w.]+)\([^)]*\) does not exist/i, category: "missing function", cause: (o) => `${o ?? "A function"} does not exist with those argument types.`, fix: "Create the function first (with a pinned search_path), or call the existing one with matching argument types." },
  { match: /extension "([^"]+)"|could not open extension control file/i, category: "missing extension", cause: (o) => `The ${o ?? "required"} extension is not installed.`, fix: "Add CREATE EXTENSION IF NOT EXISTS <name> WITH SCHEMA extensions first, or use a built-in alternative (gen_random_uuid() needs none)." },
  { match: /cannot drop .* because other objects depend on it|depends on/i, category: "dependency conflict", cause: () => "Other objects depend on what is being changed.", fix: "Change the dependent objects first, in order. Never use CASCADE to delete them silently." },
  { match: /syntax error at or near "([^"]*)"/i, category: "syntax error", cause: (o) => `The SQL is not valid near "${o ?? ""}".`, fix: "Rewrite that statement as valid PostgreSQL; check commas, parentheses and quoting." },
  { match: /trigger|tg_op|new\.|old\./i, category: "trigger error", cause: () => "A trigger or its function failed.", fix: "Fix the trigger function (its body and search_path) before creating the trigger that calls it." },
];

/** A PostgreSQL error, read. Never throws; an unknown error is still returned. */
export function diagnosePgError(error: string): PgDiagnosis {
  const text = (error ?? "").slice(0, 2000);
  for (const rule of RULES) {
    const match = rule.match.exec(text);
    if (match) {
      const object = match.slice(1).find(Boolean) ?? null;
      return { category: rule.category, object, cause: rule.cause(object), fix: rule.fix };
    }
  }
  return { category: "unrecognised error", object: null, cause: text.split("\n")[0] || "The statement failed.", fix: "Read the error, check the objects it names against the database map, and correct only that statement." };
}

/** The repair request handed to the SQL engineer for one attempt. */
export function repairPrompt(request: string, failedSql: string, error: string, attempt: number): string {
  const d = diagnosePgError(error);
  return [
    request,
    "",
    `REPAIR ATTEMPT ${attempt} of ${MAX_REPAIRS}. The previous SQL failed in a dry run (nothing was changed).`,
    `Error category: ${d.category}${d.object ? ` (${d.object})` : ""}.`,
    `Cause: ${d.cause}`,
    `Fix: ${d.fix}`,
    "Rules for this repair: never disable row-level security; never drop or truncate an existing table or delete rows to make it pass; never use CASCADE; keep every change additive where possible; correct only what failed.",
    `PostgreSQL said: ${error.slice(0, 800)}`,
    "",
    "Previous SQL:",
    failedSql,
  ].join("\n");
}

/** The same SQL, ignoring whitespace and case — so a repair never runs the same statement twice. */
export const sqlFingerprint = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
