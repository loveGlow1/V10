/* The database agent's procedures: analyze, wire, plan, approve, undo.
 *
 * Each one is the spec's procedure in order, written out so the order cannot
 * be skipped: a surgery is always re-scanned before it is planned, dry-run
 * before it is shown, re-scanned again before it is applied (and abandoned if
 * the database changed in between), applied in one transaction with an
 * approval token, and verified afterwards — advisors, types, wiring and the
 * access test. The chat and the Database panel both call these; neither can
 * reach a write any other way.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ArchitectureManifest } from "@/lib/builder/architecture";
import { generateSql } from "@/lib/builder/backend/database-ask";
import { dataModelFor, type DataModel } from "@/lib/builder/schema";

import { issueApproval, sha256 } from "./approval";
import { type AnalysisReport, type DatabaseMap, analyze, describeMap } from "./db-map";
import { type RlsFinding, type RlsTestTable, readRlsTest, rlsTestSql } from "./probe";
import { type SurgeryPlan, BACKUP_DAYS, planSurgery, resolveTable, surgeryCard } from "./surgery";
import { tokenize } from "./sql-guard";
import { type Actor, type DbTools, ScopeError, dbToolsFor } from "./tools";
import { asData, flagRows, maySample, sampleSql } from "./untrusted";
import { type WiringReport, dataLayerFor, ownerColumn, rlsFixSql, singular, surgeryFor, wire, wiringBrief } from "./wiring";

export type Failure = { ok: false; reason: string; reconnect?: boolean };

export type SurgeryRow = {
  id: string;
  project_id: string;
  user_id: string;
  ref: string;
  kind: "migration" | "create_project" | "auth_config";
  name: string;
  request: string | null;
  summary: string;
  level: number;
  status: "planned" | "applied" | "failed" | "cancelled" | "stale" | "undone";
  plan: SurgeryPlan | Record<string, unknown>;
  sql_hash: string;
  map_fingerprint: string | null;
  confirmation: string | null;
  error: string | null;
  verification: Record<string, unknown> | null;
  undoes: string | null;
  created_at: string;
  applied_at: string | null;
  cleanup_after: string | null;
};

/* ── Reading ──────────────────────────────────────────────────────────────── */

async function appModel(service: SupabaseClient, projectId: string): Promise<DataModel | null> {
  const { data } = await service.from("project_architecture").select("manifest").eq("project_id", projectId).maybeSingle<{ manifest: ArchitectureManifest | null }>();
  if (!data?.manifest?.database) return null;
  return dataModelFor(data.manifest, "public");
}

function writesOf(map: DatabaseMap | null): number {
  return map ? map.tables.reduce((sum, t) => sum + t.writes, 0) : 0;
}

/** Writes per hour since the last scan, when the last scan is recent enough to say. */
function writeRate(previous: DatabaseMap | null, current: DatabaseMap): number | null {
  if (!previous || previous.ref !== current.ref) return null;
  const hours = (Date.parse(current.scannedAt) - Date.parse(previous.scannedAt)) / 3_600_000;
  if (!(hours > 0) || hours > 6) return null;
  const delta = writesOf(current) - writesOf(previous);
  return delta >= 0 ? delta / hours : null;
}

export type Scan = {
  ok: true;
  map: DatabaseMap;
  analysis: AnalysisReport;
  wiring: WiringReport | null;
  writesPerHour: number | null;
};

async function withTools(service: SupabaseClient, projectId: string, actor: Actor) {
  return dbToolsFor(service, projectId, actor);
}

/**
 * Phase 1: the Database Map, read fresh, analysed, and kept with the project.
 * Read-only from start to finish.
 */
export async function scanDatabase(service: SupabaseClient, projectId: string, actor: Actor): Promise<Scan | Failure> {
  const got = await withTools(service, projectId, actor);
  if (!got.ok) return got;
  return scanWith(service, projectId, got.tools, got.map);
}

async function scanWith(service: SupabaseClient, projectId: string, tools: DbTools, previous: DatabaseMap | null): Promise<Scan | Failure> {
  const read = await tools.introspect(tools.ref);
  if (!read.ok) return { ok: false, reason: read.reason };
  const map = read.value;
  const rate = writeRate(previous, map);
  const analysis = analyze(map, { recentWrites: rate !== null && rate > 0 });
  const model = await appModel(service, projectId);
  const wiring = model ? wire(model, map, { analysis }) : null;

  await service
    .from("project_backends")
    .update({
      db_map: map,
      db_map_at: map.scannedAt,
      db_analysis: analysis,
      ...(wiring ? { db_wiring: { report: wiring, brief: wiringBrief(wiring, map), at: map.scannedAt } } : {}),
    })
    .eq("project_id", projectId);

  return { ok: true, map, analysis, wiring, writesPerHour: rate };
}

/** What the page generator is told about an existing database. Empty when there is none. */
export async function wiredBriefFor(service: SupabaseClient, projectId: string): Promise<string> {
  const { data } = await service
    .from("project_backends")
    .select("db_wiring")
    .eq("project_id", projectId)
    .maybeSingle<{ db_wiring: { brief?: string } | null }>();
  return typeof data?.db_wiring?.brief === "string" ? data.db_wiring.brief : "";
}

/** The analysis card, in words. */
export function analysisMessage(scan: Scan): string {
  const { analysis, wiring } = scan;
  const lines = [analysis.headline];
  if (analysis.relationships.length) {
    lines.push("", `Relationships: ${analysis.relationships.slice(0, 8).map((r) => `${r.from.split(".").pop()}.${r.columns.join(",")} → ${r.to.split(".").pop()}`).join("; ")}${analysis.relationships.length > 8 ? "; …" : ""}.`);
  }
  const red = analysis.health.filter((h) => h.severity === "red");
  const amber = analysis.health.filter((h) => h.severity === "amber");
  if (red.length || amber.length) {
    lines.push("", "Health:");
    for (const h of [...red, ...amber].slice(0, 8)) lines.push(`- ${h.severity === "red" ? "🔴" : "🟡"} ${h.message}`);
  } else {
    lines.push("", "Health: no security or performance problems found.");
  }
  if (analysis.production.level === "HIGH") lines.push("", `This looks like a production database (${analysis.production.reasons.join(", ")}), so every change gets a backup or branch first.`);
  if (wiring) lines.push("", wiring.summary, `Recommended: **${PATH_LABEL[wiring.recommendation.path]}** — ${wiring.recommendation.reason}`);
  lines.push("", "Nothing was changed — this was read-only.");
  return lines.join("\n");
}

export const PATH_LABEL: Record<WiringReport["recommendation"]["path"], string> = {
  connect: "Connect as-is",
  surgery: "Surgery",
  new_project: "New project",
  side_by_side: "Side-by-side",
};

/* ── Wiring ───────────────────────────────────────────────────────────────── */

export type Wired = { ok: true; scan: Scan; types: string | null; dataLayer: string | null; message: string };

/**
 * Phase 2: the app wired to the tables that exist. Types regenerated from the
 * real database, a typed data layer over the real columns, the redirect URLs
 * the app needs added (allowed without approval), and the brief the next
 * build writes against. No schema change.
 */
export async function wireApp(service: SupabaseClient, projectId: string, actor: Actor): Promise<Wired | Failure> {
  const got = await withTools(service, projectId, actor);
  if (!got.ok) return got;
  const scan = await scanWith(service, projectId, got.tools, got.map);
  if (!scan.ok) return scan;
  if (!scan.wiring) {
    return { ok: true, scan, types: null, dataLayer: null, message: `${scan.analysis.headline}\n\nThis app hasn't been planned with a data layer yet, so there is nothing to wire. Build it once and ask again.` };
  }
  const schemas = [...new Set(Object.values(scan.wiring.tables).map((key) => key.split(".")[0]))];
  const types = await got.tools.generate_types(got.tools.ref, schemas.length ? schemas : ["public"]);
  const dataLayer = dataLayerFor(scan.wiring, scan.map);
  /* The publishable key into the app's env; the secret one sealed server-side. */
  await got.tools.get_api_keys(got.tools.ref);

  await service
    .from("project_backends")
    .update({
      db_wiring: {
        report: scan.wiring,
        brief: wiringBrief(scan.wiring, scan.map),
        types: types.ok ? types.value : null,
        dataLayer,
        at: new Date().toISOString(),
      },
    })
    .eq("project_id", projectId);

  const w = scan.wiring;
  const lines = [w.summary, ""];
  for (const item of w.items.filter((i) => i.status !== "UNUSED").slice(0, 14)) {
    lines.push(`- ${({ MATCHED: "✅", ADAPTABLE: "🟡", MISSING: "🔴", UNUSED: "⚪", RISK: "⚠️" } as const)[item.status]} ${item.status} ${item.detail}`);
  }
  const unused = w.items.filter((i) => i.status === "UNUSED");
  if (unused.length) lines.push(`- ⚪ UNUSED ${unused.map((u) => u.db?.split(".").pop()).join(", ")} — left alone.`);
  if (w.profile) lines.push("", `Profiles: wired to your existing ${w.profile.table} (no new profiles table).`);
  lines.push("", `Recommended: **${PATH_LABEL[w.recommendation.path]}** — ${w.recommendation.reason}`);
  lines.push("", `TypeScript types ${types.ok ? "regenerated from your database" : `could not be regenerated (${types.reason})`}; the next build writes the app against your real tables and column names.`);
  return { ok: true, scan, types: types.ok ? types.value : null, dataLayer, message: lines.join("\n") };
}

/* ── Planning a surgery ───────────────────────────────────────────────────── */

/* Each statement on its own, for the dry run's EXECUTEs. */
function statementsOf(plan: SurgeryPlan): string[] {
  return tokenize([plan.migration, ...plan.concurrent].join("\n")).map((s) => s.text);
}

export type Planned = { ok: true; surgery: SurgeryRow; plan: SurgeryPlan; message: string };

async function saveSurgery(service: SupabaseClient, row: Omit<SurgeryRow, "id" | "created_at" | "applied_at" | "error" | "verification" | "cleanup_after">): Promise<SurgeryRow | null> {
  const { data, error } = await service.from("db_surgeries").insert(row).select("*").single<SurgeryRow>();
  if (error) {
    // eslint-disable-next-line no-console
    console.error("db-agent: surgery could not be recorded:", error.message);
    return null;
  }
  return data;
}

/**
 * Phase 4, steps 1–4: re-scan, write the migration (or take the SQL given),
 * plan it, dry-run it, fix it once if the dry run fails, count the rows any
 * UPDATE/DELETE would touch, and record it as planned. Nothing is applied.
 */
export async function planChange(
  service: SupabaseClient,
  input: { projectId: string; userId: string; actor: Actor; sql?: string | null; request?: string | null; undoes?: string | null; written?: boolean },
): Promise<Planned | Failure> {
  const got = await withTools(service, input.projectId, input.actor);
  if (!got.ok) return got;
  const { tools } = got;
  const scan = await scanWith(service, input.projectId, tools, got.map);
  if (!scan.ok) return scan;
  const production = scan.analysis.production.level === "HIGH";

  let sql = input.sql?.trim() ?? "";
  let written = input.written === true;
  if (!sql) {
    if (!input.request) return { ok: false, reason: "There was nothing to change." };
    const generated = await generateSql(
      `${input.request}\n\nMake the smallest change that does this. Prefer additive changes. Never rename or drop anything unless the request says to.`,
      asData("database map", describeMap(scan.map)),
    );
    if (!generated.ok) return { ok: false, reason: `I couldn't write the SQL for that — ${generated.reason}.` };
    sql = generated.sql;
    written = true;
  }

  let plan = planSurgery({ sql, map: scan.map, production, request: input.request ?? undefined });
  if (plan.statements.length === 0) return { ok: false, reason: "There was no SQL in that to run." };
  if (plan.level === 0) return { ok: false, reason: "That only reads — nothing to approve. Ask it as a question and I'll run it read-only." };

  let dry = plan.refused.length ? null : await tools.dry_run(tools.ref, statementsOf(plan));
  if (dry && dry.ok && !dry.value.ok && written && input.request) {
    /* One repair, from the error itself, before anybody sees a broken plan. */
    const retry = await generateSql(
      `${input.request}\n\nThe previous attempt failed in a dry run with this error, fix it:\n${dry.value.error}\n\nPrevious SQL:\n${sql}`,
      asData("database map", describeMap(scan.map)),
    );
    if (retry.ok) {
      const second = planSurgery({ sql: retry.sql, map: scan.map, production, request: input.request });
      const secondDry = second.refused.length ? null : await tools.dry_run(tools.ref, statementsOf(second));
      if (secondDry && secondDry.ok && secondDry.value.ok) {
        sql = retry.sql;
        plan = second;
        dry = secondDry;
      }
    }
  }
  if (dry && !dry.ok) return { ok: false, reason: `The dry run could not reach your database: ${dry.reason}` };
  if (dry && !dry.value.ok) {
    return { ok: false, reason: `The dry run failed, so nothing will be applied: ${dry.value.error}\n\n\`\`\`sql\n${sql}\n\`\`\`` };
  }

  /* Row counts for anything that rewrites or removes rows. */
  const counts: string[] = [];
  for (const p of plan.previews) {
    const r = await tools.query_readonly(tools.ref, p.countSql);
    const rows = r.ok ? Number((r.value[0] as { rows?: unknown })?.rows ?? 0) : null;
    counts.push(rows === null ? `Couldn't count the rows for "${p.statement.slice(0, 50)}…".` : `"${p.statement.replace(/\s+/g, " ").slice(0, 60)}…" will touch ${rows.toLocaleString()} ${rows === 1 ? "row" : "rows"}.`);
  }
  if (counts.length) plan = { ...plan, warnings: [...counts, ...plan.warnings] };
  if (scan.writesPerHour !== null && scan.writesPerHour > 500 && plan.level >= 2) {
    plan = { ...plan, warnings: [`Your database is busy right now (about ${Math.round(scan.writesPerHour).toLocaleString()} writes an hour). Consider applying this when traffic is lower.`, ...plan.warnings] };
  }

  const row = await saveSurgery(service, {
    project_id: input.projectId,
    user_id: input.userId,
    ref: tools.ref,
    kind: "migration",
    name: plan.name,
    request: input.request ?? null,
    summary: plan.summary,
    level: plan.level,
    status: "planned",
    plan,
    sql_hash: sha256([plan.migration, ...plan.concurrent].join("\n")),
    map_fingerprint: scan.map.fingerprint,
    confirmation: plan.confirmation,
    undoes: input.undoes ?? null,
  });
  if (!row) return { ok: false, reason: "The plan could not be saved, so it can't be approved. Try again." };

  return {
    ok: true,
    surgery: row,
    plan,
    message: `${surgeryCard(plan)}\n\n${plan.refused.length ? "This can't be approved as written." : `Dry run passed — nothing has been changed yet.${plan.confirmation ? "" : " Approve it to apply."}`}`,
  };
}

/* ── Approving ────────────────────────────────────────────────────────────── */

export type Applied = { ok: true; surgery: SurgeryRow; message: string; verification: Verification };

export type Verification = {
  newWarnings: string[];
  access: RlsFinding[];
  typesRegenerated: boolean;
  concurrentFailures: string[];
};

async function loadSurgery(service: SupabaseClient, projectId: string, surgeryId: string): Promise<SurgeryRow | null> {
  const { data } = await service.from("db_surgeries").select("*").eq("id", surgeryId).eq("project_id", projectId).maybeSingle<SurgeryRow>();
  return data ?? null;
}

async function setStatus(service: SupabaseClient, id: string, patch: Partial<SurgeryRow>) {
  await service.from("db_surgeries").update(patch).eq("id", id);
}

/**
 * Phase 4, steps 5–8, on the owner's click. The approval token is issued and
 * spent here, in the same request: the model has no path to this function.
 */
export async function approveSurgery(
  service: SupabaseClient,
  input: { projectId: string; userId: string; surgeryId: string; confirmation?: string | null },
): Promise<Applied | Failure | { ok: true; created: { ref: string }; message: string }> {
  const row = await loadSurgery(service, input.projectId, input.surgeryId);
  if (!row) return { ok: false, reason: "That change no longer exists." };
  if (row.status !== "planned") return { ok: false, reason: `That change is already ${row.status}.` };
  if (row.confirmation && (input.confirmation ?? "").trim() !== row.confirmation) {
    return { ok: false, reason: `This change is destructive. Type ${row.confirmation} exactly to approve it.` };
  }

  const got = await withTools(service, input.projectId, "user");
  if (!got.ok) return got;
  const { tools } = got;
  if (tools.ref !== row.ref) {
    await setStatus(service, row.id, { status: "stale", error: "the app is now connected to a different database" });
    return { ok: false, reason: "This app is now connected to a different database, so that plan no longer applies." };
  }

  if (row.kind === "create_project") {
    const payload = row.plan as { name: string; region: string; organizationId: string };
    const approval = issueApproval({ projectId: input.projectId, ref: tools.ref, action: "create_project", hash: sha256(JSON.stringify({ name: payload.name, region: payload.region, organizationId: payload.organizationId })), subject: row.id });
    if (!approval) return { ok: false, reason: "Approvals are not configured on this deployment." };
    const created = await tools.create_project(payload, { token: approval.token, subject: row.id });
    if (!created.ok) {
      await setStatus(service, row.id, { status: "failed", error: created.reason });
      return { ok: false, reason: created.reason };
    }
    await setStatus(service, row.id, { status: "applied", applied_at: new Date().toISOString(), verification: { ref: created.value.ref } });
    return {
      ok: true,
      created: created.value,
      message: `New Supabase project ${payload.name} is being created (${created.value.ref}). Your old database was not touched. Once it's up, it is linked to this app and the next build creates the app's tables there.`,
    };
  }

  const plan = row.plan as SurgeryPlan;
  if (plan.refused?.length) return { ok: false, reason: plan.refused[0] };

  /* Step 1 again: the database must be what the plan was made against. */
  const fresh = await tools.introspect(tools.ref);
  if (!fresh.ok) return { ok: false, reason: fresh.reason };
  if (row.map_fingerprint && fresh.value.fingerprint !== row.map_fingerprint) {
    await setStatus(service, row.id, { status: "stale", error: "the database changed after this was planned" });
    return { ok: false, reason: "Your database changed after this was planned, so it wasn't applied. Ask again and I'll plan it against what's there now." };
  }
  const beforeWarnings = new Set(fresh.value.advisors.filter((a) => a.type === "security" && a.level !== "INFO").map((a) => `${a.name}:${a.object}`));

  const approval = issueApproval({ projectId: input.projectId, ref: tools.ref, action: "apply_migration", hash: row.sql_hash, subject: row.id });
  if (!approval) return { ok: false, reason: "Approvals are not configured on this deployment." };

  let applied;
  try {
    applied = await tools.apply_migration(tools.ref, { name: row.name, sql: plan.migration, concurrent: plan.concurrent, subject: row.id }, approval.token);
  } catch (error) {
    if (error instanceof ScopeError) return { ok: false, reason: error.message };
    throw error;
  }
  if (!applied.ok) {
    /* One transaction: a failure anywhere means nothing landed. */
    await setStatus(service, row.id, { status: "failed", error: applied.reason });
    return {
      ok: false,
      reason: `Your database refused the change, so it was rolled back in full — nothing was changed. ${plainError(applied.reason)}`,
    };
  }

  /* Step 7: verify. */
  const verification = await verify(service, input.projectId, tools, plan, beforeWarnings);
  verification.concurrentFailures = applied.value.concurrentFailures;
  const now = new Date();
  await setStatus(service, row.id, {
    status: "applied",
    applied_at: now.toISOString(),
    verification: verification as unknown as Record<string, unknown>,
    cleanup_after: plan.backups.length ? new Date(now.getTime() + BACKUP_DAYS * 86_400_000).toISOString() : null,
  });
  if (row.undoes) await setStatus(service, row.undoes, { status: "undone" });

  const problems = [...verification.newWarnings.map((w) => `New security warning: ${w}`), ...verification.access.filter((f) => !f.ok).map((f) => f.message), ...verification.concurrentFailures.map((f) => `An index could not be built: ${f}`)];
  const message = [
    `Applied **${row.name}**. ${plan.summary}`,
    plan.backups.length ? `Backup kept at ${plan.backups.join(", ")} until ${new Date(now.getTime() + BACKUP_DAYS * 86_400_000).toLocaleDateString()}.` : null,
    verification.typesRegenerated ? "Types and the app's data layer were regenerated." : null,
    problems.length ? `\nChecks after the change found:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nSay "undo the last database change" to roll it back.` : "Checks after the change passed: no new security warnings, and access works as intended.",
  ]
    .filter(Boolean)
    .join(" ");
  return { ok: true, surgery: { ...row, status: "applied" }, message, verification };
}

async function verify(service: SupabaseClient, projectId: string, tools: DbTools, plan: SurgeryPlan, before: Set<string>): Promise<Verification> {
  const scan = await scanWith(service, projectId, tools, null);
  const out: Verification = { newWarnings: [], access: [], typesRegenerated: false, concurrentFailures: [] };
  if (!scan.ok) return out;
  out.newWarnings = scan.map.advisors.filter((a) => a.type === "security" && a.level !== "INFO" && !before.has(`${a.name}:${a.object}`)).map((a) => `${a.title}${a.object ? ` (${a.object})` : ""}`);

  if (scan.wiring) {
    const schemas = [...new Set(Object.values(scan.wiring.tables).map((key) => key.split(".")[0]))];
    const types = await tools.generate_types(tools.ref, schemas.length ? schemas : ["public"]);
    out.typesRegenerated = types.ok;
    await service
      .from("project_backends")
      .update({
        db_wiring: {
          report: scan.wiring,
          brief: wiringBrief(scan.wiring, scan.map),
          types: types.ok ? types.value : null,
          dataLayer: dataLayerFor(scan.wiring, scan.map),
          at: new Date().toISOString(),
        },
      })
      .eq("project_id", projectId);
  }

  out.access = await accessTest(tools, scan.map, plan.affected.map((a) => a.table));
  return out;
}

/** The auto-test: visitors and strangers, per table, inside a rolled-back block. */
async function accessTest(tools: DbTools, map: DatabaseMap, tables: string[]): Promise<RlsFinding[]> {
  const targets: RlsTestTable[] = tables
    .map((key) => map.tables.find((t) => `${t.schema}.${t.name}` === key))
    .filter((t): t is NonNullable<typeof t> => Boolean(t) && (t!.kind === "table" || t!.kind === "partitioned table") && !t!.schema.startsWith("qs_backups"))
    .map((t) => ({ schema: t.schema, name: t.name, ownerColumn: ownerColumn(t), rls: t.rls }));
  if (targets.length === 0) return [];
  const publicRead = new Set(
    map.tables.filter((t) => t.policies.some((p) => p.roles.some((r) => r === "anon" || r === "public") && (p.command === "select" || p.command === "all"))).map((t) => `${t.schema}.${t.name}`),
  );
  const result = await tools.probe(tools.ref, rlsTestSql(targets));
  return readRlsTest(result, targets, { publicRead }).findings;
}

function plainError(reason: string): string {
  if (/already exists/i.test(reason)) return "Something it creates already exists.";
  if (/does not exist/i.test(reason)) return `It refers to something that isn't there: ${reason.replace(/^.*?:\s*/, "")}`;
  if (/violates (not-null|check|foreign key|unique)/i.test(reason)) return `Existing rows don't fit the new rule: ${reason.replace(/^.*?:\s*/, "")}`;
  if (/permission denied/i.test(reason)) return "The database didn't allow it.";
  return reason;
}

export async function cancelSurgery(service: SupabaseClient, projectId: string, surgeryId: string): Promise<{ ok: true } | Failure> {
  const row = await loadSurgery(service, projectId, surgeryId);
  if (!row || row.status !== "planned") return { ok: false, reason: "There is no pending change to cancel." };
  await setStatus(service, row.id, { status: "cancelled" });
  return { ok: true };
}

/* ── Undo ─────────────────────────────────────────────────────────────────── */

/** "Undo the last database change": the last applied migration's rollback, planned as a surgery of its own. */
export async function planUndo(service: SupabaseClient, input: { projectId: string; userId: string; actor: Actor }): Promise<Planned | Failure> {
  const { data } = await service
    .from("db_surgeries")
    .select("*")
    .eq("project_id", input.projectId)
    .eq("kind", "migration")
    .eq("status", "applied")
    .order("applied_at", { ascending: false })
    .limit(1)
    .maybeSingle<SurgeryRow>();
  if (!data) return { ok: false, reason: "There is no database change of mine to undo." };
  const rollback = (data.plan as SurgeryPlan).rollback ?? "";
  const runnable = rollback
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("--"))
    .join("\n");
  if (!runnable) {
    return { ok: false, reason: `${data.name} can't be undone automatically:\n\n\`\`\`sql\n${rollback}\n\`\`\`` };
  }
  return planChange(service, { ...input, sql: runnable, request: `undo ${data.name}`, undoes: data.id });
}

/* ── A new project ────────────────────────────────────────────────────────── */

export const NEW_PROJECT_COST =
  "Supabase's Free plan: $0 — up to two active projects per organisation, paused after a week without traffic. On a paid organisation each extra project adds its compute (from about $10/month for Micro). Supabase bills you directly; QuickStark doesn't charge for this.";

export async function planNewProject(
  service: SupabaseClient,
  input: { projectId: string; userId: string; name: string; region: string; organizationId: string },
): Promise<Planned | Failure> {
  const got = await withTools(service, input.projectId, "agent");
  if (!got.ok) return got;
  if (got.tools.mode !== "own") return { ok: false, reason: "This app's database is managed by QuickStark; a new project is made for it from the Database panel." };
  const payload = { name: input.name.slice(0, 60), region: input.region, organizationId: input.organizationId };
  const row = await saveSurgery(service, {
    project_id: input.projectId,
    user_id: input.userId,
    ref: got.tools.ref,
    kind: "create_project",
    name: `new project ${payload.name}`,
    request: "start fresh in a new project",
    summary: `Creates a new Supabase project "${payload.name}" in ${payload.region} and moves this app to it. Your current database is left exactly as it is.`,
    level: 1,
    status: "planned",
    plan: payload,
    sql_hash: sha256(JSON.stringify(payload)),
    map_fingerprint: null,
    confirmation: null,
    undoes: null,
  });
  if (!row) return { ok: false, reason: "The plan could not be saved. Try again." };
  return {
    ok: true,
    surgery: row,
    plan: { name: row.name, summary: row.summary, level: 1, statements: [], migration: "", concurrent: [], rollback: "", affected: [], backups: [], previews: [], confirmation: null, refused: [], warnings: [NEW_PROJECT_COST], rewrites: [] },
    message: `**${row.summary}**\n\nCost: ${NEW_PROJECT_COST}\n\nApprove it to create the project. The app's schema is applied there on the next build.`,
  };
}

/* ── Diagnosis ────────────────────────────────────────────────────────────── */

/** "Why can't users see their bookings?" — policies, grants, the access test and recent errors, then a fix to approve. */
export async function diagnose(service: SupabaseClient, input: { projectId: string; userId: string; subject: string | null }): Promise<{ ok: true; message: string; fix: Planned | null } | Failure> {
  const got = await withTools(service, input.projectId, "agent");
  if (!got.ok) return got;
  const scan = await scanWith(service, input.projectId, got.tools, got.map);
  if (!scan.ok) return scan;
  const { map } = scan;

  const subject = input.subject ? singular(input.subject.toLowerCase().replace(/^(?:their|my|the)_/, "")) : null;
  const viaWiring = subject && scan.wiring ? Object.entries(scan.wiring.tables).find(([app]) => singular(app) === subject)?.[1] : null;
  const table =
    (viaWiring ? map.tables.find((t) => `${t.schema}.${t.name}` === viaWiring) : null) ??
    (subject ? map.tables.find((t) => singular(t.name) === subject) : null) ??
    null;

  const lines: string[] = [];
  let fixSql: string | null = null;
  const candidates = table ? [table] : map.tables.filter((t) => t.kind === "table" && t.schema === "public");

  const findings = await accessTest(got.tools, map, candidates.map((t) => `${t.schema}.${t.name}`));
  const logs = await got.tools.get_logs(got.tools.ref, "postgres", 60);
  const denied = logs.ok ? logs.value.filter((l) => /permission denied|row-level security|42501/i.test(l.message)).slice(0, 5) : [];

  if (table) {
    const owner = ownerColumn(table);
    lines.push(`**${table.name}**: row-level security is ${table.rls ? "on" : "OFF"}, with ${table.policies.length} ${table.policies.length === 1 ? "policy" : "policies"}.`);
    for (const p of table.policies) lines.push(`- ${p.name}: ${p.command} for ${p.roles.join(", ")}${p.using ? ` when ${p.using}` : ""}`);
    if (!table.grants.authenticated.includes("select")) {
      lines.push(`\nSigned-in users have no SELECT grant on ${table.name}, so no policy can help them — the table is invisible to them.`);
      fixSql = `grant select on ${table.schema}.${table.name} to authenticated;`;
    } else if (table.rls && !table.policies.some((p) => (p.command === "select" || p.command === "all") && p.roles.some((r) => r === "authenticated" || r === "public"))) {
      lines.push(`\nThat's the cause: no policy lets signed-in users read ${table.name}, and with RLS on, no policy means no rows.`);
      fixSql = owner
        ? rlsFixSql({ ...table, policies: [], rls: true }).split("\n").filter((l) => /for select/.test(l)).join("\n")
        : `create policy ${table.name}_read on ${table.schema}.${table.name} for select to authenticated using (true);`;
    } else if (owner && table.policies.some((p) => (p.command === "select" || p.command === "all") && p.using && !p.using.includes(owner))) {
      lines.push(`\nThe read policy doesn't check ${owner}, so it may not match the rows people own.`);
    }
    if (!fixSql && owner && table.columns.find((c) => c.name === owner)?.nullable) {
      lines.push(`\nIf rows were created without ${owner} set, nobody owns them and owner-only policies hide them. Check with: select count(*) from ${table.name} where ${owner} is null.`);
    }
  } else if (input.subject) {
    lines.push(`I couldn't find a table for "${input.subject}". Tables: ${map.tables.filter((t) => t.schema === "public").map((t) => t.name).join(", ") || "none"}.`);
  }
  const failing = findings.filter((f) => !f.ok);
  if (failing.length) lines.push("", "Access test:", ...failing.map((f) => `- ${f.message}`));
  if (denied.length) lines.push("", "Recent database errors:", ...denied.map((d) => `- ${d.at}: ${d.message}`));
  if (!lines.length) lines.push("Policies and grants look right, and the access test passed. If it still happens, the rows may belong to a different user than the one signed in.");

  const fix = fixSql ? await planChange(service, { projectId: input.projectId, userId: input.userId, actor: "agent", sql: fixSql, request: `fix access to ${table?.name}` }) : null;
  return { ok: true, message: lines.join("\n"), fix: fix && fix.ok ? fix : null };
}

/** "Make orders only visible to the person who placed them." */
export async function planOwnerOnly(service: SupabaseClient, input: { projectId: string; userId: string; table: string }): Promise<Planned | Failure> {
  const got = await withTools(service, input.projectId, "agent");
  if (!got.ok) return got;
  const map = got.map ?? (await scanWith(service, input.projectId, got.tools, null).then((s) => (s.ok ? s.map : null)));
  if (!map) return { ok: false, reason: "Your database could not be read." };
  const table = resolveTable(input.table, map) ?? map.tables.find((t) => singular(t.name) === singular(input.table)) ?? null;
  if (!table) return { ok: false, reason: `There's no ${input.table} table.` };
  const owner = ownerColumn(table);
  if (!owner) {
    return { ok: false, reason: `${table.name} has no column that says who it belongs to (like user_id → auth.users). Add one first: "add a user_id to ${table.name}".` };
  }
  const name = `${table.schema}.${table.name}`;
  const replaced = table.policies.filter((p) => p.command === "select" || p.command === "all").map((p) => `drop policy if exists "${p.name.replace(/"/g, '""')}" on ${name};`);
  const sql = [...replaced, rlsFixSql({ ...table, policies: [] }).replace(/\nalter table [^\n]+ enable row level security;$/, table.rls ? "" : `\nalter table ${name} enable row level security;`)].join("\n");
  return planChange(service, { projectId: input.projectId, userId: input.userId, actor: "agent", sql, request: `make ${table.name} visible only to its owner` });
}

/** The fixes the wiring report proposes, as one surgery (the "Fix both" button). */
export async function planWiringFixes(service: SupabaseClient, input: { projectId: string; userId: string }): Promise<Planned | Failure> {
  const scan = await scanDatabase(service, input.projectId, "agent");
  if (!scan.ok) return scan;
  if (!scan.wiring) return { ok: false, reason: "This app has no data layer planned yet." };
  const sql = surgeryFor(scan.wiring, { risks: true, missing: true });
  if (!sql.trim()) return { ok: false, reason: "Nothing to fix — the app is fully wired." };
  return planChange(service, { projectId: input.projectId, userId: input.userId, actor: "user", sql, request: "wire the app to the database" });
}

/* ── Sampling ─────────────────────────────────────────────────────────────── */

/** Up to five masked rows, only when a table's meaning is unclear; instruction-like values flagged. */
export async function sampleTable(service: SupabaseClient, input: { projectId: string; table: string }): Promise<{ ok: true; rows: Record<string, unknown>[]; flagged: { where: string; excerpt: string }[]; reason: string } | Failure> {
  const got = await withTools(service, input.projectId, "agent");
  if (!got.ok) return got;
  const map = got.map;
  const table = map ? resolveTable(input.table, map) : null;
  if (!table) return { ok: false, reason: `There's no ${input.table} in the last scan. Re-scan first.` };
  const allowed = maySample(table);
  if (!allowed.ok) return { ok: false, reason: allowed.reason };
  const rows = await got.tools.query_readonly(got.tools.ref, sampleSql(table.schema, table.name), 5);
  if (!rows.ok) return rows;
  return { ok: true, rows: rows.value, flagged: flagRows(table.name, rows.value), reason: allowed.reason };
}
