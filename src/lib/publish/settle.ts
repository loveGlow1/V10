/* What happens to a deployment once Vercel has finished with it.
 *
 * This was the body of /api/cron/deployments, and it is here because the cron
 * stopped being the only thing allowed to call it.
 *
 * ── Why it moved ──────────────────────────────────────────────────────────
 *
 * The cron ran every two minutes, and a `vercel.json` that asks for that is
 * REFUSED on Vercel's Hobby plan — not warned about, refused: the deployment is
 * never created, GitHub is told "Deployment failed", and nothing appears in the
 * Vercel dashboard to explain it. This platform is on Hobby (see the note on
 * maxDuration in /api/projects/[id]/deploy), so the file that added that cron
 * is the file that stopped this platform deploying at all, for three days, and
 * every fix written in those three days sat on main and never shipped.
 *
 * So the schedule is now daily, which Hobby allows — and a daily poll is
 * useless for telling somebody their app is live. That is what this module
 * fixes. Settling is asked for on the READ path as well: the workspace already
 * polls while a deployment is building, and that poll is now the thing that
 * finds out. The cron is the backstop for deployments nobody is watching.
 *
 * Both callers get the same function, so "how a deployment is settled" has one
 * definition rather than a copy per caller that drifts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { envFor, resolveBackend } from "@/lib/builder/backend/connection";
import { repairFromLog } from "@/lib/builder/repair-build";
import { loadTree, storeTree } from "@/lib/builder/store-tree";
import { canRetry } from "@/lib/jobs/state";
import { advance, noteAttempt, readJob } from "@/lib/jobs/store";
import {
  existingVercelProject,
  recordDeployment,
  settleDeployment,
  type DeploymentRecord,
} from "@/lib/publish/deployment-store";
import {
  aliasDeployment,
  appDomainFor,
  attachProjectDomain,
  deploymentName,
  deploymentState,
  deploymentsConfigured,
  previewAliasFor,
  reachable,
  startDeployment,
  vercelCredentials,
} from "@/lib/publish/vercel-deploy";
import { recordMessage } from "@/lib/thread-server";
import { SITE_URL } from "@/lib/site";

/** What became of one deployment when it was looked at. */
export type Outcome = "settled" | "retried" | "building";

/* The job this deployment belongs to, moved on now that its last stage is
   done. Best effort and never fatal: a deployment that landed is a deployment
   that landed whatever the job row says, and a build with no job at all is
   every build made before build_jobs existed. */
async function settleJob(
  service: SupabaseClient,
  record: DeploymentRecord,
  outcome: { state: "ready"; url: string } | { state: "error" | "cancelled"; reason: string },
): Promise<void> {
  if (!record.jobId) return;

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

/* Points this platform's own subdomain at a deployment that has finished.
 *
 * Separate from the call below so the failure is contained: every path returns,
 * none throws, and a caller that cannot alias still settles the deployment it
 * was called to settle. */
async function attachPreviewAlias(record: {
  deploymentId: string;
  vercelProject: string | null;
}): Promise<void> {
  const creds = vercelCredentials();
  if (!creds || !record.vercelProject) return;

  const alias = previewAliasFor(record.vercelProject);
  if (!alias) return;

  try {
    const assigned = await aliasDeployment(record.deploymentId, alias, creds);
    if (!assigned.ok) {
      /* Logged rather than surfaced. The customer has a working address; this
         is the nicer one, and its absence is an operator's problem — usually
         that the wildcard domain is not verified on the Vercel account. */
      // eslint-disable-next-line no-console
      console.warn(`deployments: ${alias} could not be aliased: ${assigned.reason}`);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("deployments: aliasing failed:", error);
  }
}

/* The address label this project was issued, or null.
 *
 * Read with the service key because settling runs on a cron as well as on the
 * workspace's poll, and neither has a session to read RLS with. It reads one
 * public column of a project this deployment already belongs to, so nothing is
 * widened by it.
 *
 * Best effort throughout: a slug that cannot be read costs the nicer half of
 * the address, never the deployment. */
async function slugOf(service: SupabaseClient, projectId: string): Promise<string | null> {
  try {
    const { data } = await service
      .from("projects")
      .select("slug")
      .eq("id", projectId)
      .maybeSingle<{ slug: string | null }>();
    return data?.slug ?? null;
  } catch {
    return null;
  }
}

/* Where this project's deployment got to, on the project row.
 *
 * `deployment_status` is the DEPLOYMENT's own lifecycle — building, deployed,
 * failed — and it is deliberately a separate column from `status`, which is the
 * build's, and from `published_at`, which is the publication's. Three different
 * facts that were being read off one another before, which is how a project
 * could read Published while its deployment was still compiling.
 *
 * `published_url` is written ONLY on success, and `preview_url` is never
 * touched from here. Those are two addresses for two different things — one
 * private and one public — and overwriting the first with the second is what
 * took people's editing preview away the moment they published.
 *
 * Best effort. A column that cannot be written is a label out of date, not a
 * deployment that did not happen. */
async function noteDeploymentState(
  service: SupabaseClient,
  projectId: string,
  status: "building" | "deployed" | "failed",
  publishedUrl: string | null,
): Promise<void> {
  try {
    await service
      .from("projects")
      .update({
        deployment_status: status,
        ...(publishedUrl ? { published_url: publishedUrl } : {}),
      })
      .eq("id", projectId);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("deployments: the project's deployment state could not be written:", error);
  }
}

/* ── The address on our own domain, bound to the project ──────────────────
 *
 * `<slug>.quickstark.tech`, which is what the customer shows a client — the
 * vercel.app address tells every visitor whose hosting this is.
 *
 * Bound to the PROJECT rather than aliased to this deployment, which is the
 * difference between an address that keeps up and one that quietly does not.
 * An alias points at one build; a project domain follows the newest production
 * deployment on its own, so this never has to run again — and running it again
 * anyway is free, because attachProjectDomain treats a domain it already holds
 * as success rather than as a conflict.
 *
 * Best effort, like the preview alias above it and for the same reason: its
 * failure mode is a plainer address, and the alternative to a plainer address
 * is not a nicer one, it is a customer whose publish failed. */
async function attachAppDomain(
  record: {
    vercelProject: string | null;
  },
  /* The project's own address label, which is what the customer was promised.
   *
   * The Vercel project name carries a disambiguating hash — `luxury-bakery-
   * 038f1129` — because two customers may both call a project the same thing
   * and Vercel's namespace is one account wide. Our namespace is not: a slug
   * is unique across the platform by the index that issues it, so the address
   * can be the clean one. Deriving the domain from the Vercel name instead put
   * the hash in front of the customer, which is the address nobody would put
   * on a business card.
   *
   * Falls back to the Vercel name, so a deployment whose project row cannot be
   * read still gets an address rather than none. */
  slug: string | null,
): Promise<string | null> {
  const creds = vercelCredentials();
  if (!creds || !record.vercelProject) return null;

  const domain = appDomainFor(slug ?? record.vercelProject);
  if (!domain) return null;

  try {
    const bound = await attachProjectDomain(record.vercelProject, domain, creds);
    if (!bound.ok) {
      /* Logged rather than surfaced. Almost always the operator's half of
         this: `*.quickstark.tech` is not a verified domain on the Vercel
         account, or its DNS does not point at Vercel. Nothing the customer
         can act on, and their site is live either way. */
      // eslint-disable-next-line no-console
      console.warn(`deployments: ${domain} could not be bound: ${bound.reason}`);
      return null;
    }

    /* ── Bound is not the same as answering ────────────────────────────
     *
     * Vercel issues the certificate for a newly attached domain itself, and
     * on a verified wildcard it is usually a matter of seconds — but "usually"
     * is not what an address handed to a customer may rest on. A bind that has
     * not finished propagating would put a URL that fails to resolve in front
     * of somebody who just pressed Publish, which is worse than the plainer
     * address in every way.
     *
     * So it is ASKED. When it does not answer yet the vercel.app address is
     * stored, which is correct and works; the next publish binds nothing (the
     * domain is already there), finds it answering, and the address upgrades
     * on its own with nothing to re-run. */
    const answers = await reachable(`https://${domain}`);
    if (!answers.ok) {
      // eslint-disable-next-line no-console
      console.warn(`deployments: ${domain} is bound but does not answer yet: ${answers.reason}`);
      return null;
    }

    return `https://${domain}`;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("deployments: binding the domain failed:", error);
    return null;
  }
}

/* How a repair build says which attempt it is, on the row itself.
 *
 * `repair:<n>:<the build that first failed>` in request_id, so the count
 * survives a worker restart, a redeploy from Vercel's dashboard, and anything
 * else that loses in-memory state — and so the chain can be followed back to
 * the build somebody actually asked for. */
const REPAIR_ID = /^repair:(\d+):([0-9a-f-]+)$/i;
const MAX_REPAIRS = 2;

/**
 * Reads the log, fixes what it can, stores the result and deploys it again.
 *
 * Returns true when a new deployment is on its way, false when this failure is
 * the customer's to hear about. Never throws.
 */
async function repairAndRedeploy(
  service: SupabaseClient,
  record: DeploymentRecord,
  log: string,
): Promise<boolean> {
  if (!record.buildId || !deploymentsConfigured()) return false;

  try {
    const { data: build } = await service
      .from("project_builds")
      .select("id, project_id, user_id, request_id, prompt, html, created_at")
      .eq("id", record.buildId)
      .maybeSingle<{
        id: string;
        project_id: string;
        user_id: string;
        request_id: string | null;
        prompt: string | null;
        html: string | null;
      }>();

    if (!build) return false;

    const chain = REPAIR_ID.exec(build.request_id ?? "");
    const attempt = chain ? Number(chain[1]) : 0;
    const root = chain ? chain[2] : build.id;
    if (attempt >= MAX_REPAIRS) return false;

    const tree = await loadTree(service, build.id);
    if (tree.length === 0) return false;

    const repair = await repairFromLog(log, tree);
    if (!repair.ok) {
      // eslint-disable-next-line no-console
      console.info(`repair: ${build.project_id} left alone — ${repair.reason}`);
      return false;
    }

    /* A NEW build rather than an edit of the failed one, for the same reason
       every other change here is: undo is a version, never an overwrite. The
       failed build stays exactly as it was, with its log on it. */
    const { data: fixed, error: buildError } = await service
      .from("project_builds")
      .insert({
        project_id: build.project_id,
        user_id: build.user_id,
        request_id: `repair:${attempt + 1}:${root}`,
        prompt: build.prompt,
        /* The same summary. It describes the project, and a repair to one file
           does not make it wrong. */
        html: build.html ?? "",
        model: `repair (${repair.how})`,
        files_touched: repair.changed.length,
      })
      .select("id")
      .single<{ id: string }>();

    if (buildError || !fixed) {
      // eslint-disable-next-line no-console
      console.error("repair: the repaired build could not be stored:", buildError);
      return false;
    }

    try {
      await storeTree(
        service,
        { buildId: fixed.id, projectId: build.project_id, userId: build.user_id },
        repair.tree,
      );
    } catch (error) {
      /* A build row claiming files it does not have is worse than no row —
         see the save route, which withdraws it for the same reason. */
      await service.from("project_builds").delete().eq("id", fixed.id);
      // eslint-disable-next-line no-console
      console.error("repair: the repaired files could not be stored:", error);
      return false;
    }

    const backend = await resolveBackend(service, build.project_id);
    const env = backend ? envFor(backend) : null;
    const vercelProject =
      (await existingVercelProject(service, build.project_id)) ??
      deploymentName("app", build.project_id);

    const started = await startDeployment(repair.tree, {
      name: vercelProject,
      supabaseUrl: env?.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: env?.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      supabaseSchema: env?.NEXT_PUBLIC_SUPABASE_SCHEMA,
    });

    if (!started.ok) {
      // eslint-disable-next-line no-console
      console.error(`repair: the repaired build would not upload — ${started.reason}`);
      return false;
    }

    await recordDeployment(service, {
      projectId: build.project_id,
      userId: build.user_id,
      buildId: fixed.id,
      deploymentId: started.deploymentId,
      vercelProject,
      url: started.url,
      inspectUrl: started.inspect,
    });

    await service
      .from("projects")
      .update({ last_build_at: new Date().toISOString() })
      .eq("id", build.project_id);

    /* Said while it is happening rather than afterwards, because the customer
       is very likely watching a deployment they were told was building. One
       sentence, naming what was wrong, and no invitation to do anything: there
       is nothing for them to do. */
    await recordMessage(service, {
      projectId: build.project_id,
      userId: build.user_id,
      role: "system",
      body:
        `The build failed, so I fixed it and started it again — ${repair.note}.` +
        (repair.changed.length > 1 ? ` (${repair.changed.length} files)` : "") +
        `\n\nThis costs nothing. Attempt ${attempt + 1} of ${MAX_REPAIRS}.`,
      kind: "chat",
      dedupeKey: `repaired:${record.deploymentId}`,
    });

    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("repair: the attempt failed:", error);
    return false;
  }
}

/**
 * Asks Vercel how one deployment went, and writes down the answer.
 *
 * Never throws. A deployment still building is not a failure and neither is a
 * Vercel that could not be reached — see DeploymentState, where "unknown" is
 * deliberately not "error": a deployment whose status could not be READ has
 * not failed, and calling it failed would take down a site that is very likely
 * live.
 */
export async function settleOne(
  service: SupabaseClient,
  record: DeploymentRecord,
): Promise<Outcome> {
  const state = await deploymentState(record.deploymentId, record.vercelProject ?? undefined);

  if (state.state === "ready") {
    /* ── The clean address, once there is something behind it ───────────
     *
     * `<slug>.preview.quickstark.tech` rather than somebody else's hosting
     * domain. Assigned HERE and nowhere earlier, because an alias pointed at
     * a build that has not compiled sends the customer's own address at a
     * failure — READY is the first moment it means anything. */
    await attachPreviewAlias(record);

    /* And the published address, on our own domain rather than our host's.
       Beside the alias because both need the same thing to be true — that
       there is a build behind the address — and neither may fail a publish
       that has already succeeded. */
    const own = await attachAppDomain(record, await slugOf(service, record.projectId));

    /* What gets WRITTEN DOWN, which is what every other part of the product
       then shows: the workspace's live frame, the Open link, the row. A
       domain that bound and answers is the address this project has; without
       one, nothing about the stored address changes.

       publicAddress needs no teaching for this. Its existing rule is that a
       stored address which is not a vercel.app is somebody's own domain and
       is left exactly as it is — which is precisely true of this one. */
    const settled = own ? { ...state, url: own } : state;

    await settleDeployment(service, record, settled);
    await settleJob(service, record, settled);
    await noteDeploymentState(service, record.projectId, "deployed", settled.url);

    /* Said where the question was asked. Keyed on the deployment, so two
       callers arriving at once — the cron and the workspace's own poll —
       cannot say it twice. */
    await recordMessage(service, {
      projectId: record.projectId,
      userId: record.userId,
      role: "system",
      body: "Your app is live.",
      links: [
        { label: "Open it", href: settled.url },
        { label: "Preview", href: `${SITE_URL}/preview/${record.projectId}` },
      ],
      kind: "build_ready",
      dedupeKey: `deployed:${record.deploymentId}`,
    });
    return "settled";
  }

  if (state.state === "error" || state.state === "cancelled") {
    /* ── Worth another go? ───────────────────────────────────────────────
     *
     * Only where a second attempt is a genuinely different attempt, which
     * for a deployment it can be: an upload that raced a Vercel incident, a
     * build that ran out of a shared resource. canRetry answers it and stops
     * at MAX_ATTEMPTS, because a job failing the same way three times is not
     * unlucky — it is broken, and retrying it forever spends somebody's
     * Vercel quota to keep reaching the same answer.
     *
     * Deliberately NOT retried: a deployment Vercel refused for a reason in
     * the code. That is what the build log in `reason` is for, and re-running
     * a compile that does not compile is a slower way to print it again. */
    const codeFault = /error TS\d+|Module not found|Cannot find module|Type error|SyntaxError/i.test(
      state.state === "error" ? state.reason : "",
    );

    /* ── One attempt at putting it right, before anybody is told ────────
     *
     * A failed deployment leaves a project that is finished, paid for, stored
     * and not on the internet, and a build log that is evidence rather than an
     * answer. The log names the file and the line; the source is in our own
     * database; nothing was reading one against the other.
     *
     * So it is read. Most of what `next build` refuses in generated code has a
     * deterministic fix that costs nothing — see repairFromLog, which tries
     * that first and only reaches a model for what is left, and then only for
     * the file the log named.
     *
     * FREE. No credits are taken for this and none should be: the customer
     * paid for a build, this is that build not having worked, and charging
     * somebody to fix our own output is charging twice for one thing.
     *
     * Bounded at two, and the bound is the point. A third attempt at a failure
     * two attempts could not fix is not luck running out, it is the wrong tool,
     * and spending a customer's Vercel quota to keep reaching the same answer
     * helps nobody. Past it this behaves exactly as it did before. */
    const repaired = await repairAndRedeploy(service, record, state.reason);
    if (repaired) {
      await settleDeployment(service, record, state);
      return "retried";
    }

    if (!codeFault && record.jobId) {
      const job = await readJob(service, record.jobId);
      if (job && canRetry("deploying", job.attempts)) {
        await settleDeployment(service, record, state);
        await noteAttempt(service, job);
        /* The job stays in `deploying` and the next build of this project
           will redeploy. Nothing is re-uploaded from here: this has a
           deployment id and no files, and inventing a way for it to reach
           them would put the tree behind a cron. The customer's own redeploy
           button is free and does exactly this. */
        return "retried";
      }
    }

    await settleDeployment(service, record, state);
    await settleJob(service, record, state);
    await noteDeploymentState(service, record.projectId, "failed", null);

    await recordMessage(service, {
      projectId: record.projectId,
      userId: record.userId,
      role: "system",
      body: `Your project was built, but putting it online didn't work — ${state.reason}\n\nThe files are saved and nothing was lost. Deploying again costs nothing and doesn't rebuild anything.`,
      tone: "error",
      kind: "build_failed",
      dedupeKey: `deploy-failed:${record.deploymentId}`,
    });
    return "settled";
  }

  return "building";
}
