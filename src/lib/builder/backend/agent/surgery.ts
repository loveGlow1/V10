/* Changing a live database safely: the plan, before anything runs.
 *
 * A surgery is a migration with everything somebody needs to decide on it:
 * what it does in plain words, the risk of each statement, which tables it
 * touches and how many rows they hold, the SQL to undo it, a backup of what it
 * could destroy, and — for anything destructive — the exact phrase they must
 * type to approve it. Nothing here runs SQL. tools.ts dry-runs the plan,
 * shows it, and applies it only with an approval token.
 *
 * The procedure the planner enforces, whatever SQL it is handed:
 *
 *   - Never rename in place. `rename column a to b` becomes: add b, copy a
 *     into b, keep a until the owner confirms it can go.
 *   - Enabling RLS on a table: its policies are created FIRST, in the same
 *     migration. RLS with no policy at all is refused — it locks the app out.
 *   - Large tables: an index is built CONCURRENTLY, outside the transaction,
 *     and the lock is warned about.
 *   - On a production database, UPDATE or DELETE without a WHERE clause is
 *     refused outright, and with one, the rows it would touch are counted and
 *     shown first.
 *   - L2 and L3 snapshot every table they touch before running.
 *
 * Pure. Asserted by tools/check-db-agent.mjs.
 */

import type { DatabaseMap, MapTable } from "./db-map";
import { qualified } from "./db-map";
import {
  type Classified,
  type RiskLevel,
  RISK_LABEL,
  classifyStatement,
  overallLevel,
  tokenize,
} from "./sql-guard";

export const BACKUP_SCHEMA = "qs_backups";
export const BACKUP_DAYS = 7;
const LARGE = 100_000;

export type PlannedStatement = Classified & { label: string; rollback: string };

export type SurgeryPlan = {
  name: string;
  summary: string;
  level: RiskLevel;
  statements: PlannedStatement[];
  /** Runs as one transaction. */
  migration: string;
  /** CREATE INDEX CONCURRENTLY: after the transaction, one at a time. */
  concurrent: string[];
  rollback: string;
  affected: { table: string; rows: number }[];
  /** Tables snapshotted before L2/L3 runs, as `schema.table`. */
  backups: string[];
  /** Counts to show before an UPDATE/DELETE runs: one read per statement. */
  previews: { statement: string; countSql: string }[];
  /** For L3: the phrase that must be typed, e.g. "DROP notes". */
  confirmation: string | null;
  /** Why it must not run as written. Non-empty means no Approve button. */
  refused: string[];
  warnings: string[];
  /** What the planner rewrote, said plainly (renames, reordering). */
  rewrites: string[];
};

const id = (s: string) => (/^[a-z_][a-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);

/** `schema.table` for a name as SQL wrote it, resolving an unqualified one against the map. */
export function resolveTable(name: string | null, map: DatabaseMap): MapTable | null {
  if (!name) return null;
  const [a, b] = name.includes(".") ? name.split(".") : [null, name];
  return map.tables.find((t) => t.name === b && (a ? t.schema === a : t.schema === "public")) ?? map.tables.find((t) => t.name === b && !a) ?? null;
}

const keyOf = (t: MapTable) => `${t.schema}.${t.name}`;

export function migrationName(summary: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const slug = summary.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "change";
  return `${stamp}_${slug}`;
}

export function backupNameFor(table: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 12);
  return `_qs_backup_${table.replace(/[^a-z0-9_]/gi, "_").slice(0, 30)}_${stamp}`;
}

/** The snapshot of one table, unreachable from the API: its own schema, no grants. */
export function backupSql(table: MapTable, now = new Date()): { sql: string; name: string } {
  const name = backupNameFor(table.name, now);
  return {
    name: `${BACKUP_SCHEMA}.${name}`,
    sql: [
      `create schema if not exists ${BACKUP_SCHEMA};`,
      `revoke all on schema ${BACKUP_SCHEMA} from anon, authenticated;`,
      `create table ${BACKUP_SCHEMA}.${id(name)} as table ${qualified(table.schema, table.name)};`,
      `comment on table ${BACKUP_SCHEMA}.${id(name)} is 'QuickStark backup of ${table.schema}.${table.name}, taken before a database change. Safe to remove after ${BACKUP_DAYS} days.';`,
    ].join("\n"),
  };
}

/* ── Rewrites ─────────────────────────────────────────────────────────────── */

const RENAME_COLUMN = /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+rename\s+(?:column\s+)?([\w"]+)\s+to\s+([\w"]+)\s*$/i;

/** A rename, as add + backfill. The old column stays until the owner removes it. */
export function renameAsCopy(table: MapTable, from: string, to: string): string {
  const column = table.columns.find((c) => c.name === from);
  const type = column?.type ?? "text";
  const name = qualified(table.schema, table.name);
  return [
    `alter table ${name} add column if not exists ${id(to)} ${type}${column?.default ? ` default ${column.default}` : ""}`,
    `update ${name} set ${id(to)} = ${id(from)} where ${id(to)} is distinct from ${id(from)}`,
  ].join(";\n");
}

/* ── Rollback ─────────────────────────────────────────────────────────────── */

function wordsOf(sql: string) {
  return tokenize(sql)[0]?.tokens ?? [];
}

function afterKeyword(sql: string, keyword: string): string | null {
  const t = wordsOf(sql);
  for (let i = 0; i < t.length; i += 1) {
    const w = t[i];
    if (w.kind === "word" && w.upper === keyword) {
      let j = i + 1;
      while (j < t.length && t[j].kind === "word" && ["IF", "NOT", "EXISTS", "CONCURRENTLY", "ONLY", "COLUMN", "CONSTRAINT"].includes((t[j] as { upper: string }).upper)) j += 1;
      const parts: string[] = [];
      while (j < t.length && (t[j].kind === "word" || t[j].kind === "ident")) {
        parts.push(t[j].kind === "ident" ? `"${t[j].text}"` : t[j].text);
        if (t[j + 1]?.kind === "punct" && t[j + 1].text === ".") j += 2;
        else break;
      }
      return parts.length ? parts.join(".") : null;
    }
  }
  return null;
}

function rollbackFor(s: Classified, map: DatabaseMap, backups: Map<string, string>): string {
  const sql = s.sql;
  const head = sql.replace(/\s+/g, " ").trim().toLowerCase();
  const table = resolveTable(s.table, map);
  const tname = table ? qualified(table.schema, table.name) : s.table ?? "?";
  const backup = table ? backups.get(keyOf(table)) : undefined;
  const pk = table?.primaryKey ?? [];

  if (/^create (unlogged )?table/.test(head)) return `drop table if exists ${s.table};`;
  if (/^create (unique )?index/.test(head)) {
    const name = afterKeyword(sql, "INDEX");
    const schema = s.table?.includes(".") ? `${s.table.split(".")[0]}.` : "";
    return name ? `drop index if exists ${name.includes(".") ? name : `${schema}${name}`};` : "-- index: drop it by name";
  }
  if (/^create policy/.test(head)) return `drop policy if exists ${afterKeyword(sql, "POLICY")} on ${s.table};`;
  if (/^create (or replace )?(function|procedure)/.test(head)) {
    const m = sql.match(/(?:function|procedure)\s+([\w."]+)\s*\(([^)]*)\)/i);
    if (/^create or replace/.test(head)) {
      const fn = map.functions.find((f) => m && f.name === m[1].split(".").pop());
      return fn ? `-- restore the previous ${fn.name}(): its definition is in the backup of db-map.json taken before this change` : `drop function if exists ${m?.[1]}(${m?.[2] ?? ""});`;
    }
    return m ? `drop ${/procedure/i.test(head) ? "procedure" : "function"} if exists ${m[1]}(${m[2].split(",").map((a) => a.trim().split(/\s+/).filter((w) => !/^(?:in|out|inout|variadic)$/i.test(w)).slice(-1)[0] ?? "").filter(Boolean).join(", ")});` : "-- function: drop it by name";
  }
  if (/^create (or replace )?(materialized )?view/.test(head)) return `drop ${/materialized/.test(head) ? "materialized " : ""}view if exists ${afterKeyword(sql, "VIEW")};`;
  if (/^create type/.test(head)) return `drop type if exists ${afterKeyword(sql, "TYPE")};`;
  if (/^create schema/.test(head)) return `drop schema if exists ${afterKeyword(sql, "SCHEMA")};`;
  if (/^create (constraint )?trigger/.test(head)) return `drop trigger if exists ${afterKeyword(sql, "TRIGGER")} on ${s.table};`;
  if (/^create extension/.test(head)) return `drop extension if exists ${afterKeyword(sql, "EXTENSION")};`;
  if (/^comment on/.test(head)) return "-- the previous description is kept in db-map.json from before this change";
  if (/^grant /.test(head)) return `${sql.replace(/^\s*grant/i, "revoke").replace(/\bto\b/i, "from")};`;
  if (/^revoke /.test(head)) return `${sql.replace(/^\s*revoke/i, "grant").replace(/\bfrom\b(?![\s\S]*\bfrom\b)/i, "to")};`;
  if (/^alter type .* add value/.test(head)) return "-- Postgres cannot remove an enum value; the new value stays unused";
  if (/^drop policy/.test(head) && table) {
    const name = afterKeyword(sql, "POLICY")?.replace(/"/g, "");
    const p = table.policies.find((x) => x.name === name);
    return p
      ? `create policy ${id(p.name)} on ${tname} as ${p.permissive ? "permissive" : "restrictive"} for ${p.command} to ${p.roles.join(", ")}${p.using ? ` using (${p.using})` : ""}${p.withCheck ? ` with check (${p.withCheck})` : ""};`
      : "-- the policy did not exist before";
  }
  if (/^drop index/.test(head)) {
    const name = afterKeyword(sql, "INDEX")?.split(".").pop()?.replace(/"/g, "");
    const ix = map.tables.flatMap((t) => t.indexes).find((i) => i.name === name);
    return ix ? `${ix.definition};` : "-- the index did not exist before";
  }
  if (/^drop table/.test(head)) {
    return backup
      ? `create table ${tname} as table ${backup};\n-- restored rows and columns; re-add its keys, policies and RLS from db-map.json`
      : "-- no backup was taken: this cannot be undone";
  }
  if (/^truncate/.test(head) || /^delete/.test(head)) {
    if (!backup) return "-- no backup was taken: this cannot be undone";
    return pk.length
      ? `insert into ${tname} select b.* from ${backup} b where not exists (select 1 from ${tname} t where ${pk.map((k) => `t.${id(k)} = b.${id(k)}`).join(" and ")});`
      : `insert into ${tname} select * from ${backup};`;
  }
  if (/^update/.test(head)) {
    if (!backup || !table || pk.length === 0) return "-- restore the rows from the backup by hand: the table has no primary key";
    const cols = table.columns.filter((c) => !pk.includes(c.name)).map((c) => id(c.name));
    if (cols.length === 0) return "-- nothing to restore: the table has only key columns";
    const set = cols.length === 1 ? `${cols[0]} = b.${cols[0]}` : `(${cols.join(", ")}) = row(${cols.map((c) => `b.${c}`).join(", ")})`;
    return `update ${tname} t set ${set} from ${backup} b where ${pk.map((k) => `t.${id(k)} = b.${id(k)}`).join(" and ")};`;
  }
  if (/^insert/.test(head)) return "-- rows added here are not removed automatically; delete them by their keys if needed";
  if (/^alter table/.test(head) && table) {
    if (/ enable row level security/.test(head)) return table.rls ? "-- row-level security was already on" : `alter table ${tname} disable row level security;`;
    if (/ disable row level security/.test(head)) return `alter table ${tname} enable row level security;`;
    const col = (sql.match(/\balter\s+(?:column\s+)?([\w"]+)\s+(?:set|drop|type)\b/i) ?? sql.match(/\bdrop\s+(?:column\s+)?(?:if\s+exists\s+)?([\w"]+)/i))?.[1]?.replace(/"/g, "");
    const before = table.columns.find((c) => c.name === col);
    if (/ add column| add (?!constraint)[a-z_"]+ /.test(head)) {
      const added = sql.match(/\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\w"]+)/i)?.[1];
      return `alter table ${tname} drop column if exists ${added};`;
    }
    if (/ add constraint/.test(head)) return `alter table ${tname} drop constraint if exists ${afterKeyword(sql, "CONSTRAINT")};`;
    if (/ drop constraint/.test(head)) {
      const name = afterKeyword(sql, "CONSTRAINT")?.replace(/"/g, "");
      const fk = table.foreignKeys.find((f) => f.name === name);
      const ck = table.checks.find((c) => c.name === name);
      if (fk) return `alter table ${tname} add constraint ${id(fk.name)} foreign key (${fk.columns.map(id).join(", ")}) references ${qualified(fk.refSchema, fk.refTable)}(${fk.refColumns.map(id).join(", ")}) not valid;`;
      if (ck) return `alter table ${tname} add constraint ${id(ck.name)} ${ck.definition} not valid;`;
      return "-- re-add the constraint from db-map.json";
    }
    if (/ set not null/.test(head) && col) return `alter table ${tname} alter column ${id(col)} drop not null;`;
    if (/ drop not null/.test(head) && col) return `alter table ${tname} alter column ${id(col)} set not null;`;
    if (/ set default| drop default/.test(head) && col) {
      return before?.default ? `alter table ${tname} alter column ${id(col)} set default ${before.default};` : `alter table ${tname} alter column ${id(col)} drop default;`;
    }
    if (/ type /.test(head) && col && before) {
      return `alter table ${tname} alter column ${id(col)} type ${before.type} using ${id(col)}::${before.type};${backup ? `\nupdate ${tname} t set ${id(col)} = b.${id(col)} from ${backup} b where ${pk.map((k) => `t.${id(k)} = b.${id(k)}`).join(" and ") || "false"};` : ""}`;
    }
    if (/ drop /.test(head) && col && before) {
      return [
        `alter table ${tname} add column if not exists ${id(col)} ${before.type};`,
        backup && pk.length ? `update ${tname} t set ${id(col)} = b.${id(col)} from ${backup} b where ${pk.map((k) => `t.${id(k)} = b.${id(k)}`).join(" and ")};` : "-- values cannot be restored: no backup or no primary key",
      ].join("\n");
    }
  }
  return "-- undo by hand: see the statement above";
}

/* ── Planning ─────────────────────────────────────────────────────────────── */

function whereClause(sql: string): string | null {
  const m = sql.match(/\bwhere\b([\s\S]+?)(?:\breturning\b[\s\S]*)?$/i);
  return m ? m[1].trim() : null;
}

function confirmationFor(s: Classified): string {
  const head = s.sql.replace(/\s+/g, " ").trim();
  const table = s.table?.split(".").pop()?.replace(/"/g, "") ?? "it";
  const dropCol = head.match(/\bdrop\s+(?:column\s+)?(?:if\s+exists\s+)?"?([\w]+)"?/i);
  if (/^alter table/i.test(head) && dropCol && !/^(default|not|constraint)$/i.test(dropCol[1])) return `DROP ${dropCol[1]}`;
  if (/^drop/i.test(head)) return `DROP ${table}`;
  if (/^(delete|truncate)/i.test(head)) return `DELETE ${table}`;
  if (/^update/i.test(head)) return `UPDATE ${table}`;
  if (/disable row level security/i.test(head)) return `DISABLE RLS ${table}`;
  return `CONFIRM ${table}`;
}

export type PlanInput = {
  sql: string;
  map: DatabaseMap;
  /** The production signal from analyze(). */
  production: boolean;
  /** What was asked for, if it came from words. Used in the name. */
  request?: string;
  now?: Date;
};

export function planSurgery(input: PlanInput): SurgeryPlan {
  const { map, production } = input;
  const now = input.now ?? new Date();
  const rewrites: string[] = [];
  const refused: string[] = [];
  const warnings: string[] = [];

  /* Renames become copies before anything is judged. */
  let source = tokenize(input.sql).map((s) => s.text);
  source = source.flatMap((text) => {
    const m = text.replace(/\s+/g, " ").trim().match(RENAME_COLUMN);
    if (!m) return [text];
    const table = resolveTable(m[1].replace(/"/g, ""), map);
    if (!table) return [text];
    const from = m[2].replace(/"/g, "");
    const to = m[3].replace(/"/g, "");
    rewrites.push(`Renaming ${table.name}.${from} to ${to} is done as a copy: ${to} is added and filled from ${from}, and ${from} stays until you confirm it can go — anything still reading ${from} keeps working.`);
    return renameAsCopy(table, from, to).split(";\n");
  });

  const ctx = {
    columnType: (t: string, c: string) => resolveTable(t, map)?.columns.find((x) => x.name === c)?.type ?? null,
    rows: (t: string) => resolveTable(t, map)?.rowEstimate ?? 0,
  };
  let classified = source.flatMap((text) => tokenize(text)).map((s) => classifyStatement(s, ctx));

  /* What this migration creates is new: dropping or changing it again in the
     same migration touches nothing that existed, and backups of our own are
     ours to remove. */
  const createdHere = new Set<string>();
  classified = classified.map((s) => {
    const head = s.sql.replace(/\s+/g, " ").trim().toLowerCase();
    const table = s.table ? (resolveTable(s.table, map) ? keyOf(resolveTable(s.table, map) as MapTable) : s.table.includes(".") ? s.table : `public.${s.table}`) : null;
    if (/^create (unlogged )?table/.test(head) && table && !resolveTable(s.table, map)) createdHere.add(table);
    if (s.forbidden) return s;
    if (table && createdHere.has(table) && !/^create (unlogged )?table/.test(head) && s.level > 1 && !/^drop table/.test(head)) {
      return { ...s, level: 1 as RiskLevel, what: `${s.what} (on the table this change creates)` };
    }
    if (/^drop table/.test(head) && s.table?.startsWith(`${BACKUP_SCHEMA}.`)) {
      return { ...s, level: 1 as RiskLevel, what: `removes the old QuickStark backup ${s.table}` };
    }
    return s;
  });

  /* RLS: policies first, never RLS with none. */
  const enableIdx = classified.map((s, i) => (/enable row level security/i.test(s.sql) ? i : -1)).filter((i) => i >= 0);
  for (const i of enableIdx) {
    const s = classified[i];
    const table = resolveTable(s.table, map);
    const key = table ? keyOf(table) : s.table;
    const policyIdx = classified.map((p, j) => (/^\s*create\s+policy/i.test(p.sql) && (resolveTable(p.table, map) ? keyOf(resolveTable(p.table, map) as MapTable) : p.table) === key ? j : -1)).filter((j) => j >= 0);
    const existing = table?.policies.length ?? 0;
    if (policyIdx.length === 0 && existing === 0 && !(key && createdHere.has(key))) {
      refused.push(`Turning on row-level security for ${s.table} with no policies would lock the app out of it. Create its policies in the same change, before RLS is enabled.`);
    } else if (policyIdx.some((j) => j > i)) {
      const last = Math.max(...policyIdx);
      const [moved] = classified.splice(i, 1);
      classified.splice(last, 0, moved);
      rewrites.push(`Row-level security on ${s.table} is now enabled after its policies are created, so the app never loses access mid-change.`);
    }
  }

  /* Large tables: concurrent indexes, lock warnings. */
  classified = classified.map((s) => {
    const table = resolveTable(s.table, map);
    if (!table || table.rowEstimate <= LARGE) return s;
    if (/^\s*create\s+(unique\s+)?index\s+(?!concurrently)/i.test(s.sql)) {
      rewrites.push(`The index on ${table.name} (${table.rowEstimate.toLocaleString()} rows) is built CONCURRENTLY, after the main change, so writes are not blocked while it builds.`);
      return { ...s, sql: s.sql.replace(/^(\s*create\s+(?:unique\s+)?index)\s+/i, "$1 concurrently "), concurrent: true, level: 1 as RiskLevel };
    }
    if (s.level >= 2) warnings.push(`${table.name} has about ${table.rowEstimate.toLocaleString()} rows: "${s.what}" may lock it for a while. Run it when traffic is low.`);
    return s;
  });

  /* Production: no unbounded writes; bounded ones are counted first. */
  const previews: SurgeryPlan["previews"] = [];
  for (const s of classified) {
    if (s.forbidden) refused.push(`Not allowed: ${s.forbidden}.`);
    const head = s.sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (/^(update|delete)\b/.test(head)) {
      const where = whereClause(s.sql);
      if (!where && production) refused.push(`"${s.sql.slice(0, 60)}…" changes every row of ${s.table} in a production database. Add a WHERE clause that says which rows.`);
      const table = resolveTable(s.table, map);
      if (table) previews.push({ statement: s.sql, countSql: `select count(*)::int as rows from ${qualified(table.schema, table.name)}${where ? ` where ${where}` : ""}` });
    }
  }

  const level = overallLevel(classified);

  /* Backups: every existing table an L2/L3 statement touches. */
  const backupMap = new Map<string, string>();
  const backupStatements: string[] = [];
  for (const s of classified) {
    if (s.level < 2) continue;
    const table = resolveTable(s.table, map);
    if (!table || backupMap.has(keyOf(table)) || table.kind !== "table" || createdHere.has(keyOf(table))) continue;
    if (/^\s*(create|alter)\s+policy|^\s*drop\s+(policy|index)|^\s*(grant|revoke)/i.test(s.sql)) continue;
    const b = backupSql(table, now);
    backupMap.set(keyOf(table), b.name);
    backupStatements.push(b.sql);
  }

  const statements: PlannedStatement[] = classified.map((s) => ({ ...s, label: RISK_LABEL[s.level], rollback: rollbackFor(s, map, backupMap) }));

  const affected = [...new Set(classified.map((s) => resolveTable(s.table, map)).filter((t): t is MapTable => Boolean(t)).map(keyOf))].map((key) => ({
    table: key,
    rows: map.tables.find((t) => keyOf(t) === key)?.rowEstimate ?? 0,
  }));
  for (const key of createdHere) affected.push({ table: key, rows: 0 });

  const l3 = statements.find((s) => s.level === 3 && !s.forbidden);
  const summary = summarise(statements, rewrites);

  return {
    name: migrationName(input.request || summary, now),
    summary,
    level,
    statements,
    migration: [...backupStatements, ...statements.filter((s) => !s.concurrent).map((s) => `${s.sql.replace(/;\s*$/, "")};`)].join("\n"),
    concurrent: statements.filter((s) => s.concurrent).map((s) => `${s.sql.replace(/;\s*$/, "")};`),
    rollback: [...statements].reverse().map((s) => s.rollback).join("\n"),
    affected,
    backups: [...backupMap.values()],
    previews,
    confirmation: l3 ? confirmationFor(l3) : null,
    refused: [...new Set(refused)],
    warnings,
    rewrites,
  };
}

/** One paragraph, plain words, no SQL. */
export function summarise(statements: PlannedStatement[], rewrites: string[] = []): string {
  const tables = statements.filter((s) => /^\s*create\s+(unlogged\s+)?table/i.test(s.sql)).map((s) => s.table?.split(".").pop());
  const columns = statements.filter((s) => /adds an optional column|adds a required column/.test(s.what));
  const policies = statements.filter((s) => /^\s*create\s+policy/i.test(s.sql));
  const rls = statements.filter((s) => /enable row level security/i.test(s.sql)).map((s) => s.table?.split(".").pop());
  const destructive = statements.filter((s) => s.level === 3);
  const parts: string[] = [];
  if (tables.length) parts.push(`adds ${tables.length === 1 ? "a" : tables.length} ${tables.join(", ")} table${tables.length === 1 ? "" : "s"}`);
  if (columns.length) parts.push(`adds ${columns.length} column${columns.length === 1 ? "" : "s"}${columns.length === 1 ? ` to ${columns[0].table?.split(".").pop()}` : ""}`);
  if (policies.length) {
    const on = [...new Set(policies.map((p) => p.table?.split(".").pop()))];
    parts.push(`adds ${policies.length} access rule${policies.length === 1 ? "" : "s"} on ${on.join(", ")}`);
  }
  if (rls.length) parts.push(`turns row-level security on for ${rls.join(", ")}`);
  for (const d of destructive.slice(0, 3)) parts.push(d.what);
  const rest = statements.filter((s) => s.level === 2 && !/enable row level security/i.test(s.sql)).slice(0, 2).map((s) => s.what);
  parts.push(...rest);
  const sentence = parts.length ? parts.join("; ") : statements.map((s) => s.what).slice(0, 3).join("; ");
  const text = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  return `${text}.${rewrites.length ? ` ${rewrites[0]}` : ""}`;
}

/** The plan as a chat message: plain words first, SQL collapsible underneath. */
export function surgeryCard(plan: SurgeryPlan): string {
  const lines = [
    `**${plan.summary}**`,
    "",
    `Risk: **${RISK_LABEL[plan.level]}**${plan.affected.length ? ` · touches ${plan.affected.map((a) => `${a.table.split(".").pop()} (${a.rows.toLocaleString()} rows)`).join(", ")}` : ""}`,
  ];
  if (plan.backups.length) lines.push(`Backup first: ${plan.backups.join(", ")} (kept ${BACKUP_DAYS} days).`);
  for (const w of plan.warnings) lines.push(`⚠️ ${w}`);
  for (const r of plan.refused) lines.push(`⛔ ${r}`);
  if (plan.confirmation) lines.push(`To approve, type **${plan.confirmation}**.`);
  lines.push(
    "",
    "<details><summary>SQL</summary>",
    "",
    "```sql",
    plan.statements.map((s) => `-- ${s.label}: ${s.what}\n${s.sql.replace(/;\s*$/, "")};`).join("\n"),
    "```",
    "</details>",
    "",
    "<details><summary>Rollback</summary>",
    "",
    "```sql",
    plan.rollback,
    "```",
    "</details>",
  );
  return lines.join("\n");
}
