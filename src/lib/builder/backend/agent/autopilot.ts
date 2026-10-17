/* The database autopilot: after a build, or the moment a database is
 * connected, the app's database is made to match what the app needs — by
 * itself where that is provably safe, and with the owner's Approve everywhere
 * else.
 *
 * It is not a second path to a write. It runs the database agent's own
 * procedure (service.ts): scan read-only, work out what the app needs against
 * what is there (wiring.ts), write the change, plan it, dry-run it in a
 * rolled-back block, re-scan and abandon it if the database moved, apply it in
 * one transaction under an approval token, then verify — advisors, an access
 * test as a visitor and as a stranger, regenerated types. What the autopilot
 * adds is the decision a person would otherwise make by pressing Approve, and
 * it only makes that decision when nothing could be lost by it.
 *
 * ── The guardrails, each enforced in code ────────────────────────────────
 *
 *   ADDITIVE ONLY     Every statement must create something. Nothing is
 *                     dropped, renamed, rewritten, retyped or truncated; no
 *                     row is inserted, updated or deleted. (autoVerdict)
 *   BORN HERE         Access rules (policies, RLS, grants) are only set on
 *                     tables created in the same change. Changing who can
 *                     reach a table that already exists — even to fix it —
 *                     is always the owner's call.
 *   NO CODE           No functions, triggers, views, extensions or DO blocks:
 *                     code that runs inside somebody's database is reviewed
 *                     by a person.
 *   SMALL             At most MAX_STATEMENTS statements and MAX_NEW_TABLES
 *                     new tables in one change; a bigger change is planned
 *                     and waits.
 *   DRY RUN           Planned and dry-run like any other change; a failed dry
 *                     run applies nothing and is reported.
 *   FRESH             Re-scanned before it applies; if the database changed
 *                     since it was planned, it is not applied (approveSurgery).
 *   CHECKED TWICE     The same verdict is re-taken inside approveSurgery on
 *                     the stored plan, so nothing but a plan that passes here
 *                     can be applied without a person.
 *   ONE AT A TIME     A run is skipped while another one's plan is fresh,
 *                     and at most MAX_AUTO_PER_HOUR changes are applied per
 *                     project per hour.
 *   VERIFIED          New security warnings or a failed access test after the
 *                     change are reported, and its undo is planned at once,
 *                     one press away.
 *   OWNER'S SWITCH    project_backends.db_autopilot, on by default, turned off
 *                     from the Database panel; with it off, every change waits
 *                     for Approve.
 *   KILL SWITCH       DB_AUTOPILOT=off on the deployment turns it off for
 *                     everybody.
 *   AUDITED           Every change it plans or applies is a db_surgeries row
 *                     whose request starts with AUTOPILOT_MARK, and every tool
 *                     call is logged by tools.ts as the agent.
 *   SAID              Whatever it did, or did not do and why, is written into
 *                     the project's thread.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordMessage } from "@/lib/thread-server";

import { AUTOPILOT_MARK, MAX_AUTO_PER_HOUR, autoVerdict } from "./auto-verdict";
import type { SurgeryPlan } from "./surgery";
import { type Failure, type SurgeryRow, approveSurgery, planChange, planUndo, scanDatabase } from "./service";
import { dbToolsFor } from "./tools";
import { surgeryFor } from "./wiring";

export { AUTOPILOT_MARK, MAX_AUTO_PER_HOUR, MAX_NEW_TABLES, MAX_STATEMENTS, autoVerdict } from "./auto-verdict";
/* A plan younger than this means another run is still working. */
const IN_FLIGHT_MS = 2 * 60_000;

/* ── The switches ─────────────────────────────────────────────────────────── */

export function autopilotKilled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.DB_AUTOPILOT ?? "").trim().toLowerCase() === "off";
}

export async function autopilotEnabled(service: SupabaseClient, projectId: string): Promise<boolean> {
  if (autopilotKilled()) return false;
  const { data, error } = await service
    .from("project_backends")
    .select("db_autopilot")
    .eq("project_id", projectId)
    .maybeSingle<{ db_autopilot: boolean | null }>();
  /* A deployment whose database predates the column reads as on — the
     default — rather than failing the build over a setting. */
  if (error) return true;
  return data?.db_autopilot !== false;
}

/* ── The run ──────────────────────────────────────────────────────────────── */

export type Trigger = "build" | "connect" | "chat";

export type AutopilotResult =
  | { ok: true; status: "nothing" | "applied" | "awaiting" | "skipped"; message: string; surgeryIds: string[] }
  | Failure;

async function recentAutopilot(service: SupabaseClient, projectId: string) {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { data } = await service
    .from("db_surgeries")
    .select("id, status, created_at, applied_at")
    .eq("project_id", projectId)
    .like("request", `${AUTOPILOT_MARK}%`)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as Pick<SurgeryRow, "id" | "status" | "created_at" | "applied_at">[];
}

function cardFor(planned: { surgery: SurgeryRow; plan: SurgeryPlan }, why: string): string {
  return `**Waiting for your OK:** ${planned.plan.summary} (${why}). Open the Database panel to review and approve it — nothing has been changed yet.`;
}

/**
 * Brings the connected database in line with what the app needs. Every
 * outcome — applied, waiting for Approve, nothing to do, or why it stopped —
 * comes back as one message, and is written to the thread when `announce`.
 */
export async function runAutopilot(
  service: SupabaseClient,
  input: { projectId: string; userId: string; trigger: Trigger; announce?: boolean },
): Promise<AutopilotResult> {
  const result = await run(service, input);
  if (input.announce !== false && result.ok && result.status !== "nothing" && result.status !== "skipped") {
    await recordMessage(service, {
      projectId: input.projectId,
      userId: input.userId,
      role: "system",
      body: result.message,
      dedupeKey: `autopilot:${result.surgeryIds.join(",") || input.trigger}:${new Date().toISOString().slice(0, 16)}`,
    });
  }
  if (input.announce !== false && !result.ok && !result.reconnect) {
    await recordMessage(service, {
      projectId: input.projectId,
      userId: input.userId,
      role: "system",
      body: `I checked your database after the ${input.trigger === "connect" ? "connection" : "build"} but couldn't finish setting it up: ${result.reason}`,
      tone: "error",
      dedupeKey: `autopilot-failed:${input.projectId}:${new Date().toISOString().slice(0, 16)}`,
    });
  }
  return result;
}

async function run(
  service: SupabaseClient,
  input: { projectId: string; userId: string; trigger: Trigger },
): Promise<AutopilotResult> {
  /* Only where a database is connected through Supabase sign-in (or is one
     QuickStark manages). Anything else is not this run's to touch, and is
     not a failure: the app simply has no database here yet. */
  const reachable = await dbToolsFor(service, input.projectId, "agent");
  if (!reachable.ok) return { ok: true, status: "skipped", message: reachable.reason, surgeryIds: [] };

  /* ONE AT A TIME, and not too often. */
  const recent = await recentAutopilot(service, input.projectId);
  if (recent.some((r) => r.status === "planned" && Date.now() - Date.parse(r.created_at) < IN_FLIGHT_MS)) {
    return { ok: true, status: "skipped", message: "Another check of this database is already running.", surgeryIds: [] };
  }
  const appliedThisHour = recent.filter((r) => r.status === "applied").length;

  /* Read-only: what is there, and what the app needs from it. */
  const scan = await scanDatabase(service, input.projectId, "agent");
  if (!scan.ok) return scan;
  if (!scan.wiring) {
    return { ok: true, status: "nothing", message: "This app doesn't use a database, so there was nothing to set up.", surgeryIds: [] };
  }

  const missing = surgeryFor(scan.wiring, { missing: true, risks: false });
  const risks = surgeryFor(scan.wiring, { missing: false, risks: true });
  if (!missing.trim() && !risks.trim()) {
    return {
      ok: true,
      status: "nothing",
      message: `Your database already has everything this app needs. ${scan.wiring.summary}`,
      surgeryIds: [],
    };
  }

  const enabled = await autopilotEnabled(service, input.projectId);
  const lines: string[] = [];
  const ids: string[] = [];
  let applied = false;
  let awaiting = false;

  /* What is missing: created by itself when every step passes autoVerdict. */
  if (missing.trim()) {
    const planned = await planChange(service, {
      projectId: input.projectId,
      userId: input.userId,
      actor: "agent",
      sql: missing,
      request: `${AUTOPILOT_MARK} create what the app needs (${input.trigger})`,
    });
    if (!planned.ok) {
      lines.push(`I couldn't plan the tables this app needs: ${planned.reason}`);
    } else {
      ids.push(planned.surgery.id);
      const verdict = autoVerdict(planned.plan);
      const why = !enabled
        ? "automatic setup is off for this app"
        : appliedThisHour >= MAX_AUTO_PER_HOUR
          ? `${MAX_AUTO_PER_HOUR} automatic changes have already been made this hour`
          : verdict.auto
            ? null
            : verdict.why;

      if (why) {
        awaiting = true;
        lines.push(cardFor(planned, why));
      } else {
        const done = await approveSurgery(service, {
          projectId: input.projectId,
          userId: input.userId,
          surgeryId: planned.surgery.id,
          autopilot: true,
        });
        if (!done.ok) {
          lines.push(`I planned the tables this app needs but didn't apply them: ${done.reason}`);
        } else if ("verification" in done) {
          applied = true;
          const v = done.verification;
          const problems = [...v.newWarnings, ...v.access.filter((f) => !f.ok).map((f) => f.message), ...v.concurrentFailures];
          lines.push(`**Set up your database:** ${planned.plan.summary}`);
          if (problems.length) {
            /* VERIFIED: the undo is planned at once, so taking it back is one press. */
            const undo = await planUndo(service, { projectId: input.projectId, userId: input.userId, actor: "agent" });
            if (undo.ok) ids.push(undo.surgery.id);
            lines.push(
              `The checks afterwards found: ${problems.join("; ")}.`,
              undo.ok ? "I've planned the undo — approve it in the Database panel to take this change back." : "Say \"undo the last database change\" to take it back.",
            );
          } else {
            lines.push("Checked afterwards: no new security warnings, and visitors and other users can only reach what they should.");
          }
        }
      }
    }
  }

  /* RISKS — tables the app uses that are unsafe as they stand — always wait:
     changing who can reach an existing table is the owner's decision. */
  if (risks.trim()) {
    const planned = await planChange(service, {
      projectId: input.projectId,
      userId: input.userId,
      actor: "agent",
      sql: risks,
      request: `${AUTOPILOT_MARK} secure tables the app uses (${input.trigger})`,
    });
    if (planned.ok) {
      ids.push(planned.surgery.id);
      awaiting = true;
      lines.push(cardFor(planned, "it changes access to tables you already have"));
    } else {
      lines.push(`Some tables this app uses aren't protected, and I couldn't plan the fix: ${planned.reason}`);
    }
  }

  return {
    ok: true,
    status: applied ? "applied" : awaiting ? "awaiting" : "nothing",
    message: lines.join("\n\n") || "Nothing needed changing.",
    surgeryIds: ids,
  };
}
