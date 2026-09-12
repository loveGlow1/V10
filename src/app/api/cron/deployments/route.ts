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
 * It is NOT enough for the two stages that still need a real worker: the QA
 * render loop and screenshot grounding both need a headless browser, which is
 * fifty megabytes of Chromium and cannot live in a function at all. Those wait
 * on the container. This does not, which is why it is here first.
 */

import { NextResponse } from "next/server";

import { advance, readJob } from "@/lib/jobs/store";
import {
  pendingDeployments,
  settleDeployment,
  type DeploymentRecord,
} from "@/lib/publish/deployment-store";
import { deploymentState, deploymentsConfigured } from "@/lib/publish/vercel-deploy";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { recordMessage } from "@/lib/thread-server";
import { SITE_URL } from "@/lib/site";

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

/* The job this deployment belongs to, moved on now that its last stage is
   done. Best effort and never fatal: a deployment that landed is a deployment
   that landed whatever the job row says, and a build with no job at all is
   every build made before build_jobs existed. */
async function settleJob(
  service: ReturnType<typeof createSupabaseServiceClient>,
  record: DeploymentRecord,
  outcome: { state: "ready"; url: string } | { state: "error" | "cancelled"; reason: string },
): Promise<void> {
  if (!service || !record.jobId) return;

  const job = await readJob(service, record.jobId);
  if (!job || job.state !== "deploying") return;

  if (outcome.state === "ready") {
    await advance(service, job.id, { to: "ready", detail: { url: outcome.url } });
  } else {
    /* The DEPLOYMENT failed; the BUILD did not. The files are generated,
       stored and paid for, and the customer can redeploy them without
       spending a model call — see /api/projects/[id]/deploy. So the job is
       failed with the reason attached rather than the page being thrown
       away. */
    await advance(service, job.id, { to: "failed", error: outcome.reason });
  }
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

  for (const record of pending) {
    const state = await deploymentState(record.deploymentId);

    if (state.state === "ready") {
      await settleDeployment(service, record, state);
      await settleJob(service, record, state);
      settled += 1;

      /* Said where the question was asked. The customer was told their page
         was ready minutes ago; this is the other half — the app itself is now
         running at an address, which is a different and better thing than a
         summary of the files it was built from. Keyed on the deployment, so a
         run that overlaps another cannot say it twice. */
      await recordMessage(service, {
        projectId: record.projectId,
        userId: record.userId,
        role: "system",
        body: "Your app is live.",
        links: [
          { label: "Open it", href: state.url },
          { label: "Preview", href: `${SITE_URL}/preview/${record.projectId}` },
        ],
        kind: "build_ready",
        dedupeKey: `deployed:${record.deploymentId}`,
      });
      continue;
    }

    if (state.state === "error" || state.state === "cancelled") {
      await settleDeployment(service, record, state);
      await settleJob(service, record, state);
      settled += 1;

      await recordMessage(service, {
        projectId: record.projectId,
        userId: record.userId,
        role: "system",
        body: `Your project was built, but putting it online didn't work — ${state.reason}\n\nThe files are saved and nothing was lost. Deploying again costs nothing and doesn't rebuild anything.`,
        tone: "error",
        kind: "build_failed",
        dedupeKey: `deploy-failed:${record.deploymentId}`,
      });
      continue;
    }

    /* Still going, or Vercel could not be reached. Neither is a failure — see
       DeploymentState, where "unknown" is deliberately not "error": a
       deployment whose status could not be READ has not failed, and calling it
       failed would take down a site that is very likely live. */
    stillBuilding += 1;
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
    abandoned: abandoned?.length ?? 0,
  });
}
