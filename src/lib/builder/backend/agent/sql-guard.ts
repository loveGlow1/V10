/* What a statement IS, decided by reading it rather than by matching it.
 *
 * database-ask.ts judges SQL with regular expressions, which is fine for
 * deciding whether to ask "Run it?" and not fine for the promise this file
 * makes: that query_readonly runs nothing but a read, and that every statement
 * in a migration carries the risk level its approval card says it does. A
 * regex reads `select 'drop table x'` as a drop and `with d as (delete …)
 * select 1` as a select. So the text is tokenised first — single-quoted
 * strings, E-strings, double-quoted identifiers, $tag$ bodies and both kinds
 * of comment are recognised as what they are — and every decision below is
 * made on keywords outside of them.
 *
 * Pure: no database, no fetch. Asserted by tools/check-db-agent.mjs.
 */

export type Token =
  | { kind: "word"; text: string; upper: string }
  | { kind: "ident"; text: string }
  | { kind: "string"; text: string }
  | { kind: "number"; text: string }
  | { kind: "punct"; text: string };

export type Statement = { text: string; tokens: Token[] };

/** Splits SQL into statements of tokens. Comments are dropped; nothing inside a string or body is a keyword. */
export function tokenize(sql: string): Statement[] {
  const statements: Statement[] = [];
  let tokens: Token[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;

  const flush = (end: number) => {
    if (tokens.length > 0) statements.push({ text: sql.slice(start, end).trim(), tokens });
    tokens = [];
    start = end + 1;
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      /* Postgres block comments nest. */
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth += 1; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth -= 1; i += 2; }
        else i += 1;
      }
      continue;
    }
    if (ch === ";") {
      flush(i);
      i += 1;
      continue;
    }
    if (ch === "'" || ((ch === "E" || ch === "e") && next === "'")) {
      const escapes = ch !== "'";
      let j = escapes ? i + 2 : i + 1;
      while (j < n) {
        if (escapes && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j += 1;
      }
      tokens.push({ kind: "string", text: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"' && sql[j + 1] === '"') { j += 2; continue; }
        if (sql[j] === '"') break;
        j += 1;
      }
      tokens.push({ kind: "ident", text: sql.slice(i + 1, j).replace(/""/g, '"') });
      i = j + 1;
      continue;
    }
    if (ch === "$") {
      const tag = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const end = close === -1 ? n : close + tag[0].length;
        tokens.push({ kind: "string", text: sql.slice(i, end) });
        i = end;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j += 1;
      const text = sql.slice(i, j);
      tokens.push({ kind: "word", text, upper: text.toUpperCase() });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[0-9.eE]/.test(sql[j])) j += 1;
      tokens.push({ kind: "number", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    tokens.push({ kind: "punct", text: ch });
    i += 1;
  }
  flush(n);
  return statements;
}

const words = (s: Statement): string[] => s.tokens.map((t) => (t.kind === "word" ? t.upper : t.kind === "ident" ? `"${t.text}"` : t.text));
const has = (s: Statement, word: string): boolean => s.tokens.some((t) => t.kind === "word" && t.upper === word);
const firstWords = (s: Statement, count: number): string =>
  s.tokens.filter((t) => t.kind === "word").slice(0, count).map((t) => (t as { upper: string }).upper).join(" ");

/* Functions that do something to the server or its sessions, which a read must
   never call even though `select f()` is grammatically a read. */
const SIDE_EFFECT_FUNCTIONS = new Set([
  "PG_READ_FILE", "PG_READ_BINARY_FILE", "PG_LS_DIR", "PG_STAT_FILE", "LO_IMPORT", "LO_EXPORT",
  "PG_TERMINATE_BACKEND", "PG_CANCEL_BACKEND", "PG_RELOAD_CONF", "PG_ROTATE_LOGFILE",
  "SET_CONFIG", "NEXTVAL", "SETVAL", "DBLINK", "DBLINK_EXEC", "PG_ADVISORY_LOCK", "PG_SLEEP",
  "PG_NOTIFY", "PG_CREATE_RESTORE_POINT", "PG_SWITCH_WAL", "HTTP", "HTTP_GET", "HTTP_POST", "NET",
]);

const WRITE_WORDS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "DROP", "ALTER", "CREATE", "GRANT", "REVOKE", "COPY", "CALL", "DO", "VACUUM", "REINDEX", "CLUSTER", "LOCK", "REFRESH", "LISTEN", "NOTIFY", "SECURITY", "COMMENT"]);

export type ReadOnlyVerdict = { ok: true; kind: "select" | "explain" } | { ok: false; reason: string };

/**
 * Whether SQL is a single read and nothing else.
 *
 * SELECT, WITH … SELECT, or EXPLAIN (without ANALYZE, which executes). Rejects
 * data-modifying CTEs, SELECT INTO, row locks, more than one statement, and any
 * call to a function with a side effect.
 */
export function readOnlyCheck(sql: string): ReadOnlyVerdict {
  const statements = tokenize(sql);
  if (statements.length === 0) return { ok: false, reason: "there is no statement" };
  if (statements.length > 1) return { ok: false, reason: "only one statement may run at a time" };
  const s = statements[0];
  const head = s.tokens[0];
  if (head.kind !== "word" && !(head.kind === "punct" && head.text === "(")) {
    return { ok: false, reason: "it does not start with SELECT, WITH or EXPLAIN" };
  }
  const first = s.tokens.find((t) => t.kind === "word") as { upper: string } | undefined;
  if (!first || !["SELECT", "WITH", "EXPLAIN", "VALUES", "TABLE"].includes(first.upper)) {
    return { ok: false, reason: `${first?.upper ?? "it"} is not a read — only SELECT, WITH and EXPLAIN may run here` };
  }
  if (first.upper === "EXPLAIN" && (has(s, "ANALYZE") || has(s, "ANALYSE"))) {
    return { ok: false, reason: "EXPLAIN ANALYZE runs the statement; use EXPLAIN on its own" };
  }
  for (let i = 0; i < s.tokens.length; i += 1) {
    const t = s.tokens[i];
    if (t.kind !== "word") continue;
    if (WRITE_WORDS.has(t.upper)) {
      /* `for update` / `for share` lock rows; any other write word outside a
         string is a write (a data-modifying CTE, a SELECT INTO's sibling). */
      return { ok: false, reason: `it contains ${t.upper}, which is not a read` };
    }
    if (t.upper === "INTO") return { ok: false, reason: "SELECT INTO creates a table" };
    if (t.upper === "FOR") {
      const after = s.tokens[i + 1];
      if (after?.kind === "word" && ["UPDATE", "SHARE", "NO", "KEY"].includes(after.upper)) {
        return { ok: false, reason: "row locks are not reads" };
      }
    }
    const call = s.tokens[i + 1];
    if (call?.kind === "punct" && call.text === "(" && SIDE_EFFECT_FUNCTIONS.has(t.upper)) {
      return { ok: false, reason: `${t.text}() has a side effect` };
    }
  }
  return { ok: true, kind: first.upper === "EXPLAIN" ? "explain" : "select" };
}

/**
 * The read, as it is sent: capped at `limit` rows.
 *
 * A SELECT is wrapped so the cap holds whatever LIMIT it carried; an EXPLAIN is
 * sent as written. The caller checks it with readOnlyCheck first.
 */
export function limitedRead(sql: string, limit: number): string {
  const cap = Math.max(1, Math.min(50, Math.floor(limit)));
  const body = tokenize(sql)[0]?.text ?? sql.trim();
  if (/^\s*explain\b/i.test(body)) return body;
  return `select * from (\n${body}\n) as _qs_read limit ${cap}`;
}

/* ── Risk levels ──────────────────────────────────────────────────────────── */

export type RiskLevel = 0 | 1 | 2 | 3;

export const RISK_LABEL: Record<RiskLevel, string> = {
  0: "L0 read",
  1: "L1 additive",
  2: "L2 modifying",
  3: "L3 destructive",
};

export type Classified = {
  sql: string;
  level: RiskLevel;
  /** What it does, in plain words. */
  what: string;
  /** Set when the statement may not run at all, whatever is approved. */
  forbidden: string | null;
  /** The table it acts on, schema-qualified where the SQL qualified it. */
  table: string | null;
  /** The statement creates an index CONCURRENTLY, which cannot run inside a transaction. */
  concurrent: boolean;
};

/* Schemas Supabase owns. Referencing auth.users is fine; changing anything in
   these is done through Supabase's APIs or not at all. */
const INTERNAL_SCHEMAS = new Set(["auth", "storage", "realtime", "supabase_functions", "supabase_migrations", "extensions", "graphql", "graphql_public", "pgsodium", "vault", "net", "cron", "pg_catalog", "information_schema"]);

/** The object name after the given position: `a`, `a.b`, `"A".b`. */
function nameAt(s: Statement, index: number): { name: string; next: number } | null {
  let i = index;
  const parts: string[] = [];
  while (i < s.tokens.length) {
    const t = s.tokens[i];
    if (t.kind === "word" || t.kind === "ident") {
      parts.push(t.kind === "word" ? t.text.toLowerCase() : t.text);
      const dot = s.tokens[i + 1];
      if (dot?.kind === "punct" && dot.text === ".") { i += 2; continue; }
      return { name: parts.join("."), next: i + 1 };
    }
    return null;
  }
  return null;
}

/** Skips IF [NOT] EXISTS, ONLY, CONCURRENTLY and the like before a name. */
function skipModifiers(s: Statement, index: number): number {
  let i = index;
  const skippable = new Set(["IF", "NOT", "EXISTS", "ONLY", "CONCURRENTLY", "TABLE"]);
  while (i < s.tokens.length) {
    const t = s.tokens[i];
    if (t.kind === "word" && skippable.has(t.upper)) { i += 1; continue; }
    return i;
  }
  return i;
}

function wordIndex(s: Statement, word: string, from = 0): number {
  for (let i = from; i < s.tokens.length; i += 1) {
    const t = s.tokens[i];
    if (t.kind === "word" && t.upper === word) return i;
  }
  return -1;
}

export function schemaOf(name: string | null): string | null {
  if (!name) return null;
  return name.includes(".") ? name.split(".")[0] : null;
}

/* Casts that cannot lose a value. Anything else is a rewrite that might. */
const SAFE_CASTS: [RegExp, RegExp][] = [
  [/^(?:varchar|character varying|char|character)/, /^text$/],
  [/^(?:smallint|int2)$/, /^(?:integer|int|int4|bigint|int8|numeric)/],
  [/^(?:integer|int|int4)$/, /^(?:bigint|int8|numeric)/],
  [/^(?:real|float4)$/, /^(?:double precision|float8|numeric)/],
  [/^(?:timestamp|timestamp without time zone)$/, /^(?:timestamptz|timestamp with time zone)$/],
  [/^json$/, /^jsonb$/],
];

export function isSafeCast(from: string, to: string): boolean {
  const a = from.toLowerCase().trim();
  const b = to.toLowerCase().trim();
  if (a === b) return true;
  return SAFE_CASTS.some(([x, y]) => x.test(a) && y.test(b));
}

export type ClassifyContext = {
  /** Current type of a column, for judging ALTER COLUMN … TYPE. */
  columnType?: (table: string, column: string) => string | null;
  /** Estimated rows in a table, for flagging locks on large ones. */
  rows?: (table: string) => number;
};

const FORBIDDEN_FUNCTIONS = /\b(?:pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|pg_terminate_backend|pg_cancel_backend|dblink|dblink_exec)\s*\(/i;

/** One statement's risk, with what it does said plainly. */
export function classifyStatement(s: Statement, ctx: ClassifyContext = {}): Classified {
  const head = firstWords(s, 4);
  const w = words(s);
  const base = { sql: s.text, forbidden: null as string | null, table: null as string | null, concurrent: false };
  const out = (level: RiskLevel, what: string, extra: Partial<Classified> = {}): Classified => ({ ...base, level, what, ...extra });

  /* Never, whatever is approved. */
  if (FORBIDDEN_FUNCTIONS.test(s.tokens.filter((t) => t.kind !== "string").map((t) => t.text).join(" ").replace(/ \(/g, "("))) {
    return out(3, "reaches the database server's own files or processes", { forbidden: "it reaches the server's own files or processes" });
  }
  if (/^(BEGIN|COMMIT|ROLLBACK|START|SAVEPOINT|RELEASE|END|ABORT)\b/.test(head)) {
    return out(3, "controls the transaction", { forbidden: "transactions are managed by the migration runner" });
  }
  if (/^(ALTER SYSTEM|ALTER ROLE|ALTER USER|CREATE ROLE|CREATE USER|DROP ROLE|DROP USER|SET ROLE|SET SESSION|RESET ROLE|ALTER DATABASE|DROP DATABASE|CREATE DATABASE|COPY|LOAD)\b/.test(head)) {
    return out(3, "changes the server, its roles or its files", { forbidden: "roles, the server and its files are not changed from here" });
  }
  if (/^(SELECT|WITH|EXPLAIN|VALUES|TABLE|SHOW)\b/.test(head) && readOnlyCheck(s.text).ok) {
    return out(0, "reads");
  }

  /* The target, and whether it is Supabase's own. */
  let target: string | null = null;
  const after = (word: string) => {
    const i = wordIndex(s, word);
    return i === -1 ? null : nameAt(s, skipModifiers(s, i + 1))?.name ?? null;
  };
  if (/^(CREATE|ALTER|DROP)( UNLOGGED)? TABLE\b/.test(head) || head.startsWith("TRUNCATE")) target = after("TABLE") ?? after("TRUNCATE");
  else if (head.startsWith("INSERT")) target = after("INTO");
  else if (head.startsWith("UPDATE")) target = nameAt(s, skipModifiers(s, 1))?.name ?? null;
  else if (head.startsWith("DELETE")) target = after("FROM");
  else if (/POLICY|TRIGGER|INDEX/.test(head) || /^(ENABLE|DISABLE)/.test(head)) target = after("ON");
  else if (/^(CREATE|ALTER|DROP)( OR REPLACE)? (FUNCTION|VIEW|MATERIALIZED|TYPE|SCHEMA|SEQUENCE|EXTENSION)/.test(head)) {
    const kind = /FUNCTION/.test(head) ? "FUNCTION" : /VIEW/.test(head) ? "VIEW" : /TYPE/.test(head) ? "TYPE" : /SCHEMA/.test(head) ? "SCHEMA" : /SEQUENCE/.test(head) ? "SEQUENCE" : "EXTENSION";
    target = after(kind);
  } else if (head.startsWith("COMMENT")) target = after("ON") ? nameAt(s, skipModifiers(s, wordIndex(s, "ON") + 2))?.name ?? null : null;
  else if (head.startsWith("GRANT") || head.startsWith("REVOKE")) target = after("ON");

  const targetSchema = /SCHEMA/.test(head) && !/TABLE|FUNCTION|VIEW|TYPE/.test(head) ? target : schemaOf(target);
  base.table = target;
  if (targetSchema && INTERNAL_SCHEMAS.has(targetSchema)) {
    return out(3, `changes Supabase's own ${targetSchema} schema`, {
      forbidden: `${targetSchema} belongs to Supabase — change it through Supabase's own settings, not SQL`,
    });
  }

  const rows = target && ctx.rows ? ctx.rows(target) : 0;

  /* ── L3: removes or rewrites what is there ────────────────────────────── */
  if (head.startsWith("DROP")) {
    if (/^DROP (POLICY|INDEX|TRIGGER)/.test(head)) {
      return out(2, `removes ${head.split(" ")[1].toLowerCase()} ${nameAt(s, skipModifiers(s, 2))?.name ?? ""}`.trim());
    }
    return out(3, `deletes ${head.split(" ").slice(1, 2).join(" ").toLowerCase()} ${target ?? ""} and everything in it`.trim());
  }
  if (head.startsWith("TRUNCATE")) return out(3, `deletes every row in ${target}`);
  if (head.startsWith("DELETE")) {
    return has(s, "WHERE")
      ? out(3, `deletes rows from ${target} (only those matching its WHERE)`)
      : out(3, `deletes EVERY row in ${target} — no WHERE clause`);
  }
  if (head.startsWith("UPDATE")) {
    return has(s, "WHERE")
      ? out(2, `rewrites rows in ${target} that match its WHERE`)
      : out(3, `rewrites EVERY row in ${target} — no WHERE clause`);
  }
  if (head.startsWith("ALTER TABLE")) {
    if (has(s, "RENAME")) return out(3, `renames in place on ${target} — anything reading the old name breaks`);
    /* `drop column c` and the bare `drop c` delete data; `drop default`,
       `drop not null`, `drop constraint`, `drop identity` do not. */
    for (let i = wordIndex(s, "DROP"); i !== -1; i = wordIndex(s, "DROP", i + 1)) {
      const next = s.tokens[i + 1];
      const nextWord = next?.kind === "word" ? next.upper : null;
      if (nextWord && ["DEFAULT", "NOT", "CONSTRAINT", "IDENTITY", "EXPRESSION"].includes(nextWord)) continue;
      return out(3, `deletes a column of ${target} and its data`);
    }
    if (has(s, "DISABLE") && has(s, "SECURITY")) return out(3, `turns row-level security OFF on ${target} — every row becomes reachable by its grants`);
    if (has(s, "NO") && has(s, "FORCE")) return out(3, `stops forcing row-level security on ${target}`);
    if (has(s, "TYPE")) {
      const colIdx = wordIndex(s, "COLUMN");
      const column = colIdx !== -1 ? nameAt(s, colIdx + 1)?.name : null;
      const typeIdx = wordIndex(s, "TYPE");
      const to = s.tokens.slice(typeIdx + 1).filter((t) => t.kind === "word").map((t) => t.text).join(" ").split(/ USING /i)[0];
      const from = column && target && ctx.columnType ? ctx.columnType(target, column) : null;
      if (from && isSafeCast(from, to) && !has(s, "USING")) return out(2, `widens ${target}.${column} from ${from} to ${to}`);
      return out(3, `converts ${target}${column ? `.${column}` : ""} to ${to}${from ? ` from ${from}` : ""} — values that do not convert are lost or the change fails`);
    }
    if (has(s, "ENABLE") && has(s, "SECURITY")) return out(2, `turns row-level security on for ${target} — only what its policies allow stays reachable`);
    if (has(s, "FORCE") && has(s, "SECURITY")) return out(2, `forces row-level security on ${target}, for its owner too`);
    if (has(s, "SET") && has(s, "NOT") && has(s, "NULL")) return out(2, `makes a column of ${target} required`);
    if (has(s, "DROP") && has(s, "NOT") && has(s, "NULL")) return out(2, `makes a column of ${target} optional`);
    if (has(s, "DEFAULT") && (has(s, "SET") || has(s, "DROP")) && !has(s, "ADD")) return out(2, `changes a default on ${target}`);
    if (has(s, "DROP") && has(s, "CONSTRAINT")) return out(2, `removes a constraint on ${target}`);
    if (has(s, "OWNER")) return out(3, `changes who owns ${target}`, { forbidden: "ownership is not changed from here" });
    if (has(s, "ADD")) {
      if (has(s, "CONSTRAINT") || has(s, "FOREIGN") || has(s, "PRIMARY") || has(s, "UNIQUE") || has(s, "CHECK")) {
        if (has(s, "COLUMN")) { /* fall through to column handling */ }
        else return out(has(s, "VALID") ? 1 : 2, `adds a constraint to ${target}${has(s, "VALID") ? " without checking existing rows" : " — existing rows must satisfy it"}`);
      }
      const notNull = w.join(" ").includes("NOT NULL");
      const withDefault = has(s, "DEFAULT");
      if (notNull && !withDefault) return out(2, `adds a required column to ${target} with no default — fails if the table has rows`);
      if (notNull) return out(2, `adds a required column with a default to ${target}${rows > 100_000 ? ` (${rows.toLocaleString()} rows)` : ""}`);
      return out(1, `adds an optional column to ${target}`);
    }
    return out(2, `changes ${target}`);
  }

  /* ── Creating ─────────────────────────────────────────────────────────── */
  if (/^CREATE OR REPLACE/.test(head)) return out(2, `replaces ${head.split(" ")[3]?.toLowerCase() ?? "an object"} ${target ?? ""} — the old definition is overwritten`.trim());
  if (/^CREATE (UNIQUE )?INDEX/.test(head)) {
    const concurrent = has(s, "CONCURRENTLY");
    if (!concurrent && rows > 100_000) {
      return out(2, `adds an index to ${target} (${rows.toLocaleString()} rows) — writes are blocked while it builds; use CONCURRENTLY`);
    }
    return out(1, `adds an index to ${target}${has(s, "UNIQUE") ? " (existing duplicates make it fail)" : ""}`, { concurrent });
  }
  if (/^CREATE( UNLOGGED)? TABLE/.test(head)) {
    if (has(s, "AS")) return out(1, `creates ${target} as a copy of a query`);
    return out(1, `creates a new table ${target}`);
  }
  if (/^CREATE POLICY/.test(head)) {
    const forIdx = wordIndex(s, "FOR");
    const cmd = forIdx !== -1 ? (s.tokens[forIdx + 1] as { upper?: string }).upper?.toLowerCase() ?? "all" : "all";
    return out(1, `adds a ${cmd} access rule on ${target}`);
  }
  if (/^ALTER POLICY/.test(head)) return out(2, `rewrites an access rule on ${target}`);
  if (/^CREATE (FUNCTION|VIEW|TYPE|SCHEMA|SEQUENCE|TRIGGER|MATERIALIZED|EXTENSION)/.test(head) || /^CREATE (CONSTRAINT )?TRIGGER/.test(head)) {
    const kind = head.split(" ")[1].toLowerCase();
    if (kind === "function" && has(s, "DEFINER") && !has(s, "SEARCH_PATH")) {
      return out(2, `creates a security-definer function ${target} without a fixed search_path — anyone who can create objects could hijack it`);
    }
    return out(1, `creates a ${kind === "materialized" ? "materialized view" : kind} ${target ?? ""}`.trim());
  }
  if (/^ALTER TYPE/.test(head)) return has(s, "ADD") && has(s, "VALUE") ? out(1, `adds a value to the ${target} enum`) : out(2, `changes the ${target} type`);
  if (/^(ALTER FUNCTION|ALTER VIEW)/.test(head)) return out(2, `changes ${target}`);
  if (head.startsWith("COMMENT")) return out(1, "adds a description");
  if (head.startsWith("INSERT")) {
    if (has(s, "CONFLICT") && has(s, "UPDATE")) return out(2, `adds rows to ${target}, overwriting ones that already exist`);
    return out(1, `adds rows to ${target}`);
  }
  if (head.startsWith("GRANT")) return out(2, `gives access on ${target}`);
  if (head.startsWith("REVOKE")) return out(2, `takes access away on ${target}`);
  if (head.startsWith("NOTIFY")) return out(0, "tells the API to reload");
  if (head.startsWith("DO")) return out(3, "runs a block of procedural code that cannot be reviewed statement by statement");
  if (head.startsWith("SET")) return out(0, "sets a session option");
  return out(3, `does something QuickStark does not recognise (${head.toLowerCase()})`);
}

export function classify(sql: string, ctx?: ClassifyContext): Classified[] {
  return tokenize(sql).map((s) => classifyStatement(s, ctx));
}

/** The highest level of any statement — what the approval card asks for. */
export function overallLevel(items: Classified[]): RiskLevel {
  return items.reduce<RiskLevel>((max, item) => (item.level > max ? item.level : max), 0);
}
