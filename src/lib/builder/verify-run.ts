/* Running the app test, repairing what it finds, and only then calling the
 * build Built — and charging for it.
 *
 * A web app with sign-in lands from the save route as "Checking", with its
 * price held on a build_verifications row instead of charged. This takes it
 * from there:
 *
 *   1. a confirmed test member is made in the app's own auth
 *   2. a real browser (Browserless) runs the test in verify-app.ts
 *   3. a failure is repaired — one file, the one the failed step is about —
 *      stored as a new version, and tested again, up to REPAIR_ROUNDS times
 *   4. the test member and what they saved are removed
 *   5. passed: the project is Built and the held price is charged.
 *      failed: the project is "Needs fixing", the owner is told exactly what
 *      did not work, and nothing is charged.
 *
 * Where the test cannot run at all — no browser configured, no way into the
 * app's database to make a test member — the build is Built as before, the
 * price is charged, and the thread says plainly it was not browser-tested.
 * A test that never ran is never reported as one that passed.
 *
 * Server-only. Never throws. */

import { randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { chargeCredits, type ChargeInput } from "@/lib/credits-server";
import { recordMessage } from "@/lib/thread-server";

import { type BackendConnection, envFor, resolveBackend } from "./backend/connection";
import { runnerFor, type SqlRunner } from "./backend/schema-sync";
import { editSource } from "./edit";
import { appPreviewDocument } from "./preview/app-preview";
import { loadTree, storeTree } from "./store-tree";
import type { FileTree } from "./tree";
import {
  DATABASE_TROUBLE,
  REPAIR_ROUNDS,
  type BrowserRun,
  browserScript,
  judge,
  readBrowserRun,
  removeMemberSql,
  repairTarget,
  savedRecordSql,
  testMemberSql,
  testPassword,
  testRoutes,
} from "./verify-app";

export type HeldCharge = Omit<ChargeInput, "userId" | "projectId">;

export type VerificationRow = {
  id: string;
  project_id: string;
  user_id: string;
  build_id: string;
  request_id: string | null;
  status: "checking" | "passed" | "failed" | "skipped";
  attempts: number;
  charge: HeldCharge | null;
};

export function browserTestsConfigured(): boolean {
  return Boolean(process.env.BROWSERLESS_URL?.trim());
}

/** Opens the check for a build, holding its price. Returns the row id, or null when it could not be written. */
export async function openVerification(
  service: SupabaseClient,
  input: { projectId: string; userId: string; buildId: string; requestId: string | null; charge: HeldCharge },
): Promise<string | null> {
  const { data, error } = await service
    .from("build_verifications")
    .upsert(
      {
        project_id: input.projectId,
        user_id: input.userId,
        build_id: input.buildId,
        request_id: input.requestId,
        status: "checking",
        attempts: 0,
        charge: input.charge,
        checks: [],
        reason: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "build_id" },
    )
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    // eslint-disable-next-line no-console
    console.error("verify: the check could not be opened:", error?.message);
    return null;
  }
  return data.id;
}

/** Asks the verify route to run the check, in its own time budget. */
export async function kickVerification(verificationId: string, origin: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  try {
    const response = await fetch(new URL("/api/builder/verify", origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ verificationId }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/* ── The browser ─────────────────────────────────────────────────────────── */

function functionEndpoint(): string | null {
  const base = process.env.BROWSERLESS_URL?.trim();
  if (!base) return null;
  const url = new URL(`${base.replace(/\/(?:screenshot|function)\/?$/, "").replace(/\/$/, "")}/function`);
  const token = process.env.BROWSERLESS_TOKEN?.trim();
  if (token && !url.searchParams.has("token")) url.searchParams.set("token", token);
  return url.toString();
}

async function runInBrowser(context: Record<string, unknown>): Promise<BrowserRun | string> {
  const to = functionEndpoint();
  if (!to) return "no browser is configured (BROWSERLESS_URL)";
  let lastError = "";
  for (const style of ["esm", "cjs"] as const) {
    try {
      const response = await fetch(to, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify({ code: browserScript(style), context }),
        signal: AbortSignal.timeout(100_000),
        cache: "no-store",
      });
      const text = await response.text();
      if (!response.ok) {
        lastError = `the browser service answered ${response.status}: ${text.slice(0, 160)}`;
        /* A v1 service refuses `export default`; anything else will not get better. */
        if (style === "esm" && /export|module|syntax|unexpected token/i.test(text)) continue;
        return lastError;
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        return "the browser service did not answer with a result";
      }
      return readBrowserRun(parsed) ?? "the browser service answered in a shape that could not be read";
    } catch (error) {
      lastError = error instanceof Error && error.name === "TimeoutError" ? "the browser test took too long" : "the browser service could not be reached";
      return lastError;
    }
  }
  return lastError || "the browser test could not run";
}

/* ── The test member ─────────────────────────────────────────────────────── */

type Member = { id: string; email: string; password: string };

async function makeMember(service: SupabaseClient, backend: BackendConnection, runner: SqlRunner | null): Promise<Member | string> {
  const password = testPassword(() => randomBytes(6).toString("hex"));
  const tag = randomBytes(4).toString("hex");
  const email = `check-${tag}@quickstark.tech`;
  if (backend.mode === "shared") {
    /* The shared instance is this platform's own Supabase. */
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "QuickStark Check" } });
    if (error || !data.user) return `a test member could not be made: ${error?.message ?? "no user came back"}`;
    return { id: data.user.id, email, password };
  }
  if (!runner) return "this app's database cannot be reached from here to make a test member";
  const id = randomUUID();
  const made = await runner.query(testMemberSql({ id, email, password }));
  if (!made.ok) return `a new member could not be added to this app's database: ${made.reason}`;
  return { id, email, password };
}

async function removeMember(service: SupabaseClient, backend: BackendConnection, runner: SqlRunner | null, member: Member) {
  try {
    if (runner) await runner.query(removeMemberSql(backend.schema || "public", member.id));
    if (backend.mode === "shared") await service.auth.admin.deleteUser(member.id);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("verify: the test member could not be removed:", error);
  }
}

async function savedInDatabase(runner: SqlRunner | null, schema: string, marker: string): Promise<boolean | null> {
  if (!runner) return null;
  const ran = await runner.query(savedRecordSql(schema, marker));
  if (!ran.ok) return null;
  const row = ran.rows[0] as { found?: unknown } | undefined;
  const found = Number(row?.found ?? NaN);
  return Number.isFinite(found) ? found > 0 : null;
}

/* ── A repair, stored as a version ───────────────────────────────────────── */

async function storeRepair(service: SupabaseClient, row: VerificationRow, buildId: string, tree: FileTree, round: number, note: string): Promise<string | null> {
  const { data: base } = await service.from("project_builds").select("html, prompt").eq("id", buildId).maybeSingle();
  const { data: fixed, error } = await service
    .from("project_builds")
    .insert({
      project_id: row.project_id,
      user_id: row.user_id,
      request_id: `verify:${round}:${row.id}`,
      prompt: String(base?.prompt ?? "Automatic fix"),
      html: String(base?.html ?? ""),
      model: "app-test repair",
      files_touched: 1,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !fixed) return null;
  try {
    await storeTree(service, { buildId: fixed.id, projectId: row.project_id, userId: row.user_id }, tree);
  } catch {
    await service.from("project_builds").delete().eq("id", fixed.id);
    return null;
  }
  await service.from("projects").update({ last_build_at: new Date().toISOString() }).eq("id", row.project_id);
  // eslint-disable-next-line no-console
  console.info(`verify: ${row.project_id} repaired (${note})`);
  return fixed.id;
}

/* ── The whole check ─────────────────────────────────────────────────────── */

async function say(service: SupabaseClient, row: VerificationRow, body: string, tone: "normal" | "error", key: string) {
  await recordMessage(service, {
    projectId: row.project_id,
    userId: row.user_id,
    role: "system",
    body,
    tone,
    kind: "chat",
    dedupeKey: `verify:${row.id}:${key}`,
  });
}

async function finish(
  service: SupabaseClient,
  row: VerificationRow,
  outcome: { status: "passed" | "failed" | "skipped"; reason: string | null; checks: unknown[]; attempts: number },
) {
  const now = new Date().toISOString();
  const { data: claimed } = await service
    .from("build_verifications")
    .update({ status: outcome.status, reason: outcome.reason, checks: outcome.checks, attempts: outcome.attempts, updated_at: now, finished_at: now })
    .eq("id", row.id)
    .eq("status", "checking")
    .select("id");
  /* Somebody else finished it first. */
  if (!claimed || claimed.length === 0) return;

  const { data: project } = await service.from("projects").select("deleted_at").eq("id", row.project_id).maybeSingle();
  await service
    .from("projects")
    .update({ status: outcome.status === "failed" ? "Needs fixing" : "Built", updated_at: now })
    .eq("id", row.project_id);

  /* Charged only for an app that passed, or one the test could not reach. */
  if (outcome.status !== "failed" && row.charge && !project?.deleted_at) {
    await chargeCredits(service, { ...row.charge, userId: row.user_id, projectId: row.project_id });
    await service.from("build_verifications").update({ charged: true }).eq("id", row.id);
  }
}

/** Runs the check for one verification row. Safe to call twice: only a row still "checking" is run. */
export async function runVerification(service: SupabaseClient, verificationId: string): Promise<void> {
  const { data } = await service
    .from("build_verifications")
    .select("id, project_id, user_id, build_id, request_id, status, attempts, charge")
    .eq("id", verificationId)
    .maybeSingle<VerificationRow>();
  if (!data || data.status !== "checking") return;
  const row = data;

  const skip = async (why: string) => {
    await say(service, row, `Your app is ready. It was not tested in a browser this time — ${why}.`, "normal", "skipped");
    await finish(service, row, { status: "skipped", reason: why, checks: [], attempts: row.attempts });
  };

  if (!browserTestsConfigured()) return skip("no test browser is set up on this platform");
  /* A run that keeps dying part-way is not retried forever. */
  if (row.attempts > REPAIR_ROUNDS + 1) return skip("the test could not finish");

  const backend = await resolveBackend(service, row.project_id);
  if (!backend || !backend.ready) {
    await say(service, row, "Your app could not be tested: its database is not ready, so nobody could sign in to it. Connect or create a database from the Database panel, then rebuild. You were not charged for this build.", "error", "no-db");
    await finish(service, row, { status: "failed", reason: "the database is not ready", checks: [], attempts: row.attempts });
    return;
  }

  let tree = await loadTree(service, row.build_id);
  const routes = testRoutes(tree);
  if (!routes) {
    await say(service, row, "Your app has no sign-in page, so members cannot use it. Ask in the chat to add a sign-in page, or rebuild. You were not charged for this build.", "error", "no-login");
    await finish(service, row, { status: "failed", reason: "no sign-in page", checks: [], attempts: row.attempts });
    return;
  }

  const { data: project } = await service.from("projects").select("name").eq("id", row.project_id).maybeSingle();
  let runner: SqlRunner | null = null;
  let member: Member | null = null;
  const checks: unknown[] = [];
  let buildId = row.build_id;
  let attempts = row.attempts;
  try {
    runner = backend.mode === "shared" ? await runnerFor(service, backend, row.project_id).catch(() => null) : await runnerFor(service, backend, row.project_id);
    const made = await makeMember(service, backend, runner);
    if (typeof made === "string") {
      if (/cannot be reached/.test(made)) return await skip(made);
      await say(service, row, `Your app's sign-up is broken: ${made}. Ask in the chat to fix sign-up, or rebuild. You were not charged for this build.`, "error", "member");
      await finish(service, row, { status: "failed", reason: made, checks, attempts });
      return;
    }
    member = made;

    for (let round = 0; round <= REPAIR_ROUNDS; round += 1) {
      attempts += 1;
      await service.from("build_verifications").update({ attempts, updated_at: new Date().toISOString() }).eq("id", row.id);
      const html = appPreviewDocument({ tree, projectName: (project?.name as string | null) ?? null, env: envFor(backend) });
      if (!html) {
        await say(service, row, "Your app could not be opened in a browser — its pages could not be put together. Ask in the chat to fix it, or rebuild. You were not charged for this build.", "error", "no-html");
        await finish(service, row, { status: "failed", reason: "the app could not be rendered", checks, attempts });
        return;
      }
      const marker = `QS-CHECK-${randomBytes(4).toString("hex").toUpperCase()}`;
      const ran = await runInBrowser({
        html,
        email: member.email,
        password: member.password,
        login: routes.login,
        dashboard: routes.dashboard,
        forms: routes.forms,
        marker,
        trouble: DATABASE_TROUBLE.source,
      });
      if (typeof ran === "string") return await skip(ran);

      const saved = await savedInDatabase(runner, backend.schema || "public", marker);
      const verdict = judge(ran, { needsDashboard: Boolean(routes.dashboard), saved, marker });
      checks.push({ round, buildId, steps: ran.steps, errors: ran.errors.slice(0, 4), saved, passed: verdict.passed });

      if (verdict.passed) {
        await say(
          service,
          row,
          [`Your app passed its test in a real browser${round > 0 ? `, after ${round} automatic ${round === 1 ? "fix" : "fixes"}` : ""}:`, ...verdict.lines].join("\n"),
          "normal",
          "passed",
        );
        await finish(service, row, { status: "passed", reason: null, checks, attempts });
        return;
      }

      const failed = verdict.failed;
      const target = failed ? repairTarget(ran, routes, failed) : null;
      const file = target ? tree.find((f) => f.path === target.path) : null;
      if (round === REPAIR_ROUNDS || !target || !file) {
        await say(
          service,
          row,
          [
            "Your app did not pass its test, so it is not marked Built:",
            ...verdict.lines,
            "",
            `Ask in the chat to fix it — for example: "${failed?.name === "save" ? "members can't save a record" : failed?.name === "dashboard" ? "the dashboard doesn't open after signing in" : "signing in doesn't work"}". You were not charged for this build.`,
          ].join("\n"),
          "error",
          "failed",
        );
        await finish(service, row, { status: "failed", reason: failed?.detail ?? "the test failed", checks, attempts });
        return;
      }

      await say(service, row, `Testing your app: ${verdict.lines.find((l) => l.startsWith("✗")) ?? "a step failed"}. Fixing ${target.path} and testing again.`, "normal", `fixing-${round}`);
      let edited: Awaited<ReturnType<typeof editSource>> | null = null;
      try {
        edited = await editSource(target.brief, file, "named", tree);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("verify: the repair could not be made:", error);
      }
      if (!edited || edited.applied === 0) {
        await say(service, row, ["Your app did not pass its test, and the automatic fix could not be made:", ...verdict.lines, "", "Ask in the chat to fix it. You were not charged for this build."].join("\n"), "error", "failed");
        await finish(service, row, { status: "failed", reason: failed?.detail ?? "the test failed", checks, attempts });
        return;
      }
      tree = tree.map((f) => (f.path === target.path ? { ...f, content: edited.contents } : f));
      const stored = await storeRepair(service, row, buildId, tree, round + 1, target.path);
      if (stored) buildId = stored;
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`verify: ${row.project_id} — the check failed to run:`, error);
    await skip("the test could not finish");
  } finally {
    if (member) await removeMember(service, backend, runner, member);
    await runner?.close().catch(() => undefined);
  }
}

/** Checks left "checking" for too long, for the daily backstop. */
export async function staleVerifications(service: SupabaseClient, olderThanMinutes = 20): Promise<string[]> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const { data } = await service.from("build_verifications").select("id").eq("status", "checking").lt("updated_at", cutoff).limit(20);
  return (data ?? []).map((r) => String(r.id));
}
