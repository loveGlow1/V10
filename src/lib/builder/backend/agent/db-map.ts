/* The Database Map: everything about a connected database the agent needs to
 * reason with, read in one query and kept with the project as db-map.json.
 *
 * inspect.ts reads just enough to avoid colliding with somebody's tables
 * during a build. This reads all of it — keys, foreign keys, constraints,
 * indexes, row estimates, RLS and the text of every policy, triggers, views,
 * functions, enums, extensions, the size of auth.users, buckets — because the
 * agent's first job is to understand a database it did not make, and its
 * second is to change as little of it as possible. Both need the whole map.
 *
 * Read-only by construction: catalogue selects and count(*) on auth.users,
 * nothing else; it runs through query_readonly. Never reads a row of user
 * data — sampling is a separate, masked step (see untrusted.ts).
 *
 * Pure apart from the SQL it writes. Asserted by tools/check-db-agent.mjs.
 */

export type MapColumn = {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  identity: boolean;
  /** The enum's name when the column is one. */
  enumName: string | null;
  comment: string | null;
};

export type ForeignKey = {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onDelete: string;
};

export type MapPolicy = {
  name: string;
  command: "select" | "insert" | "update" | "delete" | "all";
  roles: string[];
  permissive: boolean;
  using: string | null;
  withCheck: string | null;
};

export type MapTable = {
  schema: string;
  name: string;
  kind: "table" | "view" | "materialized view" | "foreign table" | "partitioned table";
  comment: string | null;
  columns: MapColumn[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
  unique: string[][];
  checks: { name: string; definition: string }[];
  indexes: { name: string; definition: string; columns: string[]; unique: boolean }[];
  /** pg_class.reltuples, or live tuples when the estimate has never been taken. */
  rowEstimate: number;
  rls: boolean;
  forceRls: boolean;
  policies: MapPolicy[];
  triggers: { name: string; definition: string }[];
  /** Commands each API role holds on it. */
  grants: { anon: string[]; authenticated: string[] };
  /** Writes since statistics were last reset — an activity signal, not a count of users. */
  writes: number;
};

export type MapFunction = {
  schema: string;
  name: string;
  arguments: string;
  returns: string;
  securityDefiner: boolean;
  /** Whether it pins search_path, which a security-definer function must. */
  fixedSearchPath: boolean;
  language: string;
  comment: string | null;
};

export type DatabaseMap = {
  version: 1;
  ref: string;
  scannedAt: string;
  /** Changes whenever the structure changes; compared before a surgery runs. */
  fingerprint: string;
  schemas: string[];
  tables: MapTable[];
  functions: MapFunction[];
  enums: { schema: string; name: string; values: string[] }[];
  extensions: { name: string; version: string }[];
  auth: {
    users: number;
    providers: string[];
    siteUrl: string | null;
    redirectUrls: string[];
    /** Tables with a foreign key to auth.users(id) — candidates for the profile. */
    profileCandidates: string[];
  };
  buckets: { name: string; public: boolean }[];
  advisors: Advisor[];
  migrations: { version: string; name: string }[];
  /** Instruction-like text found in comments, defaults or function bodies. */
  flagged: { where: string; excerpt: string }[];
};

export type Advisor = {
  type: "security" | "performance";
  level: "ERROR" | "WARN" | "INFO";
  name: string;
  title: string;
  detail: string;
  /** schema.table it concerns, where it names one. */
  object: string | null;
};

/* Supabase's own schemas. Their tables are not the app's to wire or change;
   auth and storage are read through the API, not listed as tables. */
export const SYSTEM_SCHEMAS = [
  "auth", "storage", "realtime", "supabase_functions", "supabase_migrations", "extensions",
  "graphql", "graphql_public", "pgsodium", "pgsodium_masks", "vault", "net", "cron", "pgbouncer",
  "pg_catalog", "information_schema", "pg_toast", "_realtime", "_analytics", "pgtle",
];

const quoted = (names: string[]) => names.map((n) => `'${n.replace(/'/g, "''")}'`).join(", ");

/**
 * The whole map, as one JSON value from one SELECT.
 *
 * Every schema that is not Supabase's own is read; `auth.users` contributes a
 * count and the tables that reference it, never a row.
 */
export function introspectSql(): string {
  const system = quoted(SYSTEM_SCHEMAS);
  return `select json_build_object(
  'schemas', coalesce((select json_agg(nspname order by nspname) from pg_namespace where nspname not in (${system}) and nspname not like 'pg_%'), '[]'::json),
  'tables', coalesce((
    select json_agg(json_build_object(
      'schema', n.nspname,
      'name', c.relname,
      'kind', c.relkind,
      'comment', obj_description(c.oid, 'pg_class'),
      'rls', c.relrowsecurity,
      'forceRls', c.relforcerowsecurity,
      'rowEstimate', greatest(c.reltuples::bigint, coalesce(s.n_live_tup, 0)),
      'writes', coalesce(s.n_tup_ins + s.n_tup_upd + s.n_tup_del, 0),
      'columns', (
        select coalesce(json_agg(json_build_object(
          'name', a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'nullable', not a.attnotnull,
          'default', pg_get_expr(d.adbin, d.adrelid),
          'identity', a.attidentity <> '',
          'enumName', case when t.typtype = 'e' then t.typname end,
          'comment', col_description(c.oid, a.attnum)
        ) order by a.attnum), '[]'::json)
        from pg_attribute a
        join pg_type t on t.oid = a.atttypid
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      ),
      'primaryKey', (
        select coalesce(json_agg(a.attname order by k.ord), '[]'::json)
        from pg_constraint pk
        cross join lateral unnest(pk.conkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = pk.conrelid and a.attnum = k.attnum
        where pk.conrelid = c.oid and pk.contype = 'p'
      ),
      'foreignKeys', (
        select coalesce(json_agg(json_build_object(
          'name', fk.conname,
          'columns', (select json_agg(a.attname order by k.ord) from unnest(fk.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = k.attnum),
          'refSchema', rn.nspname,
          'refTable', rc.relname,
          'refColumns', (select json_agg(a.attname order by k.ord) from unnest(fk.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = fk.confrelid and a.attnum = k.attnum),
          'onDelete', fk.confdeltype
        )), '[]'::json)
        from pg_constraint fk
        join pg_class rc on rc.oid = fk.confrelid
        join pg_namespace rn on rn.oid = rc.relnamespace
        where fk.conrelid = c.oid and fk.contype = 'f'
      ),
      'unique', (
        select coalesce(json_agg((select json_agg(a.attname) from unnest(u.conkey) k(attnum) join pg_attribute a on a.attrelid = u.conrelid and a.attnum = k.attnum)), '[]'::json)
        from pg_constraint u where u.conrelid = c.oid and u.contype = 'u'
      ),
      'checks', (
        select coalesce(json_agg(json_build_object('name', ck.conname, 'definition', pg_get_constraintdef(ck.oid))), '[]'::json)
        from pg_constraint ck where ck.conrelid = c.oid and ck.contype = 'c'
      ),
      'indexes', (
        select coalesce(json_agg(json_build_object(
          'name', ic.relname,
          'definition', pg_get_indexdef(i.indexrelid),
          'unique', i.indisunique,
          'columns', (select coalesce(json_agg(a.attname), '[]'::json) from unnest(i.indkey) k(attnum) join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum)
        )), '[]'::json)
        from pg_index i join pg_class ic on ic.oid = i.indexrelid
        where i.indrelid = c.oid
      ),
      'policies', (
        select coalesce(json_agg(json_build_object(
          'name', p.polname,
          'command', p.polcmd,
          'permissive', p.polpermissive,
          'roles', (select coalesce(json_agg(case when r = 0 then 'public' else (select rolname from pg_roles where oid = r) end), '[]'::json) from unnest(p.polroles) r),
          'using', pg_get_expr(p.polqual, p.polrelid),
          'withCheck', pg_get_expr(p.polwithcheck, p.polrelid)
        ) order by p.polname), '[]'::json)
        from pg_policy p where p.polrelid = c.oid
      ),
      'triggers', (
        select coalesce(json_agg(json_build_object('name', tg.tgname, 'definition', pg_get_triggerdef(tg.oid))), '[]'::json)
        from pg_trigger tg where tg.tgrelid = c.oid and not tg.tgisinternal
      ),
      'grants', json_build_object(
        'anon', (select coalesce(json_agg(cmd), '[]'::json) from unnest(array['select', 'insert', 'update', 'delete']) cmd where exists (select 1 from pg_roles where rolname = 'anon') and has_table_privilege('anon', c.oid, cmd)),
        'authenticated', (select coalesce(json_agg(cmd), '[]'::json) from unnest(array['select', 'insert', 'update', 'delete']) cmd where exists (select 1 from pg_roles where rolname = 'authenticated') and has_table_privilege('authenticated', c.oid, cmd))
      )
    ) order by n.nspname, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_user_tables s on s.relid = c.oid
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and n.nspname not in (${system}) and n.nspname not like 'pg_%'
      and not exists (select 1 from pg_depend dep where dep.objid = c.oid and dep.deptype = 'e')
  ), '[]'::json),
  'functions', coalesce((
    select json_agg(json_build_object(
      'schema', n.nspname,
      'name', p.proname,
      'arguments', pg_get_function_identity_arguments(p.oid),
      'returns', pg_get_function_result(p.oid),
      'securityDefiner', p.prosecdef,
      'fixedSearchPath', exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'),
      'language', l.lanname,
      'comment', obj_description(p.oid, 'pg_proc')
    ) order by n.nspname, p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname not in (${system}) and n.nspname not like 'pg_%' and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')
  ), '[]'::json),
  'enums', coalesce((
    select json_agg(json_build_object('schema', n.nspname, 'name', t.typname, 'values', (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)))
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typtype = 'e' and n.nspname not in (${system}) and n.nspname not like 'pg_%'
  ), '[]'::json),
  'extensions', coalesce((select json_agg(json_build_object('name', extname, 'version', extversion) order by extname) from pg_extension), '[]'::json),
  'authUsers', (select case when to_regclass('auth.users') is null then 0 else (select count(*) from auth.users) end),
  'profileCandidates', coalesce((
    select json_agg(distinct n.nspname || '.' || c.relname)
    from pg_constraint fk
    join pg_class c on c.oid = fk.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where fk.contype = 'f' and fk.confrelid = to_regclass('auth.users') and n.nspname not in (${system})
  ), '[]'::json),
  'buckets', coalesce((select json_agg(json_build_object('name', id, 'public', public)) from storage.buckets), '[]'::json)
) as map;`;
}

/* ── Parsing ──────────────────────────────────────────────────────────────── */

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strings = (v: unknown): string[] => arr(v).map(str).filter((s): s is string => s !== null);
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : 0);

const KIND: Record<string, MapTable["kind"]> = { r: "table", p: "partitioned table", v: "view", m: "materialized view", f: "foreign table" };
const COMMAND: Record<string, MapPolicy["command"]> = { r: "select", a: "insert", w: "update", d: "delete", "*": "all" };
const ON_DELETE: Record<string, string> = { a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" };

/** Stable hash of the structure, so "has it changed since the plan" is one comparison. */
export function fingerprintOf(tables: MapTable[], functions: MapFunction[], enums: DatabaseMap["enums"]): string {
  const shape = JSON.stringify({
    t: tables.map((t) => [t.schema, t.name, t.rls, t.columns.map((c) => [c.name, c.type, c.nullable, c.default]), t.policies.map((p) => [p.name, p.command, p.using, p.withCheck]), t.foreignKeys.map((f) => f.name), t.indexes.map((i) => i.name)]),
    f: functions.map((f) => [f.schema, f.name, f.arguments, f.securityDefiner]),
    e: enums.map((e) => [e.schema, e.name, e.values]),
  });
  /* FNV-1a, twice with different seeds: no crypto import, so this file stays
     loadable by the offline check and in the browser. */
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < shape.length; i += 1) {
    a = Math.imul(a ^ shape.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ shape.charCodeAt(i), 0x5bd1e995) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

/** The query's answer, however the API wrapped it. Null when it is unreadable — never an empty database. */
export function parseMap(
  result: unknown,
  extra: {
    ref: string;
    scannedAt?: string;
    providers?: string[];
    siteUrl?: string | null;
    redirectUrls?: string[];
    advisors?: Advisor[];
    migrations?: { version: string; name: string }[];
    buckets?: { name: string; public: boolean }[];
  },
): DatabaseMap | null {
  let value: unknown = result;
  if (Array.isArray(value)) value = value[0];
  if (value && typeof value === "object" && "map" in (value as object)) value = (value as { map: unknown }).map;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  const raw = rec(value);
  if (!Array.isArray(raw.tables)) return null;

  const tables: MapTable[] = arr(raw.tables).map((entry) => {
    const t = rec(entry);
    const grants = rec(t.grants);
    return {
      schema: str(t.schema) ?? "public",
      name: str(t.name) ?? "",
      kind: KIND[str(t.kind) ?? "r"] ?? "table",
      comment: str(t.comment),
      rls: t.rls === true,
      forceRls: t.forceRls === true,
      rowEstimate: Math.max(0, Math.round(num(t.rowEstimate))),
      writes: Math.max(0, Math.round(num(t.writes))),
      columns: arr(t.columns).map((c) => {
        const col = rec(c);
        return {
          name: str(col.name) ?? "",
          type: str(col.type) ?? "",
          nullable: col.nullable !== false,
          default: str(col.default),
          identity: col.identity === true,
          enumName: str(col.enumName),
          comment: str(col.comment),
        };
      }),
      primaryKey: strings(t.primaryKey),
      foreignKeys: arr(t.foreignKeys).map((f) => {
        const fk = rec(f);
        return {
          name: str(fk.name) ?? "",
          columns: strings(fk.columns),
          refSchema: str(fk.refSchema) ?? "public",
          refTable: str(fk.refTable) ?? "",
          refColumns: strings(fk.refColumns),
          onDelete: ON_DELETE[str(fk.onDelete) ?? "a"] ?? "no action",
        };
      }),
      unique: arr(t.unique).map(strings),
      checks: arr(t.checks).map((c) => ({ name: str(rec(c).name) ?? "", definition: str(rec(c).definition) ?? "" })),
      indexes: arr(t.indexes).map((i) => {
        const ix = rec(i);
        return { name: str(ix.name) ?? "", definition: str(ix.definition) ?? "", columns: strings(ix.columns), unique: ix.unique === true };
      }),
      policies: arr(t.policies).map((p) => {
        const pol = rec(p);
        return {
          name: str(pol.name) ?? "",
          command: COMMAND[str(pol.command) ?? "*"] ?? "all",
          roles: strings(pol.roles),
          permissive: pol.permissive !== false,
          using: str(pol.using),
          withCheck: str(pol.withCheck),
        };
      }),
      triggers: arr(t.triggers).map((g) => ({ name: str(rec(g).name) ?? "", definition: str(rec(g).definition) ?? "" })),
      grants: { anon: strings(grants.anon), authenticated: strings(grants.authenticated) },
    };
  });

  const functions: MapFunction[] = arr(raw.functions).map((entry) => {
    const f = rec(entry);
    return {
      schema: str(f.schema) ?? "public",
      name: str(f.name) ?? "",
      arguments: str(f.arguments) ?? "",
      returns: str(f.returns) ?? "",
      securityDefiner: f.securityDefiner === true,
      fixedSearchPath: f.fixedSearchPath === true,
      language: str(f.language) ?? "",
      comment: str(f.comment),
    };
  });

  const enums = arr(raw.enums).map((entry) => {
    const e = rec(entry);
    return { schema: str(e.schema) ?? "public", name: str(e.name) ?? "", values: strings(e.values) };
  });

  const map: DatabaseMap = {
    version: 1,
    ref: extra.ref,
    scannedAt: extra.scannedAt ?? new Date().toISOString(),
    fingerprint: fingerprintOf(tables, functions, enums),
    schemas: strings(raw.schemas),
    tables,
    functions,
    enums,
    extensions: arr(raw.extensions).map((e) => ({ name: str(rec(e).name) ?? "", version: str(rec(e).version) ?? "" })),
    auth: {
      users: Math.round(num(raw.authUsers)),
      providers: extra.providers ?? [],
      siteUrl: extra.siteUrl ?? null,
      redirectUrls: extra.redirectUrls ?? [],
      profileCandidates: strings(raw.profileCandidates).sort(),
    },
    buckets: extra.buckets ?? arr(raw.buckets).map((b) => ({ name: str(rec(b).name) ?? "", public: rec(b).public === true })),
    advisors: extra.advisors ?? [],
    migrations: extra.migrations ?? [],
    flagged: [],
  };
  return map;
}

/* ── Advisors ─────────────────────────────────────────────────────────────── */

/** Supabase's lint output ({ lints: [...] }), normalised. */
export function parseAdvisors(body: unknown, type: Advisor["type"]): Advisor[] {
  const lints = Array.isArray(body) ? body : arr(rec(body).lints);
  return lints.map((entry) => {
    const l = rec(entry);
    const meta = rec(l.metadata);
    const schema = str(meta.schema);
    const name = str(meta.name);
    const level = str(l.level)?.toUpperCase();
    return {
      type,
      level: level === "ERROR" || level === "WARN" ? level : "INFO",
      name: str(l.name) ?? "",
      title: str(l.title) ?? str(l.name) ?? "",
      detail: str(l.detail) ?? str(l.description) ?? "",
      object: schema && name ? `${schema}.${name}` : null,
    } as Advisor;
  });
}

/* ── Analysis ─────────────────────────────────────────────────────────────── */

export type HealthIssue = {
  severity: "red" | "amber" | "info";
  kind: "rls_off" | "rls_no_policy" | "fk_unindexed" | "definer_search_path" | "public_bucket" | "advisor" | "flagged_content" | "no_primary_key";
  object: string;
  message: string;
  /** SQL that would fix it, for a surgery the owner can approve. Never run from here. */
  fix: string | null;
};

export type Relationship = { from: string; columns: string[]; to: string; refColumns: string[] };

export type AnalysisReport = {
  headline: string;
  tables: number;
  views: number;
  users: number;
  providers: string[];
  buckets: number;
  domain: { label: string; confidence: "high" | "medium" | "low"; entities: string[] } | null;
  relationships: Relationship[];
  /** Mermaid erDiagram, for the Map view. */
  diagram: string;
  health: HealthIssue[];
  production: { level: "HIGH" | "LOW"; reasons: string[] };
};

const q = (name: string) => (/^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`);
export const qualified = (schema: string, name: string) => `${q(schema)}.${q(name)}`;

/* Signals for what a product is, by the tables it keeps. */
const DOMAINS: { label: string; words: string[] }[] = [
  { label: "a booking system", words: ["booking", "bookings", "appointment", "appointments", "reservation", "reservations", "slot", "slots", "service", "services", "staff", "availability", "schedule", "schedules"] },
  { label: "an online store", words: ["product", "products", "order", "orders", "order_items", "cart", "carts", "cart_items", "inventory", "sku", "skus", "checkout", "coupons", "variants"] },
  { label: "a blog or publication", words: ["post", "posts", "article", "articles", "author", "authors", "comment", "comments", "tags", "categories"] },
  { label: "a CRM", words: ["contact", "contacts", "lead", "leads", "deal", "deals", "company", "companies", "pipeline", "pipelines", "activities"] },
  { label: "a learning platform", words: ["course", "courses", "lesson", "lessons", "enrollment", "enrollments", "quiz", "quizzes", "student", "students", "modules"] },
  { label: "a property listings site", words: ["property", "properties", "listing", "listings", "agent", "agents", "viewing", "viewings", "viewing_requests", "favorites"] },
  { label: "a restaurant", words: ["menu", "menus", "menu_items", "dish", "dishes", "table_bookings", "orders"] },
  { label: "a project tracker", words: ["project", "projects", "task", "tasks", "issue", "issues", "sprint", "sprints", "milestones", "boards"] },
  { label: "a community or social app", words: ["follow", "follows", "followers", "like", "likes", "message", "messages", "conversation", "conversations", "friends", "posts"] },
];

export function detectDomain(map: DatabaseMap): AnalysisReport["domain"] {
  const names = new Set(map.tables.filter((t) => t.kind !== "view").map((t) => t.name.toLowerCase()));
  let best: { label: string; hits: string[] } | null = null;
  for (const domain of DOMAINS) {
    const hits = domain.words.filter((w) => names.has(w));
    if (!best || hits.length > best.hits.length) best = { label: domain.label, hits };
  }
  if (!best || best.hits.length === 0) return null;
  return {
    label: best.label,
    confidence: best.hits.length >= 3 ? "high" : best.hits.length === 2 ? "medium" : "low",
    entities: best.hits,
  };
}

function erDiagram(map: DatabaseMap, relationships: Relationship[]): string {
  const lines = ["erDiagram"];
  for (const t of map.tables.filter((t) => t.kind !== "view").slice(0, 40)) {
    const cols = t.columns.slice(0, 12).map((c) => `    ${c.type.replace(/[^a-zA-Z0-9_]/g, "_")} ${c.name.replace(/[^a-zA-Z0-9_]/g, "_")}${t.primaryKey.includes(c.name) ? " PK" : t.foreignKeys.some((f) => f.columns.includes(c.name)) ? " FK" : ""}`);
    lines.push(`  ${t.name} {`, ...cols, "  }");
  }
  for (const r of relationships) {
    const from = r.from.split(".").pop();
    const to = r.to.split(".").pop();
    lines.push(`  ${to} ||--o{ ${from} : "${r.columns.join(",")}"`);
  }
  return lines.join("\n");
}

const PRODUCTION_ROWS = 1000;
const PRODUCTION_USERS = 50;

/** "Your database at a glance", the health list, and how careful to be. */
export function analyze(map: DatabaseMap, options: { recentWrites?: boolean } = {}): AnalysisReport {
  const tables = map.tables.filter((t) => t.kind === "table" || t.kind === "partitioned table");
  const views = map.tables.filter((t) => t.kind === "view" || t.kind === "materialized view");
  const relationships: Relationship[] = map.tables.flatMap((t) =>
    t.foreignKeys.map((f) => ({ from: `${t.schema}.${t.name}`, columns: f.columns, to: `${f.refSchema}.${f.refTable}`, refColumns: f.refColumns })),
  );

  const health: HealthIssue[] = [];
  for (const t of tables) {
    const name = qualified(t.schema, t.name);
    const exposed = t.grants.anon.length > 0 || t.grants.authenticated.length > 0;
    if (!t.rls && exposed) {
      health.push({
        severity: "red",
        kind: "rls_off",
        object: `${t.schema}.${t.name}`,
        message: `Row-level security is OFF on ${t.name}: anyone with the app's public key can ${t.grants.anon.length ? t.grants.anon.join(", ") : t.grants.authenticated.join(", ")} every row.`,
        fix: null,
      });
    } else if (t.rls && t.policies.length === 0 && exposed) {
      health.push({
        severity: "amber",
        kind: "rls_no_policy",
        object: `${t.schema}.${t.name}`,
        message: `${t.name} has row-level security on and no policies, so the app can't read or write it at all.`,
        fix: null,
      });
    }
    if (t.primaryKey.length === 0) {
      health.push({ severity: "info", kind: "no_primary_key", object: `${t.schema}.${t.name}`, message: `${t.name} has no primary key, so rows can't be updated or deleted one at a time from the app.`, fix: null });
    }
    for (const f of t.foreignKeys) {
      const indexed = t.indexes.some((i) => f.columns.every((c, n) => i.columns[n] === c));
      if (!indexed) {
        const ix = `${t.name}_${f.columns.join("_")}_idx`.slice(0, 63);
        health.push({
          severity: "amber",
          kind: "fk_unindexed",
          object: `${t.schema}.${t.name}`,
          message: `${t.name}.${f.columns.join(", ")} links to ${f.refTable} but has no index, so joins and deletes on ${f.refTable} get slower as it grows.`,
          fix: `create index${t.rowEstimate > 100_000 ? " concurrently" : ""} if not exists ${q(ix)} on ${name} (${f.columns.map(q).join(", ")});`,
        });
      }
    }
  }
  for (const f of map.functions) {
    if (f.securityDefiner && !f.fixedSearchPath) {
      health.push({
        severity: "amber",
        kind: "definer_search_path",
        object: `${f.schema}.${f.name}`,
        message: `${f.name}() runs with its owner's rights and does not pin search_path, so another object with the same name could be run in its place.`,
        fix: `alter function ${qualified(f.schema, f.name)}(${f.arguments}) set search_path = '';`,
      });
    }
  }
  for (const b of map.buckets) {
    if (b.public) {
      health.push({ severity: "info", kind: "public_bucket", object: b.name, message: `The ${b.name} storage bucket is public: anyone with a file's address can download it.`, fix: null });
    }
  }
  for (const a of map.advisors.filter((a) => a.level !== "INFO")) {
    /* Supabase's own advisor says the same as ours for RLS; one line, not two. */
    if (a.object && health.some((h) => h.object === a.object && h.kind === "rls_off") && /rls/i.test(a.name)) continue;
    health.push({ severity: a.level === "ERROR" ? "red" : "amber", kind: "advisor", object: a.object ?? a.name, message: `${a.title}${a.detail ? ` — ${a.detail}` : ""}`, fix: null });
  }
  for (const f of map.flagged) {
    health.push({ severity: "red", kind: "flagged_content", object: f.where, message: `Text in ${f.where} reads like an instruction ("${f.excerpt}"). It was treated as data and ignored.`, fix: null });
  }

  const reasons: string[] = [];
  const busiest = [...tables].sort((a, b) => b.rowEstimate - a.rowEstimate)[0];
  if (busiest && busiest.rowEstimate > PRODUCTION_ROWS) reasons.push(`${busiest.name} has about ${busiest.rowEstimate.toLocaleString()} rows`);
  if (map.auth.users > PRODUCTION_USERS) reasons.push(`${map.auth.users.toLocaleString()} people have accounts`);
  if (options.recentWrites) reasons.push("it was written to in the last hour");

  const domain = detectDomain(map);
  const glance = [
    `${tables.length} ${tables.length === 1 ? "table" : "tables"}`,
    views.length ? `${views.length} ${views.length === 1 ? "view" : "views"}` : null,
    `${map.auth.users.toLocaleString()} ${map.auth.users === 1 ? "user" : "users"}`,
    map.auth.providers.length ? `sign-in with ${map.auth.providers.join(", ")}` : null,
    map.buckets.length ? `${map.buckets.length} storage ${map.buckets.length === 1 ? "bucket" : "buckets"}` : null,
  ].filter(Boolean);

  return {
    headline: `Your database at a glance: ${glance.join(", ")}.${domain ? ` Looks like ${domain.label}: ${domain.entities.slice(0, 5).join(", ")}.` : ""}`,
    tables: tables.length,
    views: views.length,
    users: map.auth.users,
    providers: map.auth.providers,
    buckets: map.buckets.length,
    domain,
    relationships,
    diagram: erDiagram(map, relationships),
    health,
    production: { level: reasons.length > 0 ? "HIGH" : "LOW", reasons },
  };
}

/** The map, as a model reads it: compact, and everything in it marked as data. */
export function describeMap(map: DatabaseMap, limit = 60): string {
  const lines: string[] = [];
  for (const t of map.tables.slice(0, limit)) {
    const cols = t.columns.map((c) => `${c.name} ${c.enumName ? `enum ${c.enumName}` : c.type}${c.nullable ? "" : " not null"}${c.default ? " default" : ""}${t.primaryKey.includes(c.name) ? " pk" : ""}`);
    const fks = t.foreignKeys.map((f) => `${f.columns.join(",")} -> ${f.refSchema}.${f.refTable}(${f.refColumns.join(",")})`);
    lines.push(`${t.schema}.${t.name} [${t.kind}${t.rls ? `, rls on, ${t.policies.length} policies` : ", RLS OFF"}, ~${t.rowEstimate} rows](${cols.join(", ")})${fks.length ? ` fks: ${fks.join("; ")}` : ""}`);
  }
  for (const e of map.enums) lines.push(`enum ${e.schema}.${e.name}: ${e.values.join(" | ")}`);
  for (const f of map.functions.slice(0, 40)) lines.push(`function ${f.schema}.${f.name}(${f.arguments}) returns ${f.returns}${f.securityDefiner ? " security definer" : ""}`);
  return lines.join("\n") || "(the database has no tables yet)";
}
