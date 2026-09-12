/* Deployments, remembered by their real Vercel id.
 *
 * The id existed for about a millisecond before this: `deployProject` received
 * it from Vercel, returned it in `DeployOutcome`, and both call sites ignored
 * it and kept only the URL. So a deployment could be created and never asked
 * about again — which is exactly what happened to any build slow enough to
 * outlive the sixty seconds its function was allowed.
 *
 * Writing it down is what lets the waiting happen somewhere else. See
 * startDeployment and deploymentState in vercel-deploy.ts, and the worker in
 * src/app/api/cron/deployments.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type DeploymentRecord = {
  id: string;
  projectId: string;
  userId: string;
  buildId: string | null;
  jobId: string | null;
  deploymentId: string;
  vercelProject: string | null;
  url: string | null;
  state: "queued" | "ready" | "error" | "cancelled";
  error: string | null;
};

type Row = {
  id: string;
  project_id: string;
  user_id: string;
  build_id: string | null;
  job_id: string | null;
  deployment_id: string;
  vercel_project: string | null;
  url: string | null;
  state: string;
  error: string | null;
};

const COLUMNS =
  "id, project_id, user_id, build_id, job_id, deployment_id, vercel_project, url, state, error";

function read(row: Row): DeploymentRecord {
  const state =
    row.state === "ready" || row.state === "error" || row.state === "cancelled"
      ? row.state
      : "queued";
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    buildId: row.build_id,
    jobId: row.job_id,
    deploymentId: row.deployment_id,
    vercelProject: row.vercel_project,
    url: row.url,
    state,
    error: row.error,
  };
}

/**
 * Records a deployment the moment Vercel accepts it, before its build runs.
 *
 * Idempotent on `deployment_id`, which is Vercel's own and unique — so a retried
 * request that somehow uploads twice records one deployment rather than two
 * rows racing to describe the same build.
 */
export async function recordDeployment(
  service: SupabaseClient,
  input: {
    projectId: string;
    userId: string;
    buildId?: string | null;
    jobId?: string | null;
    deploymentId: string;
    vercelProject?: string | null;
    url?: string | null;
    inspectUrl?: string | null;
  },
): Promise<DeploymentRecord | null> {
  const { data, error } = await service
    .from("project_deployments")
    .upsert(
      {
        project_id: input.projectId,
        user_id: input.userId,
        build_id: input.buildId ?? null,
        job_id: input.jobId ?? null,
        deployment_id: input.deploymentId,
        vercel_project: input.vercelProject ?? null,
        url: input.url ?? null,
        inspect_url: input.inspectUrl ?? null,
        state: "queued",
      },
      { onConflict: "deployment_id" },
    )
    .select(COLUMNS)
    .single<Row>();

  if (error) {
    /* Logged, never thrown. The deployment is real and running whatever this
       table says; losing the bookkeeping costs the poll, not the site. */
    // eslint-disable-next-line no-console
    console.error("deployments: could not record one:", error.message);
    return null;
  }
  return read(data);
}

/** Deployments still in flight, oldest first — what the worker asks for. */
export async function pendingDeployments(
  service: SupabaseClient,
  limit = 10,
): Promise<DeploymentRecord[]> {
  const { data } = await service
    .from("project_deployments")
    .select(COLUMNS)
    .eq("state", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  return ((data ?? []) as Row[]).map(read);
}

/**
 * How it went, once something has found out.
 *
 * Writes the build row too, because that is where the rest of the app already
 * looks — the workspace's deploy button, the preview, the project summary. The
 * new table is the record; those two columns stay the view onto it, so nothing
 * that reads them had to change.
 */
export async function settleDeployment(
  service: SupabaseClient,
  record: DeploymentRecord,
  outcome: { state: "ready"; url: string } | { state: "error" | "cancelled"; reason: string },
): Promise<void> {
  const ready = outcome.state === "ready";

  await service
    .from("project_deployments")
    .update({
      state: outcome.state,
      url: ready ? outcome.url : record.url,
      error: ready ? null : outcome.reason,
      ready_at: ready ? new Date().toISOString() : null,
    })
    .eq("id", record.id);

  if (record.buildId) {
    await service
      .from("project_builds")
      .update({
        deployment_url: ready ? outcome.url : null,
        deployment_error: ready ? null : outcome.reason,
      })
      .eq("id", record.buildId);
  }
}

/** The newest deployment of a project, whatever state it is in. */
export async function latestDeployment(
  service: SupabaseClient,
  projectId: string,
): Promise<DeploymentRecord | null> {
  const { data } = await service
    .from("project_deployments")
    .select(COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Row>();

  return data ? read(data) : null;
}

/**
 * The Vercel project this QuickStark project already deploys to.
 *
 * Read from the first deployment that named one rather than re-derived from the
 * title, which is the defect this closes: `deploymentName(project.name, id)`
 * changes when somebody renames their project, so the next deploy created a
 * SECOND Vercel project and left the first one orphaned and still serving.
 * Null for a project that has never deployed, and the caller derives a name
 * once — after which this answers forever.
 */
export async function existingVercelProject(
  service: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const { data } = await service
    .from("project_deployments")
    .select("vercel_project")
    .eq("project_id", projectId)
    .not("vercel_project", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ vercel_project: string | null }>();

  return data?.vercel_project ?? null;
}
