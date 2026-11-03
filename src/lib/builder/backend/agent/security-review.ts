/* The security engineer: what a planned change does to who can read and
 * write what — read before anything is approved, and again over the whole
 * database when it is analysed.
 *
 * The dry run proves a migration RUNS; the RLS probe proves the policies
 * hold for the tables it was pointed at. Neither reads a policy and asks
 * whether it is the right policy. That is this file: rules a database
 * engineer applies on sight, each with the reason, held against every
 * statement of a plan and every table of the map.
 *
 *   block   the change may not be approved as written
 *           - turning row-level security off (other than undoing a change
 *             that turned it on) — never the way to make a feature work
 *           - a write policy that lets anyone write any row (`using (true)`
 *             / `with check (true)` on insert, update, delete or all) on a
 *             table that belongs to someone
 *           - granting visitors (anon) insert, update or delete
 *   warn    said on the card, approval still possible
 *           - a table with an owner column and RLS off
 *           - a read-everything policy on a table that belongs to someone
 *           - an owner-table policy that never checks the signed-in user
 *           - an update policy on a table with a role column that lets
 *             people edit their own row: they could promote themselves
 *
 * Pure: type-only imports, so it is compiled and tested on its own
 * (tools/check-db-agent.mjs). */

import type { DatabaseMap, MapPolicy, MapTable } from "./db-map";

export type SecurityFinding = {
  severity: "block" | "warn";
  table: string | null;
  rule: string;
  message: string;
};

const OWNER_NAME = /^(?:user_id|owner_id|profile_id|created_by|author_id|organization_id|org_id|workspace_id|team_id|tenant_id|account_id)$/;
const ROLE_NAME = /^(?:role|roles|is_admin|admin|is_staff|permissions?|plan|tier|access_level)$/;
/* What ties a row to the person asking: their id, a membership or admin
   check, or a security-definer helper that does one of those. */
const IDENTITY = /auth\.uid\(\)|auth\.jwt\(\)|is_admin|is_member|has_role|is_org_member|is_workspace_member|current_user_id|memberships?|members\b/i;
const WIDE_OPEN = /^\(?\s*true\s*\)?$/i;

const bare = (name: string) => name.replace(/"/g, "").split(".").pop()!.toLowerCase();

/* Whether a table belongs to someone: an owner or tenant column, or a key to
   auth.users. */
function ownedTable(table: MapTable): boolean {
  return (
    table.foreignKeys.some((fk) => fk.refSchema === "auth" && fk.refTable === "users") ||
    table.columns.some((column) => OWNER_NAME.test(column.name))
  );
}

type ParsedPolicy = { name: string; table: string; command: MapPolicy["command"]; roles: string[]; using: string | null; withCheck: string | null };

/** `create policy …` read into its parts, or null. */
export function parsePolicy(sql: string): ParsedPolicy | null {
  const text = sql.replace(/\s+/g, " ").trim();
  const head = /^create policy\s+("(?:[^"]|"")+"|[\w$]+)\s+on\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)/i.exec(text);
  if (!head) return null;
  const command = (/\sfor\s+(all|select|insert|update|delete)\b/i.exec(text)?.[1]?.toLowerCase() ?? "all") as MapPolicy["command"];
  const roles = (/\sto\s+([\w\s,"]+?)(?=\s+using\b|\s+with\s+check\b|;|$)/i.exec(text)?.[1] ?? "public")
    .split(",")
    .map((role) => role.replace(/"/g, "").trim().toLowerCase())
    .filter(Boolean);
  return {
    name: head[1].replace(/"/g, ""),
    table: head[2],
    command,
    roles,
    using: clause(text, "using"),
    withCheck: clause(text, "with check"),
  };
}

/* The parenthesised expression after a keyword, balanced. */
function clause(text: string, keyword: "using" | "with check"): string | null {
  const at = new RegExp(`\\s${keyword.replace(" ", "\\s+")}\\s*\\(`, "i").exec(text);
  if (!at) return null;
  let depth = 0;
  const start = at.index + at[0].length - 1;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(start + 1, i).trim();
    }
  }
  return null;
}

/* Columns a planned CREATE TABLE gives a table, so a table made in the same
   plan is judged the same way as one already in the map. */
function plannedTables(statements: string[]): Map<string, MapTable> {
  const out = new Map<string, MapTable>();
  for (const sql of statements) {
    const head = /^\s*create table\s+(?:if not exists\s+)?((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)\s*\(([\s\S]*)\)\s*;?\s*$/i.exec(sql);
    if (!head) continue;
    const name = bare(head[1]);
    const body = head[2];
    const columns = body
      .split(/,(?![^()]*\))/)
      .map((part) => part.trim())
      .filter((part) => /^[\w"]/.test(part) && !/^(?:constraint|primary|foreign|unique|check)\b/i.test(part))
      .map((part) => ({ name: part.split(/\s+/)[0].replace(/"/g, "").toLowerCase(), type: (part.split(/\s+/)[1] ?? "").toLowerCase(), nullable: true, default: null, identity: false, enumName: null, comment: null }));
    const refsAuth = /references\s+auth\.users/i.test(body);
    out.set(name, {
      schema: "public",
      name,
      kind: "table",
      comment: null,
      columns,
      primaryKey: [],
      foreignKeys: refsAuth ? [{ name: "planned", columns: [], refSchema: "auth", refTable: "users", refColumns: ["id"], onDelete: "", onUpdate: "" } as unknown as MapTable["foreignKeys"][number]] : [],
      unique: [],
      checks: [],
      indexes: [],
      rowEstimate: 0,
      rls: false,
      forceRls: false,
      policies: [],
      triggers: [],
      grants: { anon: [], authenticated: [] },
      writes: 0,
    });
  }
  return out;
}

/**
 * Every finding a planned change raises. `undo` is set when the plan undoes
 * an earlier change, whose rollback may legitimately turn RLS back off.
 */
export function reviewStatements(statements: string[], map: DatabaseMap, options: { undo?: boolean } = {}): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const planned = plannedTables(statements);
  const tableFor = (name: string): MapTable | null =>
    planned.get(bare(name)) ?? map.tables.find((table) => table.name.toLowerCase() === bare(name)) ?? null;
  const enabling = new Set<string>();
  const policiesPlanned = new Map<string, ParsedPolicy[]>();

  for (const raw of statements) {
    const sql = raw.replace(/\s+/g, " ").trim();
    const rls = /^alter table\s+(?:if exists\s+)?(?:only\s+)?((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)\s+(enable|disable|force|no force) row level security/i.exec(sql);
    if (rls) {
      const name = bare(rls[1]);
      if (/^(enable|force)$/i.test(rls[2])) enabling.add(name);
      if (/^disable$/i.test(rls[2]) && !options.undo) {
        findings.push({
          severity: "block",
          table: name,
          rule: "rls-disabled",
          message: `This turns row-level security off on ${name}, which makes every row readable and writable through the API. Fix the policy that blocks the feature instead — I can write it.`,
        });
      }
      continue;
    }

    const grant = /^grant\s+([\w\s,]+?)\s+on\s+(?:table\s+)?([\w."$]+)\s+to\s+([\w\s,"]+)/i.exec(sql);
    if (grant && /\banon\b/i.test(grant[3]) && /\b(insert|update|delete|all)\b/i.test(grant[1])) {
      findings.push({
        severity: "block",
        table: bare(grant[2]),
        rule: "anon-write-grant",
        message: `This lets visitors who are not signed in ${grant[1].toLowerCase().trim()} rows in ${bare(grant[2])}. Writes should need a signed-in user, checked by a policy.`,
      });
      continue;
    }

    const policy = /^create policy/i.test(sql) ? parsePolicy(sql) : null;
    if (policy) {
      const name = bare(policy.table);
      policiesPlanned.set(name, [...(policiesPlanned.get(name) ?? []), policy]);
    }
  }

  for (const [name, policies] of policiesPlanned) {
    const table = tableFor(name);
    const owned = table ? ownedTable(table) : false;
    for (const policy of policies) findings.push(...judgePolicy(policy, name, owned, table));
  }

  /* A table that belongs to someone, made or changed here, left without RLS. */
  for (const [name, table] of planned) {
    if (ownedTable(table) && !enabling.has(name)) {
      findings.push({
        severity: "warn",
        table: name,
        rule: "owned-without-rls",
        message: `${name} holds rows that belong to people, and this does not turn row-level security on for it — anyone could read and change them. Add \`alter table ${name} enable row level security;\` with owner policies.`,
      });
    }
  }
  return findings;
}

function judgePolicy(policy: ParsedPolicy, name: string, owned: boolean, table: MapTable | null): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const writes = policy.command !== "select";
  const open = (expr: string | null) => expr !== null && WIDE_OPEN.test(expr);
  if (owned && writes && (open(policy.using) || open(policy.withCheck))) {
    out.push({
      severity: "block",
      table: name,
      rule: "unrestricted-write",
      message: `Policy "${policy.name}" lets anyone ${policy.command === "all" ? "write" : policy.command} any row in ${name}, which belongs to its owners. Check ownership, e.g. \`auth.uid() = user_id\`, in USING and WITH CHECK.`,
    });
  } else if (owned && !writes && open(policy.using)) {
    out.push({
      severity: "warn",
      table: name,
      rule: "read-everything",
      message: `Policy "${policy.name}" lets ${policy.roles.join(", ")} read every row of ${name}. Fine for public content; wrong if these rows are private to their owners.`,
    });
  }
  const checks = [policy.using, policy.withCheck].filter(Boolean).join(" ");
  if (owned && checks && !open(policy.using) && !open(policy.withCheck) && !IDENTITY.test(checks)) {
    out.push({
      severity: "warn",
      table: name,
      rule: "no-identity",
      message: `Policy "${policy.name}" on ${name} never checks who is asking (auth.uid() or a membership), so it does not tie rows to their owner.`,
    });
  }
  if ((policy.command === "update" || policy.command === "all") && table?.columns.some((column) => ROLE_NAME.test(column.name)) && /auth\.uid\(\)\s*=\s*\(?\s*(?:id|user_id)\b|\b(?:id|user_id)\s*=\s*auth\.uid\(\)/i.test(checks)) {
    out.push({
      severity: "warn",
      table: name,
      rule: "role-self-escalation",
      message: `People can update their own row in ${name}, and it has a role column — they could make themselves an admin. Keep that column out of their reach (a column grant or a trigger that refuses the change).`,
    });
  }
  if (policy.command === "insert" && owned && policy.withCheck === null) {
    out.push({
      severity: "warn",
      table: name,
      rule: "insert-without-check",
      message: `Policy "${policy.name}" lets rows be added to ${name} without a WITH CHECK, so people could add rows in someone else's name.`,
    });
  }
  return out;
}

/** What is already wrong in a connected database, table by table. */
export function reviewDatabase(map: DatabaseMap): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const table of map.tables) {
    if (table.schema !== "public" || table.kind !== "table") continue;
    const owned = ownedTable(table);
    if (owned && !table.rls) {
      findings.push({ severity: "warn", table: table.name, rule: "owned-without-rls", message: `${table.name} belongs to its owners but has row-level security off.` });
    }
    if (!table.rls && table.grants.anon.some((command) => command !== "select")) {
      findings.push({ severity: "warn", table: table.name, rule: "anon-write-grant", message: `Visitors who are not signed in can ${table.grants.anon.filter((c) => c !== "select").join(", ")} rows in ${table.name}.` });
    }
    for (const policy of table.policies) {
      findings.push(...judgePolicy({ ...policy, table: table.name }, table.name, owned, table).map((finding) => ({ ...finding, severity: "warn" as const })));
    }
  }
  return findings;
}

/** The findings as lines for the plan card. */
export function securityLines(findings: SecurityFinding[]): string[] {
  return findings.map((finding) => `${finding.severity === "block" ? "BLOCKED" : "Security"}: ${finding.message}`);
}
