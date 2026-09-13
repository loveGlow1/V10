/* Where a build has got to, asked from a workspace that was reopened.
 *
 * The gap this fills is small to describe and was the whole of what a returning
 * visitor could learn. The detailed timeline — which stage, what each one
 * found, what it cost — was streamed over NDJSON from /api/build and never
 * stored, so it existed for exactly as long as the tab that asked for it. Come
 * back five minutes later and the only thing left was `projects.status`, which
 * says "Building" and nothing else, for up to twenty-five minutes.
 *
 * So this reads what the job wrote down. It is a lookup with no side effects:
 * nothing here starts, advances or cancels anything.
 */

import { NextResponse } from "next/server";

import { describeJob, JOB_PROGRESS } from "@/lib/jobs/state";
import { liveJob, readSteps } from "@/lib/jobs/store";
import { latestDeployment } from "@/lib/publish/deployment-store";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "../backend/owned";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    /* Not an error to the caller. A deployment with no service key cannot read
       jobs and never wrote any, so "nothing in flight" is the true answer
       rather than a failure to find out. */
    return NextResponse.json({ building: false, job: null, steps: [] });
  }

  const job = await liveJob(service, owned.projectId);

  if (!job) {
    /* Nothing running. The deployment is still worth reporting: a build that
       finished ten minutes ago may still be compiling on Vercel, and that is
       the difference between "your app is live" and "your app is on its way". */
    const deployment = await latestDeployment(service, owned.projectId);
    return NextResponse.json({
      building: false,
      job: null,
      steps: [],
      deployment: deployment
        ? { state: deployment.state, url: deployment.url, error: deployment.error }
        : null,
    });
  }

  const steps = await readSteps(service, job.id);

  return NextResponse.json({
    building: true,
    job: {
      id: job.id,
      state: job.state,
      /* The sentence, composed where the states are defined rather than in the
         panel — a stored job and a live one then read identically, which is
         the whole reason the panel could only ever say "Building" before. */
      says: describeJob(job),
      progress: JOB_PROGRESS[job.state],
      error: job.error,
      startedAt: job.createdAt,
      attempts: job.attempts,
    },
    steps,
  });
}
