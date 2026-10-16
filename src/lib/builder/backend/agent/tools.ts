/* The database agent's tools: how anything touches a connected Supabase.
 *
 * Option B of the spec — our own tool layer over Supabase's Management API —
 * because it works with the OAuth grant this platform already holds, and
 * because the hard rules below are enforced HERE, on our server, rather than
 * trusted to a hosted MCP whose acceptance of a third-party OAuth token is
 * not documented. (docs/DATABASE-AGENT.md has the spike notes.)
 *
 * The rules, each enforced by code below rather than by a prompt:
 *
 *   ONE PROJECT     Every tool takes a ref and refuses any ref but the one
 *                   stored in project_backends for this app (ScopeError).
 *   READ-ONLY       query_readonly parses the SQL (sql-guard.ts) and accepts a
 *                   single SELECT/WITH/EXPLAIN, capped at 50 rows, run as
 *                   Supabase's read-only role with a 5-second timeout.
 *   APPROVED        apply_migration, create_project and provider changes run
 *                   only with a valid, unexpired, single-use approval token
 *                   bound to the exact SQL — see approval.ts.
 *   NO SECRET KEY   get_api_keys returns the publishable key only. The secret
 *                   key goes straight into sealed server storage.
 *   LOGGED          Every call: who, which tool, which ref, the SQL's hash,
 *                   whether it worked. Secrets are redacted from the log.
 *
 * The token used is the app owner's (Connect Supabase) or the platform's own
 * management token for a QuickStark-managed project. Neither leaves this file.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  advisors as apiAdvisors,
  applyMigration as apiApplyMigration,
  authConfig,
  createProject as apiCreateProject,
  getProject,
  listMigrations as apiListMigrations,
  listProjects as apiListProjects,
  logs as apiLogs,
  patchAuthConfig,
  publicKey,
  runQuery,
  runReadOnlyQuery,
  secretKey,
  storageBuckets,
  typescriptTypes,
  type ApiResult,
  type AuthConfig,
  type SupabaseProject,
} from "@/lib/builder/backend/supabase-api";
import { accessTokenFor, seal } from "@/lib/builder/backend/supabase-oauth";

import { type ApprovalAction, sha256, verifyApproval } from "./approval";
import { type Advisor, type DatabaseMap, introspectSql, parseAdvisors, parseMap } from "./db-map";
import { type DryRun, dryRunSql, readDryRun } from "./probe";
import { limitedRead, readOnlyCheck, tokenize } from "./sql-guard";
import { flagInstructions, maskRows, redactSecrets } from "./untrusted";

export class ScopeError extends Error {
  constructor(asked: string, bound: string) {
    super(`This app is connected to ${bound}; it cannot reach ${asked}.`);
    this.name = "ScopeError";
  }
}

export type ToolResult<T> = { ok: true; value: T } | { ok: false; reason: string };

type BackendRow = { user_id: string; mode: string | null; supabase_ref: string | null; managed_ref: string | null; db_map: DatabaseMap | null };

export type Actor = "agent" | "user";

export type DbTools = {
  ref: string;
  mode: "own" | "quickstark_managed";
  list_projects(): Promise<ToolResult<{ ref: string; name: string; region: string; status: string }[]>>;
  get_project(ref: string): Promise<ToolResult<SupabaseProject>>;
  create_project(input: { name: string; region: string; organizationId: string }, approval: { token: string; subject: string }): Promise<ToolResult<{ ref: string }>>;
  introspect(ref: string): Promise<ToolResult<DatabaseMap>>;
  query_readonly(ref: string, sql: string, limit?: number): Promise<ToolResult<Record<string, unknown>[]>>;
  dry_run(ref: string, statements: string[]): Promise<ToolResult<DryRun>>;
  /** Runs SQL that rolls itself back (the RLS test). Not a write: it ends in an exception by construction. */
  probe(ref: string, sql: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  apply_migration(ref: string, input: { name: string; sql: string; concurrent: string[]; subject: string }, approvalToken: string): Promise<ToolResult<{ applied: true; concurrentFailures: string[] }>>;
  list_migrations(ref: string): Promise<ToolResult<{ version: string; name: string }[]>>;
  get_advisors(ref: string, type: "security" | "performance"): Promise<ToolResult<Advisor[]>>;
  generate_types(ref: string, schemas: string[]): Promise<ToolResult<string>>;
  get_api_keys(ref: string): Promise<ToolResult<{ publishable: string }>>;
  get_auth_config(ref: string): Promise<ToolResult<Omit<AuthConfig, "raw">>>;
  update_auth_config(ref: string, patch: Record<string, unknown>, approval?: { token: string; subject: string }): Promise<ToolResult<true>>;
  list_storage_buckets(ref: string): Promise<ToolResult<{ name: string; public: boolean }[]>>;
  get_logs(ref: string, service: "api" | "auth" | "postgres", minutes: number): Promise<ToolResult<{ at: string; message: string }[]>>;
};

/** Patch keys that only add this app's own redirect URLs — allowed without approval. */
const REDIRECT_ONLY = new Set(["uri_allow_list"]);

async function audit(
  service: SupabaseClient,
  entry: { projectId: string; userId: string; actor: Actor; tool: string; ref: string; sql?: string | null; ok: boolean; detail?: string | null },
) {
  await service
    .from("db_agent_audit")
    .insert({
      project_id: entry.projectId,
      user_id: entry.userId,
      actor: entry.actor,
      tool: entry.tool,
      ref: entry.ref,
      sql_hash: entry.sql ? sha256(entry.sql) : null,
      ok: entry.ok,
      detail: entry.detail ? redactSecrets(entry.detail).slice(0, 500) : null,
    })
    .then(({ error }) => {
      // eslint-disable-next-line no-console
      if (error) console.warn("db-agent: audit could not be written:", error.message);
    });
}

/** Records the approval's nonce. False when it was already used — the token is then refused. */
async function spend(service: SupabaseClient, projectId: string, subject: string, nonce: string): Promise<boolean> {
  const { error } = await service.from("db_agent_approvals").insert({ nonce, project_id: projectId, subject });
  return !error;
}

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const from = <T>(r: ApiResult<T>): ToolResult<T> => (r.ok ? { ok: true, value: r.value } : fail(r.reason));

/**
 * The tools for one app's database, or the reason there are none.
 *
 * Only a database reachable through the Management API qualifies: one linked
 * with Connect Supabase, or one QuickStark made. A pasted connection string
 * has no API to scope, read-only role or migration history, so the agent says
 * so rather than half-working.
 */
export async function dbToolsFor(
  service: SupabaseClient,
  projectId: string,
  actor: Actor,
): Promise<{ ok: true; tools: DbTools; map: DatabaseMap | null } | { ok: false; reason: string; reconnect?: boolean }> {
  const { data: row } = await service
    .from("project_backends")
    .select("user_id, mode, supabase_ref, managed_ref, db_map")
    .eq("project_id", projectId)
    .maybeSingle<BackendRow>();

  if (!row) return fail("This app has no database connected. Press Connect Supabase in the Database panel.");
  let token: string | null = null;
  let ref: string | null = null;
  let mode: DbTools["mode"];
  if (row.mode === "own" && row.supabase_ref) {
    ref = row.supabase_ref;
    token = await accessTokenFor(service, row.user_id);
    mode = "own";
    if (!token) return { ok: false, reason: "QuickStark can no longer reach your Supabase account. Press Connect Supabase again — it takes a moment.", reconnect: true };
  } else if (row.mode === "quickstark_managed" && row.managed_ref) {
    ref = row.managed_ref;
    token = process.env.SUPABASE_MANAGEMENT_TOKEN ?? null;
    mode = "quickstark_managed";
    if (!token) return fail("This deployment can't manage QuickStark databases right now.");
  } else if (row.mode === "shared") {
    return fail("This app's data is on QuickStark's shared preview database, where other people's projects live too, so the database agent doesn't work there. Connect your own Supabase from the Database panel.");
  } else if (row.mode === "own") {
    return fail("This Supabase was linked by pasting keys, which gives QuickStark no safe way to read or change it. Press Connect Supabase in the Database panel instead.");
  } else {
    return fail("This app has no database connected. Press Connect Supabase in the Database panel.");
  }

  const bound = ref;
  const userId = row.user_id;
  const t = token;
  const scope = (asked: string) => {
    if (asked !== bound) throw new ScopeError(asked, bound);
  };
  const log = (tool: string, ok: boolean, sql?: string | null, detail?: string | null) =>
    audit(service, { projectId, userId, actor, tool, ref: bound, sql, ok, detail });

  /* Every tool goes through this: scope first, then the call, then the log. */
  async function run<T>(tool: string, asked: string, sql: string | null, body: () => Promise<ToolResult<T>>): Promise<ToolResult<T>> {
    try {
      scope(asked);
    } catch (error) {
      await audit(service, { projectId, userId, actor, tool, ref: asked, sql, ok: false, detail: (error as Error).message });
      throw error;
    }
    const result = await body();
    await log(tool, result.ok, sql, result.ok ? null : result.reason);
    return result;
  }

  async function approved(action: ApprovalAction, token: string, subject: string, hash: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const verified = verifyApproval(token, { projectId, ref: bound, action, hash, subject });
    if (!verified.ok) return verified;
    if (!(await spend(service, projectId, subject, verified.claims.nonce))) return fail("that approval was already used");
    return { ok: true };
  }

  const tools: DbTools = {
    ref: bound,
    mode,

    async list_projects() {
      /* A managed project lives in QuickStark's organisation, which holds
         other people's projects: only this one is ever listed. */
      if (mode === "quickstark_managed") {
        const one = await getProject(t, bound);
        await log("list_projects", one.ok);
        return one.ok ? { ok: true, value: [{ ref: one.value.ref, name: one.value.name, region: one.value.region, status: one.value.status }] } : fail(one.reason);
      }
      const all = await apiListProjects(t);
      await log("list_projects", all.ok);
      return all.ok ? { ok: true, value: all.value.map((p) => ({ ref: p.ref, name: p.name, region: p.region, status: p.status })) } : fail(all.reason);
    },

    get_project: (ref) => run("get_project", ref, null, async () => from(await getProject(t, ref))),

    async create_project(input, approval) {
      /* Not scoped to the bound ref: it makes a new one. Scoped instead to the
         owner's own account, and to an approval for exactly this payload. */
      if (mode !== "own") return fail("A new project can only be created in your own Supabase account.");
      const payload = JSON.stringify({ name: input.name, region: input.region, organizationId: input.organizationId });
      const ok = await approved("create_project", approval.token, approval.subject, sha256(payload));
      if (!ok.ok) {
        await log("create_project", false, null, ok.reason);
        return ok;
      }
      const created = await apiCreateProject(t, input);
      await log("create_project", created.ok, null, created.ok ? `created ${created.value.ref}` : created.reason);
      return created.ok ? { ok: true, value: { ref: created.value.ref } } : fail(created.reason);
    },

    introspect: (ref) =>
      run("introspect", ref, null, async () => {
        const [scan, auth, adv, perf, migrations, buckets] = await Promise.all([
          readOnly(t, ref, introspectSql()),
          authConfig(t, ref),
          apiAdvisors(t, ref, "security"),
          apiAdvisors(t, ref, "performance"),
          apiListMigrations(t, ref),
          storageBuckets(t, ref),
        ]);
        if (!scan.ok) return fail(`Your database could not be read: ${scan.reason}`);
        const map = parseMap(scan.value, {
          ref,
          providers: auth.ok ? ["email", ...auth.value.providers.filter((p) => p !== "email")] : [],
          siteUrl: auth.ok ? auth.value.siteUrl : null,
          redirectUrls: auth.ok ? auth.value.redirectUrls : [],
          advisors: [...(adv.ok ? parseAdvisors(adv.value, "security") : []), ...(perf.ok ? parseAdvisors(perf.value, "performance") : [])],
          migrations: migrations.ok ? migrations.value : [],
          buckets: buckets.ok ? buckets.value : undefined,
        });
        if (!map) return fail("Your database answered in a shape QuickStark could not read, so nothing was assumed about it.");
        map.flagged = flagInstructions(map);
        return { ok: true, value: map };
      }),

    query_readonly: (ref, sql, limit = 50) =>
      run("query_readonly", ref, sql, async () => {
        const verdict = readOnlyCheck(sql);
        if (!verdict.ok) return fail(`Only reads run here: ${verdict.reason}.`);
        const result = await readOnly(t, ref, limitedRead(sql, Math.min(50, limit)));
        return result.ok ? { ok: true, value: maskRows(result.value) } : fail(result.reason);
      }),

    dry_run: (ref, statements) =>
      run("dry_run", ref, statements.join(";\n"), async () => {
        if (statements.length === 0) return { ok: true, value: { ok: true } as DryRun };
        const result = await runQuery(t, ref, dryRunSql(statements));
        const read = readDryRun(result.ok ? { ok: true } : { ok: false, reason: result.reason });
        /* A refusal that is not our marker and not Postgres's error is the
           API being unavailable, not the SQL being wrong. */
        if (!read.ok && !result.ok && result.status === null) return fail(result.reason);
        return { ok: true, value: read };
      }),

    probe: async (ref, sql) => {
      scope(ref);
      /* Only the two shapes probe.ts writes, both ending in a raised
         exception: they cannot commit anything. */
      if (!/^do \$qs(?:rls|dry\d+)\$/.test(sql) || !/raise exception '(?:QS_RLS_TEST:|QS_DRY_RUN_OK)/.test(sql)) {
        await log("probe", false, sql, "refused: not a self-rolling-back probe");
        return fail("refused");
      }
      const result = await runQuery(t, ref, sql);
      await log("probe", true, sql);
      return result.ok ? { ok: true } : { ok: false, reason: result.reason };
    },

    apply_migration: (ref, input, approvalToken) =>
      run("apply_migration", ref, input.sql, async () => {
        const hash = sha256([input.sql, ...input.concurrent].join("\n"));
        const ok = await approved("apply_migration", approvalToken, input.subject, hash);
        if (!ok.ok) return ok;
        /* One transaction: the API applies the migration atomically and
           records it in the project's history. Where that endpoint is not
           offered, the same SQL as one simple query is still one implicit
           transaction — all of it or none of it. */
        let applied = await apiApplyMigration(t, ref, input.name, input.sql, input.subject);
        if (!applied.ok && (applied.status === 404 || applied.status === 405)) {
          const fallback = await runQuery(t, ref, input.sql);
          applied = fallback.ok ? { ok: true, value: true } : fallback;
        }
        if (!applied.ok) return fail(applied.reason);
        /* CONCURRENTLY cannot run in a transaction: after it, each on its own.
           A failure leaves an index missing, never a table half-changed. */
        const concurrentFailures: string[] = [];
        for (const statement of input.concurrent) {
          const r = await runQuery(t, ref, statement);
          if (!r.ok) concurrentFailures.push(`${statement.slice(0, 80)}: ${r.reason}`);
        }
        await runQuery(t, ref, "notify pgrst, 'reload schema';");
        return { ok: true, value: { applied: true as const, concurrentFailures } };
      }),

    list_migrations: (ref) => run("list_migrations", ref, null, async () => from(await apiListMigrations(t, ref))),

    get_advisors: (ref, type) =>
      run("get_advisors", ref, null, async () => {
        const r = await apiAdvisors(t, ref, type);
        return r.ok ? { ok: true, value: parseAdvisors(r.value, type) } : fail(r.reason);
      }),

    generate_types: (ref, schemas) => run("generate_types", ref, null, async () => from(await typescriptTypes(t, ref, schemas))),

    get_api_keys: (ref) =>
      run("get_api_keys", ref, null, async () => {
        const key = await publicKey(t, ref);
        if (!key.ok) return fail(key.reason);
        /* The secret key, sealed straight into server storage. It is not in
           the return value, the log, or anything a model reads. */
        const secret = await secretKey(t, ref);
        if (secret.ok) {
          const sealed = seal(secret.value);
          if (sealed) {
            await service.from("db_agent_secrets").upsert({ project_id: projectId, ref, service_key: sealed }, { onConflict: "project_id" });
          }
        }
        return { ok: true, value: { publishable: key.value } };
      }),

    get_auth_config: (ref) =>
      run("get_auth_config", ref, null, async () => {
        const r = await authConfig(t, ref);
        return r.ok ? { ok: true, value: { providers: r.value.providers, siteUrl: r.value.siteUrl, redirectUrls: r.value.redirectUrls } } : fail(r.reason);
      }),

    update_auth_config: (ref, patch, approval) =>
      run("update_auth_config", ref, JSON.stringify(patch), async () => {
        const redirectOnly = Object.keys(patch).every((k) => REDIRECT_ONLY.has(k));
        if (!redirectOnly) {
          if (!approval) return fail("Changing sign-in providers or settings needs your approval.");
          const ok = await approved("update_auth_config", approval.token, approval.subject, sha256(JSON.stringify(patch)));
          if (!ok.ok) return ok;
        } else {
          /* Redirects may only be ADDED: the current list must survive intact. */
          const current = await authConfig(t, ref);
          if (!current.ok) return fail(current.reason);
          const next = String(patch.uri_allow_list ?? "").split(",").map((e) => e.trim()).filter(Boolean);
          if (current.value.redirectUrls.some((u) => !next.includes(u))) return fail("Redirect URLs can be added without approval, never removed.");
        }
        return from(await patchAuthConfig(t, ref, patch));
      }),

    list_storage_buckets: (ref) => run("list_storage_buckets", ref, null, async () => from(await storageBuckets(t, ref))),

    get_logs: (ref, service_, minutes) =>
      run("get_logs", ref, null, async () => {
        const source = service_ === "api" ? "edge_logs" : `${service_}_logs`;
        const r = await apiLogs(t, ref, `select timestamp, event_message from ${source} order by timestamp desc limit 50`, minutes);
        if (!r.ok) return fail(r.reason);
        return {
          ok: true,
          value: r.value.map((line) => ({
            at: String(line.timestamp ?? ""),
            message: redactSecrets(String(line.event_message ?? "")).replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9])[A-Za-z0-9.-]*\.([A-Za-z]{2,})/g, "$1***@$2.$3").slice(0, 300),
          })),
        };
      }),
  };

  return { ok: true, tools, map: row.db_map };
}

/* Reads go to the read-only endpoint, as supabase_read_only_user, with a
   five-second ceiling. Where that endpoint is not offered, the same single
   SELECT — already proven to be one by the parser — goes through the ordinary
   one. Every read is parsed first, so the fallback cannot carry a write. */
async function readOnly(token: string, ref: string, sql: string): Promise<ApiResult<unknown[]>> {
  if (tokenize(sql).length !== 1) return { ok: false, status: null, reason: "one read at a time" };
  const timed = `set statement_timeout = '5s';\n${sql}`;
  const first = await runReadOnlyQuery(token, ref, timed);
  if (first.ok || (first.status !== 404 && first.status !== 405)) return first;
  return runQuery(token, ref, timed);
}

