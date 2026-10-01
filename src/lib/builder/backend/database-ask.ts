/* Running SQL on a project's own database, from the conversation.
 *
 * The platform already holds what it takes: when somebody connects their
 * Supabase, the builder is given the means to run SQL there (see runnerFor),
 * and provisioning uses it to create tables. What it could not do was the
 * thing a developer with the same access does every day — "add a phone column
 * to profiles", "seed ten listings", "show me the last viewing requests", or a
 * block of SQL somebody pasted. Those were read as edits to the page, and the
 * page has no idea what a column is.
 *
 * So a message that is SQL, or asks for something in the database in so many
 * words, is answered against the database:
 *
 *   SAFE      reads, inserts and anything that only creates — tables, columns,
 *             indexes, policies, row-level security — run straight away.
 *   RISKY     anything that removes or rewrites what is there — drop, delete,
 *             truncate, update, rename, a type change, permissions, disabling
 *             RLS — is shown first and runs only on an explicit "Run it", and
 *             only the exact SQL that was shown.
 *   REFUSED   reading or writing the database server's own files, and
 *             anything on the shared instance, where other people's projects
 *             live in the same database.
 *
 * Pure apart from generateSql, which asks a model and is imported lazily. */

/* ── Recognising a database request ─────────────────────────────────────── */

const FENCED = /```(?:sql|postgres|postgresql|pgsql|psql)?\s*\n([\s\S]+?)```/i;

/* A message that IS SQL: it opens with a statement keyword and reads like one. */
const BARE_SQL =
  /^\s*(?:select|insert\s+into|update\s+\w|delete\s+from|create\s+(?:table|index|unique\s+index|policy|type|view|function|or\s+replace|extension|schema|trigger)|alter\s+(?:table|type|policy|view)|drop\s+(?:table|index|policy|type|view|function|column)|truncate|grant|revoke|comment\s+on|with\s+\w+\s+as\s*\(|do\s+\$\$)\b[\s\S]*(?:;|\bfrom\b|\bvalues\b|\(|\bset\b)/i;

/** The SQL in a message, when the message carries some. */
export function sqlFromMessage(message: string): string | null {
  const fenced = message.match(FENCED);
  if (fenced) return fenced[1].trim();
  return BARE_SQL.test(message) ? message.trim() : null;
}

/* Something to do to data or structure. */
const DB_VERB =
  /\b(add|create|make|drop|delete|remove|rename|insert|seed|populate|backfill|update|change|alter|truncate|clear|empty|show|list|count|query|select|fetch|find|how many|run|execute|apply|grant|revoke|index)\b/i;

/* Somewhere that can only be the database. "the pricing table" on a landing
   page is HTML; "the profiles table", a snake_case name, or the word
   database is not. */
const DB_WORDS = /\b(databases?|db|supabase|sql|schema|migrations?|rls|row[- ]level security|postgres)\b/i;
const SNAKE = /\b[a-z]+_[a-z0-9_]+\b/;
const NAMED_TABLE = /\b(?:the|my|our|in|to|from|into|on)\s+(?!pricing\b|comparison\b|html\b|size\b|feature\b|features\b|price\b|specs?\b|data\b)([a-z][a-z0-9_]*)\s+table\b/i;
const DB_NOUN = /\b(columns?|rows?|records?|tables?|indexes|index|policy|policies|seed data|foreign keys?)\b/i;

/* Words about the page, which outrank a vague database reading. */
const PAGE_WORDS = /\b(page|section|button|hero|header|footer|nav|navbar|menu|card|layout|image|photo|font|colou?r|style|styling|design|mobile|form)\b/i;

/**
 * Whether a plain-English message is asking for something in the database.
 * Deliberately narrow: a false yes runs SQL somebody did not ask for.
 */
export function isDatabaseAsk(message: string): boolean {
  const m = message.trim();
  if (!m || !DB_VERB.test(m)) return false;
  const explicit = DB_WORDS.test(m) || NAMED_TABLE.test(m);
  /* A snake_case name is a table or a column; with a noun like "rows", or a
     read verb ("show me the latest viewing_requests"), it is a database ask. */
  const structural = SNAKE.test(m) && (DB_NOUN.test(m) || /\b(show|list|count|how many|fetch|query|select)\b/i.test(m));
  if (!explicit && !structural) return false;
  /* "make the signup form save to the database" is the page-data path's, and
     anything that is mostly about the page stays with the page. */
  if (PAGE_WORDS.test(m) && !DB_NOUN.test(m) && !/\bsql\b/i.test(m)) return false;
  return true;
}

/* ── Judging SQL before it runs ─────────────────────────────────────────── */

function bare(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Statements, split on semicolons outside quotes and $$ bodies. */
export function splitStatements(sql: string): string[] {
  const text = bare(sql);
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!quote && text.startsWith("$$", i)) {
      quote = "$$";
      current += "$$";
      i += 1;
      continue;
    }
    if (quote === "$$" && text.startsWith("$$", i)) {
      quote = null;
      current += "$$";
      i += 1;
      continue;
    }
    if (!quote && (ch === "'" || ch === '"')) quote = ch;
    else if (quote === ch && quote !== "$$") quote = null;
    if (ch === ";" && !quote) {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/* Never, whoever asks: the server's own files and processes. */
const FORBIDDEN = [
  /\bcopy\b[\s\S]*\b(?:from|to)\s+(?:program|'\/)/i,
  /\bpg_read_(?:file|binary_file)\b/i,
  /\bpg_ls_dir\b/i,
  /\blo_(?:import|export)\b/i,
  /\bpg_(?:terminate|cancel)_backend\b/i,
  /\bdblink\b/i,
  /\balter\s+system\b/i,
];

/* Changes or removes what is already there. Shown first, run on a yes. */
const RISKY = [
  /^drop\b/i,
  /^delete\b/i,
  /^truncate\b/i,
  /^update\b/i,
  /^grant\b/i,
  /^revoke\b/i,
  /^alter\s+(?:table|type|view|policy|function|schema)\b[\s\S]*\b(?:drop|rename|alter\s+column|type\s|set\s+data\s+type|owner\s+to|disable\s+row\s+level\s+security|no\s+force)\b/i,
  /^alter\s+(?:role|user|database|default\s+privileges)\b/i,
  /^create\s+or\s+replace\b/i,
  /\bon\s+conflict\b[\s\S]*\bdo\s+update\b/i,
  /^with\b[\s\S]*\b(?:delete|update)\b/i,
  /^do\b/i,
];

export type Judged = {
  statements: string[];
  risky: string[];
  forbidden: string[];
  /** Whether anything changes the schema, so the API is told to reload it. */
  ddl: boolean;
};

export function judgeSql(sql: string): Judged {
  const statements = splitStatements(sql);
  const flat = (statement: string) => statement.replace(/\s+/g, " ").trim();
  return {
    statements,
    risky: statements.filter((statement) => RISKY.some((pattern) => pattern.test(flat(statement)))).map(flat),
    forbidden: statements.filter((statement) => FORBIDDEN.some((pattern) => pattern.test(statement))).map(flat),
    ddl: statements.some((statement) => /^(?:create|alter|drop|comment|grant|revoke)\b/i.test(flat(statement))),
  };
}

/** The SQL as it is sent: in the app's schema, with the API told about new tables. */
export function wrapSql(statements: string[], schema: string, ddl: boolean): string {
  const prefix = schema && schema !== "public" ? [`set search_path to "${schema.replace(/"/g, "")}", public`] : [];
  const suffix = ddl ? ["notify pgrst, 'reload schema'"] : [];
  return `${[...prefix, ...statements, ...suffix].join(";\n")};`;
}

/* ── Saying what happened ───────────────────────────────────────────────── */

function cell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  const flat = text.replace(/\s+/g, " ").replace(/\|/g, "\\|");
  return flat.length > 40 ? `${flat.slice(0, 39)}…` : flat;
}

/** Rows as a small markdown table — enough to read, never a dump. */
export function formatRows(rows: unknown[], limit = 20): string {
  const objects = rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  if (objects.length === 0) return "No rows.";
  const columns = [...new Set(objects.flatMap((row) => Object.keys(row)))].slice(0, 8);
  const head = `| ${columns.join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |`;
  const body = objects.slice(0, limit).map((row) => `| ${columns.map((column) => cell(row[column])).join(" | ")} |`).join("\n");
  const more = objects.length > limit ? `\n\n…and ${objects.length - limit} more rows.` : "";
  return `${head}\n${body}${more}`;
}

/* ── Turning a request into SQL ─────────────────────────────────────────── */

const SYSTEM = `You write PostgreSQL for a Supabase project, from one request by its owner.

Reply with ONLY the SQL — no prose, no markdown fences. Use the tables and columns listed; never invent one that the request does not ask to create.

Rules:
- New tables: primary key id uuid default gen_random_uuid(), created_at timestamptz default now(), row level security enabled, and policies for who may read and write. A table holding a person's data has a user_id uuid references auth.users(id) and policies on auth.uid() = user_id.
- Prefer "if not exists" and additive changes. Only remove, rename or rewrite when the request explicitly says to.
- Seeding: realistic, varied values that fit the columns' types and constraints.
- Reading: one SELECT, with a sensible LIMIT (50 or fewer) and ORDER BY.
- Never touch the auth, storage or extensions schemas except to reference auth.users and auth.uid().`;

/** A short description of what is in the database, for the model. */
export function describeTables(
  tables: { schema: string; name: string; columns: { name: string; type: string; notNull: boolean }[] }[],
): string {
  if (tables.length === 0) return "(the database has no tables yet)";
  return tables
    .slice(0, 60)
    .map((table) => `${table.schema}.${table.name}(${table.columns.map((column) => `${column.name} ${column.type}${column.notNull ? " not null" : ""}`).join(", ")})`)
    .join("\n");
}

/** SQL for a plain-English request, written against the tables there are. */
export async function generateSql(request: string, tables: string): Promise<{ ok: true; sql: string; outputTokens: number } | { ok: false; reason: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "this workspace has no ANTHROPIC_API_KEY" };
  try {
    const [{ default: Anthropic }, { modelById }] = await Promise.all([
      import("@anthropic-ai/sdk"),
      import("@/app/dashboard/models"),
    ]);
    const answer = await new Anthropic().messages.create({
      model: modelById("claude-sonnet-5").apiId ?? "claude-sonnet-5",
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{ role: "user", content: `The database now:\n${tables}\n\nThe request: ${request.trim()}` }],
    });
    const text = answer.content.map((block) => (block.type === "text" ? block.text : "")).join("").trim();
    const sql = (text.match(FENCED)?.[1] ?? text).trim();
    if (!sql) return { ok: false, reason: "no SQL came back" };
    return { ok: true, sql, outputTokens: answer.usage?.output_tokens ?? 0 };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "the SQL could not be written" };
  }
}
