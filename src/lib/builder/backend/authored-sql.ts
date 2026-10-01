/* The tables an app was written against, made real when nothing else did.
 *
 * A build's tables come from dataModelFor, plus — for a web app — a schema the
 * model designs and app-schema.ts checks. When that design is refused or
 * fails, the build quietly keeps the starter tables (`profiles`, `media`). The
 * page generator is told nothing of that and does what the person asked for:
 * it writes a dashboard that reads `favorites` and `viewing_requests`, and
 * writes the SQL for them into lib/schema.sql. Nothing ever ran that file. So
 * the app shipped querying tables that were not there, and the customer saw
 * "Could not find the table 'public.favorites' in the schema cache" on their
 * own dashboard.
 *
 * This is the safety net, applied when the files land: the tables the code
 * queries and the database does not have, created from the SQL the build
 * wrote for them — made safe to run twice, and refused outright if it would
 * destroy anything or do anything but create. Pure: the running is the save
 * route's, through the same runner provisioning uses. */

import type { FileTree } from "@/lib/builder/tree";

/* A query on a table — the client's from() with a table name — but not
   storage's from(), which names a bucket. */
const QUERIED = /(?<!storage)\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g;

/** Tables the code reads or writes that are not among `known`. */
export function missingTables(tree: FileTree, known: readonly string[]): string[] {
  const have = new Set(known.map((name) => name.toLowerCase()));
  const wanted = new Set<string>();
  for (const file of tree) {
    if (!/\.(?:tsx?|jsx?)$/.test(file.path)) continue;
    for (const match of file.content.matchAll(QUERIED)) wanted.add(match[1].toLowerCase());
  }
  return [...wanted].filter((name) => !have.has(name)).sort();
}

/* The SQL a build writes for its tables: lib/schema.sql by convention, or a
   migration under supabase/. */
export function authoredSql(tree: FileTree): { path: string; sql: string } | null {
  const file =
    tree.find((entry) => entry.path === "lib/schema.sql") ??
    tree.find((entry) => /^supabase\/(?:migrations\/)?[^/]+\.sql$/.test(entry.path));
  return file ? { path: file.path, sql: file.content } : null;
}

/* Comments out, so a word inside one cannot be read as a statement. */
function bare(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/* Split on semicolons that end statements, not ones inside a $$ body. */
function statements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let inDollar = false;
  for (let i = 0; i < sql.length; i += 1) {
    if (sql.startsWith("$$", i)) {
      inDollar = !inDollar;
      current += "$$";
      i += 1;
      continue;
    }
    const ch = sql[i];
    if (ch === ";" && !inDollar) {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/* What may run. Everything here creates or tightens; nothing removes, renames,
   rewrites or reads a row. Anything else refuses the whole file. */
const ALLOWED = [
  /^create\s+type\s+/i,
  /^create\s+table\s+/i,
  /^create\s+(?:unique\s+)?index\s+/i,
  /^alter\s+table\s+(?:if\s+exists\s+)?[\w."]+\s+enable\s+row\s+level\s+security$/i,
  /^alter\s+table\s+(?:if\s+exists\s+)?[\w."]+\s+add\s+column\s+/i,
  /^create\s+policy\s+/i,
  /^comment\s+on\s+/i,
  /^create\s+extension\s+if\s+not\s+exists\s+/i,
];

export type Prepared =
  | { ok: true; sql: string; tables: string[] }
  | { ok: false; reason: string };

/**
 * The authored SQL, made idempotent, or the reason it will not be run.
 *
 * `schema` is where the app's tables live; anything but `public` is set as the
 * search path first, so unqualified names land where the app reads them.
 */
export function prepareAuthoredSql(sql: string, schema = "public"): Prepared {
  const parts = statements(bare(sql));
  if (parts.length === 0) return { ok: false, reason: "the schema file is empty" };

  const out: string[] = [];
  const tables: string[] = [];

  for (const raw of parts) {
    const statement = raw.replace(/\s+/g, " ").trim();
    if (!ALLOWED.some((pattern) => pattern.test(statement))) {
      return {
        ok: false,
        reason: `it contains a statement that does more than create: "${statement.slice(0, 80)}${statement.length > 80 ? "…" : ""}"`,
      };
    }

    let match: RegExpMatchArray | null;
    if ((match = statement.match(/^create\s+type\s+([\w."]+)\s+(as\s+[\s\S]+)$/i))) {
      /* Postgres has no `create type if not exists`; this is the usual form. */
      out.push(
        `do $$ begin create type ${match[1]} ${match[2]}; exception when duplicate_object then null; end $$`,
      );
    } else if ((match = statement.match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)([\s\S]*)$/i))) {
      tables.push(match[1].replace(/"/g, "").split(".").pop() as string);
      out.push(`create table if not exists ${match[1]}${match[2]}`);
    } else if ((match = statement.match(/^create\s+(unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([\s\S]+)$/i))) {
      out.push(`create ${match[1] ?? ""}index if not exists ${match[2]}`);
    } else if ((match = statement.match(/^(alter\s+table\s+(?:if\s+exists\s+)?[\w."]+\s+add\s+column\s+)(?:if\s+not\s+exists\s+)?([\s\S]+)$/i))) {
      out.push(`${match[1]}if not exists ${match[2]}`);
    } else if ((match = statement.match(/^create\s+policy\s+("[^"]+"|\w+)\s+on\s+([\w."]+)/i))) {
      out.push(`drop policy if exists ${match[1]} on ${match[2]}`, statement);
    } else {
      out.push(statement);
    }
  }

  const prefix = schema === "public" ? [] : [`set search_path to "${schema.replace(/"/g, "")}", public`];
  /* PostgREST serves from a cache of the schema; without this the new tables
     answer "not in the schema cache" until it next reloads on its own. */
  const suffix = ["notify pgrst, 'reload schema'"];
  return { ok: true, sql: `${[...prefix, ...out, ...suffix].join(";\n")};\n`, tables };
}
