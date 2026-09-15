/* Finding out how a deployment went, after the request that started it is gone.
 *
 * This is the worker half of the split described in vercel-deploy.ts, and the
 * arithmetic that forced it is worth restating. A Next.js install-and-compile
 * takes one to three minutes. `deployProject` polled for up to 180 seconds. Both
 * of its call sites run in a serverless function that this account's plan stops
 * at 60. So every deployment slow enough to matter was created, built and hosted
 * correctly — and then lost, because the only thing that knew its id was a
 * function that no longer existed.
 *
 * Nothing waits now. The save route uploads, writes the id down and returns;
 * this asks Vercel how each one is getting on and settles the ones that have
 * finished. It is the same shape as /api/cron/reconcile beside it, which does
 * the same job for payments, and it is protected the same way.
 *
 * ── Why this is not the container the architecture wants ──────────────────
 *
 * It is a slice, not a worker. Each invocation does a bounded amount of work
 * and returns well inside the ceiling; progress happens because it is called
 * again, not because it waited. That is enough for polling somebody else's
 * build, which is all this does.
 *
 * ── Once a day, not every two minutes ────────────────────────────────────
 *
 * This asked to run every two minutes, and that is what stopped the platform
 * deploying: Hobby refuses a cron more frequent than daily, and refuses the
 * whole DEPLOYMENT with it. So the schedule is daily, and the prompt answer
 * comes from the workspace's own poll instead — see lib/publish/settle.ts,
 * which both callers share. This loop is the backstop.
 *
 * It is NOT enough for the two stages that still need a real worker: the QA
 * render loop and screenshot grounding both need a headless browser, which is
 * fifty megabytes of Chromium and cannot live in a function at all. Those wait
 * on the container. This does not, which is why it is here first.
 */

import { NextResponse } from "next/server";

import { pendingDeployments } from "@/lib/publish/deployment-store";
import { settleOne } from "@/lib/publish/settle";
import { deploymentsConfigured } from "@/lib/publish/vercel-deploy";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* Bounded by HOW MANY it looks at rather than by how long it waits, so this
   number is a ceiling it does not approach rather than a budget it spends. */
export const maxDuration = 60;

/* Ten per run, each one a single API call. A project with more deployments in
   flight than that is not a state anybody should be in, and the ones left over
   are picked up on the next run — oldest first, so nothing is starved. */
const PER_RUN = 10;

/* How long a deployment may sit in `queued` before it is called failed.
 *
 * Vercel's own build timeout is well inside this. Past it the honest reading is
 * not "still building" but "we lost track of this one", and saying so beats a
 * row that says queued forever — which is the exact failure mode this whole
 * change exists to remove, just relocated. */
const GIVE_UP_AFTER_MS = 30 * 60 * 1000;

/* Same gate as /api/cron/reconcile: Vercel's scheduler sends
   `Authorization: Bearer $CRON_SECRET`. Without the variable set the route
   refuses rather than running open, because it writes to project rows. */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }
  if (!deploymentsConfigured()) {
    return NextResponse.json({ checked: 0, reason: "no VERCEL_API_TOKEN" });
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return NextResponse.json({ error: "No service key." }, { status: 503 });
  }

  const pending = await pendingDeployments(service, PER_RUN);
  let settled = 0;
  let stillBuilding = 0;
  let retried = 0;

  for (const record of pending) {
    /* One definition of "settle a deployment", shared with the workspace's own
       poll — see lib/publish/settle.ts. This loop is the backstop: it finds the
       deployments nobody was watching, which on a daily schedule is most of the
       ones that were not settled on read. */
    const outcome = await settleOne(service, record);
    if (outcome === "settled") settled += 1;
    else if (outcome === "retried") retried += 1;
    else stillBuilding += 1;
  }

  /* The ones nobody is ever going to hear about. */
  const cutoff = new Date(Date.now() - GIVE_UP_AFTER_MS).toISOString();
  const { data: abandoned } = await service
    .from("project_deployments")
    .update({ state: "error", error: "Vercel never reported this deployment as finished." })
    .eq("state", "queued")
    .lt("created_at", cutoff)
    .select("id");

  return NextResponse.json({
    checked: pending.length,
    settled,
    stillBuilding,
    retried,
    abandoned: abandoned?.length ?? 0,
  });
}
