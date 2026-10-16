/* Connecting the dots: what the app needs, against what the database has.
 *
 * The app is adapted to the database, not the other way round. When the plan
 * says "bookings" with a "date" and a "client", and the database has
 * `appointments(starts_at, customer_id → customers)`, the answer is a data
 * layer that reads appointments.starts_at — never a rename of somebody's
 * table to match code that was written five minutes ago.
 *
 * So every table and field the app needs gets one of five verdicts:
 *
 *   MATCHED     there, by name or by an obvious synonym, with the mapping
 *   ADAPTABLE   there, but the code has to bend: an enum where text was
 *               expected, an integer where a number was
 *   MISSING     not there — needs surgery, and only additive surgery
 *   UNUSED      theirs, not used by the app, left exactly as it is
 *   RISK        used by the app and unsafe as it stands: RLS off, or on with
 *               no policy so the app can read nothing
 *
 * and the whole report recommends one of four paths with a one-line reason.
 *
 * Relationships are only ever followed, never invented: a join is written
 * along an existing foreign key or not at all. A column that is obviously a
 * link with no key behind it (`appointments.customer_id`, no FK) is suggested
 * as surgery, not assumed.
 *
 * Pure: type-only imports. Asserted by tools/check-db-agent.mjs.
 */

import type { Column, DataModel, Table } from "@/lib/builder/schema";

import type { AnalysisReport, DatabaseMap, MapColumn, MapTable } from "./db-map";
import { qualified } from "./db-map";

export type WiringStatus = "MATCHED" | "ADAPTABLE" | "MISSING" | "UNUSED" | "RISK";

export const STATUS_ICON: Record<WiringStatus, string> = {
  MATCHED: "✅",
  ADAPTABLE: "🟡",
  MISSING: "🔴",
  UNUSED: "⚪",
  RISK: "⚠️",
};

export type FieldMapping = {
  app: string;
  db: string | null;
  status: "MATCHED" | "ADAPTABLE" | "MISSING";
  note: string | null;
  /** The enum's values, when the column is one: a form shows a dropdown. */
  options: string[] | null;
  /** NOT NULL with no default: a form must ask for it. */
  required: boolean;
};

export type WiringItem = {
  status: WiringStatus;
  /** The app's name for it — a table in the app's plan. Null for UNUSED. */
  app: string | null;
  /** The database's `schema.table`. Null for MISSING. */
  db: string | null;
  detail: string;
  fields: FieldMapping[];
  /** Additive SQL that would close the gap. Never run from here: it becomes a surgery card. */
  surgery: string | null;
};

export type Path = "connect" | "surgery" | "new_project" | "side_by_side";

export type WiringReport = {
  items: WiringItem[];
  /** App table name → database `schema.table`. */
  tables: Record<string, string>;
  /** The table that holds people's profiles, if one exists. */
  profile: { table: string; userColumn: string; reused: boolean } | null;
  recommendation: { path: Path; reason: string };
  summary: string;
};

/* ── Names ────────────────────────────────────────────────────────────────── */

export function singular(name: string): string {
  const n = name.toLowerCase();
  if (/ies$/.test(n)) return `${n.slice(0, -3)}y`;
  if (/(?:ss|us|is)$/.test(n)) return n;
  if (/(?:ches|shes|xes|ses|zes)$/.test(n)) return n.slice(0, -2);
  if (/s$/.test(n)) return n.slice(0, -1);
  return n;
}

/* Words that name the same thing. Each group is matched as a set: any member
   of a group is the same entity as any other. Deliberately short — a false
   match wires a page to the wrong table. */
const TABLE_SYNONYMS: string[][] = [
  ["booking", "appointment", "reservation", "session_booking", "visit"],
  ["customer", "client", "patron", "guest"],
  ["profile", "member", "user_profile", "account", "person"],
  ["service", "offering", "treatment"],
  ["staff", "employee", "team_member", "practitioner", "stylist", "provider"],
  ["product", "item", "listing_item"],
  ["order", "purchase"],
  ["order_item", "line_item", "order_line"],
  ["review", "rating", "testimonial"],
  ["post", "article", "entry"],
  ["category", "collection"],
  ["inquiry", "enquiry", "contact_request", "contact_message", "lead"],
  ["submission", "form_submission", "message"],
  ["property", "listing"],
  ["viewing_request", "viewing", "showing"],
  ["favorite", "favourite", "saved_item", "bookmark", "wishlist_item"],
  ["media", "file", "upload", "asset"],
];

const FIELD_SYNONYMS: string[][] = [
  ["date", "starts_at", "start_at", "start_time", "scheduled_at", "scheduled_for", "booked_for", "datetime", "appointment_date", "when", "start"],
  ["ends_at", "end_at", "end_time", "finish_at", "end"],
  ["client", "client_id", "customer", "customer_id", "member_id", "guest_id"],
  ["user_id", "owner_id", "profile_id", "created_by", "author_id", "account_id"],
  ["name", "full_name", "display_name", "title"],
  ["price", "amount", "cost", "price_cents", "amount_cents", "unit_price"],
  ["status", "state", "stage"],
  ["phone", "phone_number", "mobile", "telephone", "tel"],
  ["email", "email_address", "mail"],
  ["notes", "note", "comments", "remarks"],
  ["description", "body", "details", "summary", "content"],
  ["image", "image_url", "photo", "photo_url", "picture", "thumbnail", "cover_url", "avatar_url"],
  ["created_at", "inserted_at", "created", "date_created"],
  ["updated_at", "modified_at", "updated", "date_updated"],
  ["rating", "stars", "score"],
  ["quantity", "qty", "count"],
  ["service_id", "offering_id", "treatment_id"],
  ["staff_id", "employee_id", "practitioner_id", "stylist_id", "provider_id"],
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "");

function sameGroup(groups: string[][], a: string, b: string): boolean {
  return groups.some((group) => group.includes(a) && group.includes(b));
}

function tableScore(appName: string, dbName: string): number {
  const a = singular(norm(appName));
  const b = singular(norm(dbName));
  if (a === b) return 3;
  if (sameGroup(TABLE_SYNONYMS, a, b)) return 2;
  if (b.endsWith(`_${a}`) || a.endsWith(`_${b}`)) return 1;
  return 0;
}

/* ── Fields ───────────────────────────────────────────────────────────────── */

/* Postgres's spelling of the model's types, loosely: what the code can read
   without converting. */
const COMPATIBLE: Record<Column["type"], RegExp> = {
  uuid: /^uuid$/,
  text: /^(?:text|character varying|varchar|character|citext)/,
  integer: /^(?:integer|smallint|bigint)$/,
  bigint: /^(?:bigint|integer)$/,
  numeric: /^(?:numeric|double precision|real)/,
  boolean: /^boolean$/,
  timestamptz: /^timestamp with time zone$/,
  jsonb: /^jsonb?$/,
};

const PLATFORM_FIELDS = new Set(["id", "created_at", "updated_at"]);

function matchField(
  column: Column,
  table: MapTable,
  map: DatabaseMap,
  tables: Record<string, string>,
): FieldMapping {
  const want = norm(column.name);
  const byName = table.columns.find((c) => norm(c.name) === want);
  const bySynonym = byName ?? table.columns.find((c) => sameGroup(FIELD_SYNONYMS, want, norm(c.name)));

  /* A link to another app table is matched by where the key POINTS, which is
     the only reliable thing: `client` and `customer_id` are the same field
     because both reach customers. */
  let byForeignKey: MapColumn | undefined;
  if (!bySynonym && column.references) {
    const target = column.references.table === "auth.users" ? "auth.users" : tables[column.references.table];
    if (target) {
      const fk = table.foreignKeys.find((f) => `${f.refSchema}.${f.refTable}` === target && f.columns.length === 1);
      if (fk) byForeignKey = table.columns.find((c) => c.name === fk.columns[0]);
    }
  }

  const found = bySynonym ?? byForeignKey;
  if (!found) {
    return {
      app: column.name,
      db: null,
      status: "MISSING",
      note: PLATFORM_FIELDS.has(column.name) ? "not needed — the app works without it" : `no column for ${column.name}`,
      options: null,
      required: false,
    };
  }

  const enumValues = found.enumName ? map.enums.find((e) => e.name === found.enumName)?.values ?? [] : null;
  const required = !found.nullable && !found.default && !found.identity;
  const bare = found.type.replace(/\(.*\)$/, "").trim();
  let status: FieldMapping["status"] = "MATCHED";
  let note: string | null = found.name !== column.name ? `${column.name} → ${found.name}` : null;

  if (enumValues) {
    if (column.type === "text") {
      status = "ADAPTABLE";
      note = `${column.name} is the ${found.enumName} enum (${enumValues.slice(0, 6).join(", ")}${enumValues.length > 6 ? ", …" : ""}) — the form shows these as choices`;
    }
  } else if (!COMPATIBLE[column.type].test(bare)) {
    status = "ADAPTABLE";
    note = `${found.name} is ${found.type}; the app expected ${column.type} and converts in the data layer`;
  }
  return { app: column.name, db: found.name, status, note, options: enumValues, required };
}

/* ── SQL for the gaps ─────────────────────────────────────────────────────── */

const id = (s: string) => (/^[a-z_][a-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);

function columnSql(column: Column, tables: Record<string, string>): string {
  const parts = [id(column.name), column.type];
  if (column.primaryKey) parts.push("primary key");
  if (column.default) parts.push(`default ${column.default}`);
  if (!column.primaryKey && column.nullable === false) parts.push("not null");
  if (column.unique) parts.push("unique");
  if (column.references) {
    const target = column.references.table === "auth.users" ? "auth.users" : tables[column.references.table] ?? `public.${column.references.table}`;
    const [s, t] = target.split(".");
    parts.push(`references ${qualified(s, t)}(${id(column.references.column ?? "id")})`);
    if (column.references.onDelete) parts.push(`on delete ${column.references.onDelete}`);
  }
  if (column.check) parts.push(`check (${column.check})`);
  return parts.join(" ");
}

/** A table the app needs and the database lacks: created with RLS and the app's own policies. */
export function createTableSql(table: Table, schema: string, tables: Record<string, string>): string {
  const name = qualified(schema, table.name);
  const lines = [
    `create table if not exists ${name} (\n  ${table.columns.map((c) => columnSql(c, tables)).join(",\n  ")}\n);`,
    `comment on table ${name} is '${`QuickStark: ${table.what}`.replace(/'/g, "''")}';`,
  ];
  for (const index of table.indexes ?? []) {
    lines.push(`create index if not exists ${id(`${table.name}_${index.on.join("_")}_idx`.slice(0, 63))} on ${name} (${index.on.map(id).join(", ")});`);
  }
  for (const policy of table.policies) {
    lines.push(
      `create policy ${id(policy.name)} on ${name} for ${policy.for} to ${policy.to.join(", ")}${policy.using ? ` using (${policy.using})` : ""}${policy.check ? ` with check (${policy.check})` : ""};`,
    );
  }
  /* Policies first, then RLS on: the table is never reachable by nobody. */
  lines.push(`alter table ${name} enable row level security;`);
  const grants = new Set<string>();
  for (const p of table.policies) for (const role of p.to) grants.add(`${p.for === "all" ? "select, insert, update, delete" : p.for}|${role}`);
  for (const g of grants) {
    const [cmd, role] = g.split("|");
    lines.push(`grant ${cmd} on ${name} to ${role};`);
  }
  return lines.join("\n");
}

/** The column a table is owned by: a key to auth.users, or a conventional name. */
export function ownerColumn(table: MapTable): string | null {
  const fk = table.foreignKeys.find((f) => f.refSchema === "auth" && f.refTable === "users" && f.columns.length === 1);
  if (fk) return fk.columns[0];
  const conventional = table.columns.find((c) => /^(?:user_id|owner_id|profile_id|created_by|author_id)$/.test(c.name) && c.type === "uuid");
  return conventional?.name ?? null;
}

/**
 * Turning RLS on for a table the app uses, without locking the app out.
 *
 * Policies are created FIRST, then RLS enabled, in the same migration. A table
 * with an owner column gets owner-only rules; one without gets read access for
 * signed-in users (and visitors, when `publicRead`) and no writes until its
 * owner says who may write — locking writes is recoverable, exposing them is not.
 */
export function rlsFixSql(table: MapTable, options: { publicRead?: boolean } = {}): string {
  const name = qualified(table.schema, table.name);
  const owner = ownerColumn(table);
  const lines: string[] = [];
  const pol = (suffix: string) => id(`${table.name}_${suffix}`.slice(0, 63));
  if (owner) {
    const mine = `(select auth.uid()) = ${id(owner)}`;
    lines.push(
      `create policy ${pol("owner_select")} on ${name} for select to authenticated using (${mine});`,
      `create policy ${pol("owner_insert")} on ${name} for insert to authenticated with check (${mine});`,
      `create policy ${pol("owner_update")} on ${name} for update to authenticated using (${mine}) with check (${mine});`,
      `create policy ${pol("owner_delete")} on ${name} for delete to authenticated using (${mine});`,
    );
  } else {
    lines.push(`create policy ${pol("read")} on ${name} for select to ${options.publicRead ? "anon, authenticated" : "authenticated"} using (true);`);
  }
  lines.push(`alter table ${name} enable row level security;`);
  return lines.join("\n");
}

/* ── The report ───────────────────────────────────────────────────────────── */

export type WireOptions = {
  analysis?: AnalysisReport;
  /** The owner does not want their existing tables changed (production). */
  keepExistingUntouched?: boolean;
  /** Where new tables go for the side-by-side path. */
  sideSchema?: string;
};

/**
 * The wiring report for an app's data model against a live database.
 *
 * `needs` is the model as dataModelFor would build it — its schema is ignored;
 * the database's tables are matched wherever they are (public first).
 */
export function wire(needs: DataModel, map: DatabaseMap, options: WireOptions = {}): WiringReport {
  const candidates = map.tables.filter((t) => t.kind !== "foreign table");
  const used = new Set<string>();
  const tables: Record<string, string> = {};
  const items: WiringItem[] = [];

  /* Profiles first: an existing profile-like table is THE profile, and a
     second one beside it is the bug this rule exists to prevent. */
  let profile: WiringReport["profile"] = null;
  const appProfile = needs.tables.find((t) => t.name === "profiles");
  const profileCandidate = map.auth.profileCandidates
    .map((full) => candidates.find((t) => `${t.schema}.${t.name}` === full))
    .filter((t): t is MapTable => Boolean(t))
    .sort((a, b) => tableScore("profiles", b.name) - tableScore("profiles", a.name) || (a.schema === "public" ? -1 : 1))[0];
  if (profileCandidate) {
    const userColumn = profileCandidate.foreignKeys.find((f) => f.refSchema === "auth" && f.refTable === "users")?.columns[0] ?? "id";
    profile = { table: `${profileCandidate.schema}.${profileCandidate.name}`, userColumn, reused: true };
    if (appProfile) {
      tables.profiles = profile.table;
      used.add(profile.table);
    }
  }

  /* Each app table to its best database table, best scores claimed first so a
     strong match is not stolen by a weak one. */
  const pairs: { app: Table; db: MapTable; score: number }[] = [];
  for (const app of needs.tables) {
    if (tables[app.name]) continue;
    for (const db of candidates) {
      const score = tableScore(app.name, db.name) + (db.schema === "public" ? 0.1 : 0);
      if (score >= 1) pairs.push({ app, db, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  for (const { app, db } of pairs) {
    const key = `${db.schema}.${db.name}`;
    if (tables[app.name] || used.has(key)) continue;
    tables[app.name] = key;
    used.add(key);
  }

  const newSchema = options.keepExistingUntouched && options.sideSchema ? options.sideSchema : "public";

  for (const app of needs.tables) {
    const key = tables[app.name];
    if (!key) {
      /* Includes a profile table when users exist and nothing describes them:
         proposed, keyed to auth.users, additive. */
      const planned = { ...tables };
      for (const t of needs.tables) if (!planned[t.name]) planned[t.name] = `${newSchema}.${t.name}`;
      items.push({
        status: "MISSING",
        app: app.name,
        db: null,
        detail: `The app needs ${app.name.replace(/_/g, " ")} and there is no table for it.`,
        fields: [],
        surgery: createTableSql(app, newSchema, planned),
      });
      continue;
    }
    const db = candidates.find((t) => `${t.schema}.${t.name}` === key) as MapTable;
    const fields = app.columns.map((c) => matchField(c, db, map, tables));
    const missing = fields.filter((f) => f.status === "MISSING" && !PLATFORM_FIELDS.has(f.app));
    const adaptable = fields.filter((f) => f.status === "ADAPTABLE");
    const mapped = fields.filter((f) => f.db && f.db !== f.app).map((f) => `${f.app} → ${f.db}`);

    const exposed = db.grants.anon.length > 0 || db.grants.authenticated.length > 0;
    if (db.kind === "table" || db.kind === "partitioned table") {
      if (!db.rls && exposed) {
        items.push({
          status: "RISK",
          app: app.name,
          db: key,
          detail: `${db.name} has row-level security OFF — the app would expose every row to anyone with its public key.`,
          fields,
          surgery: rlsFixSql(db, { publicRead: app.policies.some((p) => p.to.includes("anon") && (p.for === "select" || p.for === "all") && (p.using ?? "true") === "true") }),
        });
      } else if (db.rls && db.policies.length === 0) {
        items.push({
          status: "RISK",
          app: app.name,
          db: key,
          detail: `${db.name} has row-level security on and no policies, so the app can't read or write it.`,
          fields,
          surgery: rlsFixSql({ ...db, rls: false }).replace(/\nalter table [^\n]+ enable row level security;$/, ""),
        });
      }
    }

    if (missing.length > 0 && !options.keepExistingUntouched) {
      items.push({
        status: "MISSING",
        app: `${app.name}.${missing.map((m) => m.app).join(", ")}`,
        db: key,
        detail: `${db.name} has no column for ${missing.map((m) => m.app).join(", ")}.`,
        fields: missing,
        surgery: missing
          .map((m) => {
            const col = app.columns.find((c) => c.name === m.app) as Column;
            /* Always nullable and without the app's constraints: a column added
               to a table with rows cannot demand values those rows lack. */
            return `alter table ${qualified(db.schema, db.name)} add column if not exists ${columnSql({ ...col, nullable: true, primaryKey: false, unique: false, check: undefined }, tables)};`;
          })
          .join("\n"),
      });
    }

    items.push({
      status: adaptable.length > 0 || (missing.length > 0 && options.keepExistingUntouched) ? "ADAPTABLE" : "MATCHED",
      app: app.name,
      db: key,
      detail:
        adaptable.length > 0
          ? `App "${app.name}" → ${key}; ${adaptable.map((f) => f.note).join("; ")}. No database change — the code adapts.`
          : `App "${app.name}" → ${key}${mapped.length ? ` (fields mapped: ${mapped.join(", ")})` : ""}.`,
      fields,
      surgery: null,
    });

    /* A link with no key behind it: suggested, never assumed. */
    for (const column of db.columns) {
      const m = column.name.match(/^(.+)_id$/);
      if (!m || db.foreignKeys.some((f) => f.columns.includes(column.name)) || column.type !== "uuid") continue;
      const target = candidates.find((t) => singular(t.name) === singular(m[1]) && t.primaryKey.length === 1);
      if (!target) continue;
      items.push({
        status: "ADAPTABLE",
        app: app.name,
        db: key,
        detail: `${db.name}.${column.name} looks like a link to ${target.name}, but no foreign key says so. The app won't join on it until one exists.`,
        fields: [],
        surgery: `alter table ${qualified(db.schema, db.name)} add constraint ${id(`${db.name}_${column.name}_fkey`.slice(0, 63))} foreign key (${id(column.name)}) references ${qualified(target.schema, target.name)}(${id(target.primaryKey[0])}) not valid;`,
      });
    }
  }

  for (const t of candidates) {
    const key = `${t.schema}.${t.name}`;
    if (used.has(key)) continue;
    items.push({ status: "UNUSED", app: null, db: key, detail: `${t.name} isn't used by the app — left alone.`, fields: [], surgery: null });
  }

  const count = (s: WiringStatus) => items.filter((i) => i.status === s).length;
  const missingTables = items.filter((i) => i.status === "MISSING" && i.db === null).length;
  const risks = count("RISK");
  const matchedTables = needs.tables.filter((t) => tables[t.name]).length;
  const nonEmpty = candidates.filter((t) => t.kind === "table").length;

  let recommendation: WiringReport["recommendation"];
  if (nonEmpty === 0) {
    recommendation = { path: "connect", reason: "The database is empty, so the app's tables are created there on the next build — nothing of yours to work around." };
  } else if (needs.tables.length >= 2 && matchedTables === 0 && nonEmpty >= 3 && !profileCandidate) {
    recommendation = options.analysis?.production.level === "HIGH" || options.keepExistingUntouched
      ? { path: "side_by_side", reason: `None of your ${nonEmpty} tables fit this app and the database is in use, so the app gets a schema of its own beside them and your tables stay read-only to it.` }
      : { path: "new_project", reason: `None of your ${nonEmpty} tables fit this app — it looks like a different product — so a fresh Supabase project keeps both clean.` };
  } else if (options.keepExistingUntouched && missingTables > 0) {
    recommendation = { path: "side_by_side", reason: `The app needs ${missingTables} new ${missingTables === 1 ? "table" : "tables"} and you'd rather your existing ones weren't touched, so they go in a schema of their own.` };
  } else if (missingTables > 0 || risks > 0 || count("MISSING") > 0) {
    const parts = [
      missingTables ? `${missingTables} new ${missingTables === 1 ? "table" : "tables"}` : null,
      count("MISSING") - missingTables > 0 ? `${count("MISSING") - missingTables} new ${count("MISSING") - missingTables === 1 ? "column set" : "column sets"}` : null,
      risks ? `${risks} security ${risks === 1 ? "fix" : "fixes"}` : null,
    ].filter(Boolean);
    recommendation = { path: "surgery", reason: `Your database fits the app; it needs ${parts.join(" and ")}, all additive or safety changes you approve first.` };
  } else {
    recommendation = { path: "connect", reason: "Everything the app needs is already there — it is wired to your tables with zero database changes." };
  }

  const securityIssues = risks;
  const summary = [
    `Your app is wired to ${matchedTables} of ${needs.tables.length} ${needs.tables.length === 1 ? "table" : "tables"}.`,
    missingTables ? `${items.filter((i) => i.status === "MISSING" && i.db === null).map((i) => i.app).join(", ")} ${missingTables === 1 ? "needs a new table" : "need new tables"}.` : null,
    securityIssues ? `${securityIssues} security ${securityIssues === 1 ? "issue" : "issues"}: ${items.filter((i) => i.status === "RISK").map((i) => i.detail.split(" — ")[0]).join("; ")}.` : null,
  ].filter(Boolean).join(" ");

  return { items, tables, profile, recommendation, summary };
}

/** All the gap-closing SQL in one migration: RLS fixes, then new tables, then new columns, then keys. */
export function surgeryFor(report: WiringReport, include: { risks?: boolean; missing?: boolean; links?: boolean } = { risks: true, missing: true }): string {
  const pick = (pred: (i: WiringItem) => boolean) => report.items.filter((i) => i.surgery && pred(i)).map((i) => i.surgery as string);
  return [
    ...(include.risks ? pick((i) => i.status === "RISK") : []),
    ...(include.missing ? pick((i) => i.status === "MISSING" && i.db === null) : []),
    ...(include.missing ? pick((i) => i.status === "MISSING" && i.db !== null) : []),
    ...(include.links ? pick((i) => i.status === "ADAPTABLE" && /foreign key/.test(i.surgery ?? "")) : []),
  ].join("\n\n");
}

/* ── The data layer ───────────────────────────────────────────────────────── */

const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const pascal = (s: string) => camel(s).replace(/^./, (c) => c.toUpperCase());

/**
 * lib/db/data.ts: typed list/get/create/update/remove per wired table, against
 * the real table and real columns, with the app's names mapped in one place.
 *
 * Imports the generated `Database` type from ./types (db.generate_types) and the
 * app's existing Supabase client.
 */
export function dataLayerFor(report: WiringReport, map: DatabaseMap): string {
  const out: string[] = [
    "/* Generated by QuickStark's database agent from your database's real tables.",
    " * The app's names are mapped to your columns here and nowhere else — your",
    " * tables were not renamed to fit the code. Regenerated after every database change. */",
    "",
    'import type { Database } from "./types";',
    'import { supabase } from "@/lib/supabase";',
    "",
  ];
  for (const [app, key] of Object.entries(report.tables)) {
    const [schema, name] = key.split(".");
    const table = map.tables.find((t) => t.schema === schema && t.name === name);
    if (!table) continue;
    const item = report.items.find((i) => i.app === app && i.db === key && (i.status === "MATCHED" || i.status === "ADAPTABLE"));
    const fields = (item?.fields ?? []).filter((f) => f.db);
    const T = pascal(app);
    const pk = table.primaryKey[0] ?? "id";
    const writable = table.kind === "table" || table.kind === "partitioned table";
    const from = schema === "public" ? `supabase.from("${name}")` : `supabase.schema("${schema}").from("${name}")`;
    out.push(
      `/* ${app} → ${key}${table.rls ? "" : " (row-level security is OFF on this table)"} */`,
      `export type ${T}Row = Database["${schema}"]["${table.kind === "view" || table.kind === "materialized view" ? "Views" : "Tables"}"]["${name}"]["Row"];`,
      `export const ${camel(app)}Fields = ${JSON.stringify(Object.fromEntries(fields.map((f) => [f.app, f.db])))} as const;`,
      `export const ${camel(app)}Form = ${JSON.stringify(
        table.columns
          .filter((c) => !c.identity && !table.primaryKey.includes(c.name))
          .map((c) => ({
            name: c.name,
            required: !c.nullable && !c.default,
            ...(c.enumName ? { options: map.enums.find((e) => e.name === c.enumName)?.values ?? [] } : {}),
          })),
      )} as const;`,
      `export const ${camel(app)} = {`,
      `  list: (limit = 50) => ${from}.select("*").limit(limit),`,
      `  get: (key: ${T}Row["${pk}"]) => ${from}.select("*").eq("${pk}", key).maybeSingle(),`,
      ...(writable
        ? [
            `  create: (row: Database["${schema}"]["Tables"]["${name}"]["Insert"]) => ${from}.insert(row).select().single(),`,
            `  update: (key: ${T}Row["${pk}"], patch: Database["${schema}"]["Tables"]["${name}"]["Update"]) => ${from}.update(patch).eq("${pk}", key).select().single(),`,
            `  remove: (key: ${T}Row["${pk}"]) => ${from}.delete().eq("${pk}", key),`,
          ]
        : []),
      `};`,
      "",
    );
  }
  return out.join("\n");
}

/** What the page generator is told, so the code it writes uses the real names. */
export function wiringBrief(report: WiringReport, map: DatabaseMap): string {
  const lines = [
    "THE DATABASE ALREADY EXISTS. Write the app against these real tables and columns; never rename them and never create a parallel table.",
  ];
  for (const [app, key] of Object.entries(report.tables)) {
    const item = report.items.find((i) => i.app === app && i.db === key && i.fields.length > 0);
    const mapped = (item?.fields ?? []).filter((f) => f.db && f.db !== f.app).map((f) => `${f.app}→${f.db}`);
    const enums = (item?.fields ?? []).filter((f) => f.options).map((f) => `${f.db} ∈ {${f.options?.join(", ")}}`);
    lines.push(`- "${app}" is ${key}${mapped.length ? `; use ${mapped.join(", ")}` : ""}${enums.length ? `; ${enums.join("; ")}` : ""}.`);
  }
  if (report.profile) lines.push(`- Profiles live in ${report.profile.table}, keyed by ${report.profile.userColumn} = auth.users.id. Do not create a profiles table.`);
  const fks = map.tables.flatMap((t) => t.foreignKeys.map((f) => `${t.name}.${f.columns.join(",")} → ${f.refTable}`));
  if (fks.length) lines.push(`- Join only along these foreign keys: ${fks.slice(0, 30).join("; ")}.`);
  const rpcs = map.functions.filter((f) => f.schema === "public" && !/^(?:handle_|set_updated|trigger_|is_admin)/.test(f.name)).slice(0, 15);
  if (rpcs.length) lines.push(`- Reuse these database functions through supabase.rpc() when they match an action: ${rpcs.map((f) => `${f.name}(${f.arguments})`).join(", ")}.`);
  lines.push("- Import table access from lib/db/data.ts and types from lib/db/types.ts.");
  return lines.join("\n");
}
