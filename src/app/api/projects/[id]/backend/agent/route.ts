import { NextResponse } from "next/server";

import { autopilotEnabled, autopilotKilled, runAutopilot } from "@/lib/builder/backend/agent/autopilot";
import {
  approveSurgery,
  cancelSurgery,
  diagnose,
  planChange,
  planNewProject,
  planOwnerOnly,
  planUndo,
  planWiringFixes,
  sampleTable,
  scanDatabase,
  wireApp,
} from "@/lib/builder/backend/agent/service";
import { ScopeError, dbToolsFor } from "@/lib/builder/backend/agent/tools";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "../owned";

/* The database agent, for the Database panel.
 *
 *   GET    the stored map, analysis, wiring and surgery history
 *   POST   { action: "scan" }                     re-read the database (read-only)
 *          { action: "wire" }                     wire the app to existing tables
 *          { action: "query", sql }               one read, masked, ≤50 rows
 *          { action: "sample", table }            ≤5 masked rows, only when meaning is unclear
 *          { action: "plan", sql | request }      plan + dry-run a surgery; nothing applied
 *          { action: "fix_wiring" }               the wiring report's fixes as one surgery
 *          { action: "diagnose", subject }        why something can't be seen
 *          { action: "owner_only", table }        owner-only access, planned
 *          { action: "undo" }                     the last change's rollback, planned
 *          { action: "new_project", … }           a new Supabase project, planned with its cost
 *          { action: "approve", surgeryId, confirmation? }   ← the ONLY path to a write
 *          { action: "cancel", surgeryId }
 *          { action: "autopilot", trigger? }       bring the database in line with the app:
 *                                                  additive changes applied, the rest planned
 *          { action: "autopilot_setting", enabled } the owner's switch for the above
 *
 * Approve is answered under the owner's own session (ownedProject), and the
 * approval token is minted and spent inside approveSurgery. The chat path can
 * plan; it cannot get here. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function context(id: string) {
  const owned = await ownedProject(id);
  if ("error" in owned) return { error: owned.error };
  const service = createSupabaseServiceClient();
  if (!service) return { error: NextResponse.json({ error: "This deployment cannot manage databases." }, { status: 503 }) };
  return { owned, service };
}

const failed = (result: { reason: string; reconnect?: boolean }, status = 400) =>
  NextResponse.json({ error: result.reason, reconnect: result.reconnect ?? false }, { status });

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const got = await context(id);
  if ("error" in got) return got.error;
  const { owned, service } = got;

  const [{ data: backend }, { data: surgeries }] = await Promise.all([
    service
      .from("project_backends")
      .select("mode, supabase_ref, managed_ref, db_map, db_map_at, db_analysis, db_wiring")
      .eq("project_id", owned.projectId)
      .maybeSingle(),
    service
      .from("db_surgeries")
      .select("id, kind, name, request, summary, level, status, plan, confirmation, error, verification, undoes, created_at, applied_at, cleanup_after")
      .eq("project_id", owned.projectId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const tools = await dbToolsFor(service, owned.projectId, "user");
  const wiring = (backend?.db_wiring ?? null) as { report?: unknown; at?: string; types?: string | null } | null;
  return NextResponse.json({
    available: tools.ok,
    unavailableReason: tools.ok ? null : tools.reason,
    reconnect: !tools.ok && "reconnect" in tools ? tools.reconnect ?? false : false,
    map: backend?.db_map ?? null,
    scannedAt: backend?.db_map_at ?? null,
    analysis: backend?.db_analysis ?? null,
    wiring: wiring?.report ?? null,
    typesReady: Boolean(wiring?.types),
    surgeries: surgeries ?? [],
    autopilot: { enabled: await autopilotEnabled(service, owned.projectId), killed: autopilotKilled() },
  });
}

type Body = {
  action?: string;
  sql?: unknown;
  request?: unknown;
  table?: unknown;
  subject?: unknown;
  surgeryId?: unknown;
  confirmation?: unknown;
  name?: unknown;
  region?: unknown;
  organizationId?: unknown;
  trigger?: unknown;
  enabled?: unknown;
};

const str = (v: unknown, max = 20_000) => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const got = await context(id);
  if ("error" in got) return got.error;
  const { owned, service } = got;
  const body = (await request.json().catch(() => ({}))) as Body;
  const base = { projectId: owned.projectId, userId: owned.userId };

  try {
    switch (body.action) {
      case "scan": {
        const r = await scanDatabase(service, owned.projectId, "user");
        return r.ok ? NextResponse.json({ map: r.map, analysis: r.analysis, wiring: r.wiring }) : failed(r);
      }
      case "wire": {
        const r = await wireApp(service, owned.projectId, "user");
        return r.ok ? NextResponse.json({ message: r.message, wiring: r.scan.wiring, typesReady: Boolean(r.types) }) : failed(r);
      }
      case "query": {
        const tools = await dbToolsFor(service, owned.projectId, "user");
        if (!tools.ok) return failed(tools);
        const r = await tools.tools.query_readonly(tools.tools.ref, str(body.sql), 50);
        return r.ok ? NextResponse.json({ rows: r.value }) : failed(r);
      }
      case "sample": {
        const r = await sampleTable(service, { projectId: owned.projectId, table: str(body.table, 200) });
        return r.ok ? NextResponse.json(r) : failed(r);
      }
      case "plan": {
        const sql = str(body.sql);
        const req = str(body.request, 2000);
        if (!sql && !req) return failed({ reason: "Say what to change, or give the SQL." });
        const r = await planChange(service, { ...base, actor: "user", sql: sql || null, request: req || null });
        return r.ok ? NextResponse.json({ surgery: r.surgery, message: r.message }) : failed(r);
      }
      case "fix_wiring": {
        const r = await planWiringFixes(service, base);
        return r.ok ? NextResponse.json({ surgery: r.surgery, message: r.message }) : failed(r);
      }
      case "diagnose": {
        const r = await diagnose(service, { ...base, subject: str(body.subject, 200) || null });
        return r.ok ? NextResponse.json({ message: r.message, surgery: r.fix?.surgery ?? null }) : failed(r);
      }
      case "owner_only": {
        const r = await planOwnerOnly(service, { ...base, table: str(body.table, 200) });
        return r.ok ? NextResponse.json({ surgery: r.surgery, message: r.message }) : failed(r);
      }
      case "undo": {
        const r = await planUndo(service, { ...base, actor: "user" });
        return r.ok ? NextResponse.json({ surgery: r.surgery, message: r.message }) : failed(r);
      }
      case "new_project": {
        const organizationId = str(body.organizationId, 200);
        const region = str(body.region, 40) || "eu-central-1";
        if (!organizationId) return failed({ reason: "Choose which organisation it goes in." });
        const r = await planNewProject(service, { ...base, name: str(body.name, 60) || "QuickStark app", region, organizationId });
        return r.ok ? NextResponse.json({ surgery: r.surgery, message: r.message }) : failed(r);
      }
      case "approve": {
        const surgeryId = str(body.surgeryId, 64);
        if (!surgeryId) return failed({ reason: "Which change?" });
        const r = await approveSurgery(service, { ...base, surgeryId, confirmation: str(body.confirmation, 200) || null });
        if (!r.ok) return failed(r, 409);
        return NextResponse.json("created" in r ? { message: r.message, created: r.created } : { message: r.message, surgery: r.surgery, verification: r.verification });
      }
      case "cancel": {
        const r = await cancelSurgery(service, owned.projectId, str(body.surgeryId, 64));
        return r.ok ? NextResponse.json({ cancelled: true }) : failed(r);
      }
      case "autopilot": {
        /* The message comes back rather than going into the thread: the
           panel or chat that asked shows it. */
        const r = await runAutopilot(service, {
          ...base,
          trigger: body.trigger === "connect" ? "connect" : "chat",
          announce: false,
        });
        return r.ok ? NextResponse.json({ status: r.status, message: r.message, surgeryIds: r.surgeryIds }) : failed(r);
      }
      case "autopilot_setting": {
        if (typeof body.enabled !== "boolean") return failed({ reason: "On or off?" });
        const { error } = await service
          .from("project_backends")
          .update({ db_autopilot: body.enabled })
          .eq("project_id", owned.projectId);
        if (error) return failed({ reason: "That setting couldn't be saved." }, 500);
        return NextResponse.json({ autopilot: { enabled: body.enabled && !autopilotKilled(), killed: autopilotKilled() } });
      }
      default:
        return failed({ reason: "Unknown action." });
    }
  } catch (error) {
    if (error instanceof ScopeError) return failed({ reason: error.message }, 403);
    // eslint-disable-next-line no-console
    console.error("db-agent route:", error);
    return failed({ reason: "Something went wrong. Nothing was changed." }, 500);
  }
}
