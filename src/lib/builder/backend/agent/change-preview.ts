/* The change preview: what a plan does to the database, sorted the way a
 * person decides on it — before a single statement runs.
 *
 *   CREATE    something new: a table, column, index, policy, function, type
 *   UPDATE    an existing object changed in place
 *   REPAIR    an existing object made correct or safe — row-level security
 *             turned on, a missing index or key added, a function's search
 *             path pinned — without changing what it holds
 *   REMOVE    something dropped, emptied or deleted: always needs approval
 *   PRESERVE  what is already there and is left exactly as it is
 *
 * Read from the classified statements and the live database map, so CREATE
 * and UPDATE are decided against what really exists, not against what the
 * plan assumes. Pure: type-only imports (tools/check-db-agent.mjs). */

import type { Classified } from "./sql-guard";
import type { DatabaseMap } from "./db-map";

export type ChangeKind = "CREATE" | "UPDATE" | "REPAIR" | "REMOVE";

export type ChangePreview = {
  create: string[];
  update: string[];
  repair: string[];
  remove: string[];
  preserve: string[];
  policies: { creating: number; preserved: number };
};

const short = (name: string | null) => (name ?? "").replace(/"/g, "").split(".").pop() ?? "";

/** Which of the four a statement is, against the live database. Pure. */
export function classifyChange(statement: Pick<Classified, "sql" | "level" | "table">, map: Pick<DatabaseMap, "tables">): ChangeKind {
  const sql = statement.sql.replace(/\s+/g, " ").trim().toLowerCase();
  const exists = statement.table ? map.tables.some((table) => table.name.toLowerCase() === short(statement.table).toLowerCase()) : false;
  if (statement.level >= 3 || /^(drop|truncate|delete)\b/.test(sql) || / drop (column|constraint)\b/.test(sql)) return "REMOVE";
  if (/ enable row level security| force row level security/.test(sql) && exists) return "REPAIR";
  if (/^alter function .* set search_path/.test(sql)) return "REPAIR";
  if (/^create (unique )?index/.test(sql) && exists) return "REPAIR";
  if (/^alter table .* add (constraint .* )?foreign key/.test(sql) && exists) return "REPAIR";
  if (/^create (or replace )?(table|type|function|trigger|view|policy|sequence|extension|schema)\b/.test(sql)) {
    return /^create or replace/.test(sql) || (/^create (table|view)/.test(sql) && exists) ? "UPDATE" : "CREATE";
  }
  if (/^alter table .* add column/.test(sql)) return "CREATE";
  if (/^(alter|update|comment|grant|revoke)\b/.test(sql)) return exists || /^(comment|grant|revoke)/.test(sql) ? "UPDATE" : "CREATE";
  return exists ? "UPDATE" : "CREATE";
}

/** The whole preview for a plan. Pure. */
export function changePreview(statements: Pick<Classified, "sql" | "level" | "table" | "what">[], map: Pick<DatabaseMap, "tables">): ChangePreview {
  const preview: ChangePreview = { create: [], update: [], repair: [], remove: [], preserve: [], policies: { creating: 0, preserved: 0 } };
  const touched = new Set<string>();
  for (const statement of statements) {
    const kind = classifyChange(statement, map);
    const label = `${short(statement.table) || "database"} — ${statement.what}`;
    const bucket = kind === "CREATE" ? preview.create : kind === "UPDATE" ? preview.update : kind === "REPAIR" ? preview.repair : preview.remove;
    bucket.push(label);
    if (statement.table) touched.add(short(statement.table).toLowerCase());
    if (/^\s*create policy/i.test(statement.sql)) preview.policies.creating += 1;
  }
  for (const table of map.tables) {
    if (table.schema !== "public") continue;
    if (touched.has(table.name.toLowerCase())) {
      preview.policies.preserved += table.policies.length;
      continue;
    }
    preview.preserve.push(`${table.name}${table.rowEstimate > 0 ? ` (${Math.round(table.rowEstimate).toLocaleString()} rows)` : ""}`);
  }
  preview.preserve.push("auth.users and every existing account");
  return preview;
}

/** The preview as the top of the plan card. */
export function previewLines(preview: ChangePreview): string[] {
  const section = (title: string, items: string[], most = 8) =>
    items.length ? [`**${title}**`, ...items.slice(0, most).map((item) => `- ${item}`), ...(items.length > most ? [`- …and ${items.length - most} more`] : [])] : [];
  return [
    "**DATABASE CHANGE PREVIEW**",
    ...section("CREATE", preview.create),
    ...section("UPDATE", preview.update),
    ...section("REPAIR", preview.repair),
    ...section("REMOVE — needs your approval", preview.remove),
    ...section("PRESERVE", preview.preserve, 6),
    `**SECURITY** — ${preview.policies.creating} access rule${preview.policies.creating === 1 ? "" : "s"} to create, ${preview.policies.preserved} existing on the tables touched kept as they are.`,
  ];
}
