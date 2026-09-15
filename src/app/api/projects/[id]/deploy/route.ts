/* Making a build that already happened into a running site.
 *
 * Deploying belongs to the build, and for every build from here on it happens
 * there. This exists for the ones that came before it, and for the ones that
 * came after it and could not.
 *
 * Both are the same situation. A project's files are stored against its build
 * (see store-tree.ts), so the source of every project ever generated is still
 * sitting in the database — complete, and never once compiled, because until
 * recently there was nowhere in the system that could. Those builds were paid
 * for. Asking somebody to generate their app a second time, and spend the
 * credits again, so that the new code path can run on it would be charging
 * them for a gap in this repository.
 *
 * So this takes the newest build's stored tree and deploys THAT. No model call,
 * no credits, nothing regenerated: the same files that were already written,
 * built and hosted. It is also the retry — a deployment that failed because
 * the token was missing, or because Vercel refused, becomes a button rather
 * than a rebuild.
 *
 * ── Why it re-reads rather than trusting what it is given ─────────────────
 *
 * The request names a project and nothing else. The build, the files, the
 * schema and the environment are all looked up here from rows this caller has
 * already been shown to own. A route that accepted a tree in its body would be
 * a way to have this deployment's Vercel account host anything at all.
 */

import { NextResponse } from "next/server";

import { envFor, resolveBackend } from "@/lib/builder/backend/connection";
import { blocking, inspectStructure, repairStructure } from "@/lib/builder/next-structure";
import { diagnose, diagnoseFindings } from "@/lib/publish/diagnosis";
import { loadTree } from "@/lib/builder/store-tree";
import { deploymentName, deploymentsConfigured, startDeployment } from "@/lib/publish/vercel-deploy";
import { existingVercelProject, recordDeployment } from "@/lib/publish/deployment-store";
import { NOT_ALLOWED, canDeploy } from "@/lib/publish/deploy-access";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "../backend/owned";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* A Next.js build on Vercel is install, compile and upload. The deploy module
   gives up on its own at three minutes; this is the ceiling for the request
   around it.
   
   READ THIS AS AN ASK, NOT A GUARANTEE. The account this runs on is on Vercel's
   Hobby plan, which caps a function at 60 seconds whatever a route declares —
   so in production this is 60, and a Vercel build that takes longer than that
   will have its deployment created and its URL never recorded, because the
   function polling for it is gone. A build of a small project finishes inside
   the minute and most do. Moving this account to Pro is what makes the number
   below mean what it says. */
export const maxDuration = 300;

/* The signed-in address, for the allowlist. Read from the session rather than
   taken from anywhere the caller controls — an allowlist checked against a
   value the browser supplies is not an allowlist. */
async function callerEmail(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
}

/**
 * Whether the workspace should offer to run this project.
 *
 * The button asks before it draws itself, so somebody outside the rollout is
 * not shown a control whose only possible answer is a refusal. This is a
 * courtesy: POST re-checks everything and is the actual gate.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  /* Two questions, and they are not the same question.
   *
   * WHO MAY USE THIS decides whether the control exists. Outside the rollout
   * there is nothing to show, because there is nothing this person could do.
   *
   * WHETHER IT CAN SUCCEED RIGHT NOW does not. A missing VERCEL_API_TOKEN is a
   * thing the account looking at this button is the one who can fix — and the
   * first version of this hid the button for exactly that case, so the rollout
   * account saw nothing at all and had no way to learn why. Hiding the only
   * place the reason could appear is not a safer failure, it is a silent one.
   * So: allowlisted means the button is drawn, and `ready` and `reason` say
   * what will happen when it is pressed. */
  /* The address this project is already running at, if it is. Answered here
     rather than waiting for somebody to press the button again: a deployment
     that succeeded an hour ago is still live, and the preview should be showing
     it the moment the workspace opens rather than the receipt it replaced. */
  const service = createSupabaseServiceClient();

  /* ── Asked of the project, not of its latest build ─────────────────────
   *
   * This used to read the newest build row and take whatever address was on
   * it. The intent above is right and the query was wrong, because a
   * deployment belongs to the PROJECT: it is a site that is up. The newest
   * build is very often not the one that put it there — an edit that changed
   * source without redeploying, a build that failed, a stage of a longer plan
   * — and every one of those rows carries a null here.
   *
   * So a project that was live went dark in its own workspace because
   * somebody sent it a message. The preview fell back to the stored document,
   * which for a Next.js project is the SUMMARY — the routes, the tables, the
   * files — and the customer was shown a receipt where their application had
   * been, with nothing anywhere saying the site was still up. Nova Estates is
   * exactly this: deployed at 15:50, and two builds later its own workspace
   * could not find it.
   *
   * The newest build that actually HAS an address is the answer. */
  const { data: live } = service
    ? await service
        .from("project_builds")
        .select("id, deployment_url")
        .eq("project_id", owned.projectId)
        .not("deployment_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; deployment_url: string | null }>()
    : { data: null };

  /* The last attempt's reason, read separately and only consulted when there
     is no live address at all — see `failure` below. */
  const { data: latest } = service
    ? await service
        .from("project_builds")
        .select("id, deployment_error")
        .eq("project_id", owned.projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; deployment_error: string | null }>()
    : { data: null };

  const url = live?.deployment_url ?? null;

  /* ── Whether the site at that address is still THIS project ────────────
   *
   * It used to be, always, because every build and every edit deployed. That
   * is no longer true and must not be — building is not publishing — but the
   * workspace frames the live address in preference to everything else, and
   * those two facts together make a trap:
   *
   *   somebody edits their project, the edit is stored, nothing is deployed
   *   because they have not asked for that, and the pane goes on showing the
   *   site as it was BEFORE the edit. The change they just made is invisible,
   *   in the one pane whose whole job is to show them what they have.
   *
   * That is worse than the receipt it replaced. A receipt is unhelpful; this
   * is wrong, confidently, about the thing the customer is looking at.
   *
   * So the live address is reported with whether it is CURRENT — whether the
   * newest build is the one that was deployed. When it is not, the workspace
   * renders the newest source instead and says the site is behind. The address
   * is still handed over either way: the site is still up, it is still theirs,
   * and it is still worth linking to. */
  const current = Boolean(live?.id && latest?.id && live.id === latest.id);
  /* Why the last attempt did not produce one, carried back so the workspace
     can say it on load rather than only in the session where it happened.
     Without this the diagnosis — Deployment Protection, a type error, the tail
     of the build log — existed for as long as the tab stayed open and then
     vanished, leaving somebody with a project that is not hosted and no longer
     any account of why. Never sent alongside a url: a project that is hosted
     is hosted, and last week's failure is not news. */
  const failure = url ? null : (latest?.deployment_error ?? null);

  /* The failure as something a person can read, alongside the raw text rather
     than instead of it. The workspace shows the summary and keeps the log in
     the panel behind it — see lib/publish/diagnosis.ts, and §6 of the
     specification this implements: a build log is evidence, not an answer. */
  const diagnosis = diagnose(failure);

  if (!canDeploy(await callerEmail())) {
    /* Still handed over. Whether somebody may CREATE a deployment and whether
       they may SEE the one their own project already has are different
       questions, and ownership was settled above. */
    return NextResponse.json({ available: false, ready: false, url, current, failure, diagnosis, reason: NOT_ALLOWED });
  }
  if (!deploymentsConfigured()) {
    return NextResponse.json({
      available: true,
      ready: false,
      url,
      current,
      failure,
      diagnosis,
      reason:
        "Hosting is not configured: this deployment has no VERCEL_API_TOKEN. " +
        "Add it to the platform's environment variables and redeploy.",
    });
  }
  return NextResponse.json({ available: true, ready: true, url, current, failure, diagnosis, reason: null });
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const owned = await ownedProject(id);
  if ("error" in owned) return owned.error;

  /* Before anything is read and long before anything is uploaded. */
  if (!canDeploy(await callerEmail())) {
    return NextResponse.json({ error: NOT_ALLOWED }, { status: 403 });
  }

  if (!deploymentsConfigured()) {
    /* Named exactly, because the person reading this is the person who can fix
       it. "Hosting is unavailable" would send them to support for a missing
       environment variable. */
    return NextResponse.json(
      {
        error:
          "This deployment has no VERCEL_API_TOKEN, so it cannot host projects. " +
          "Add it to the platform's environment and redeploy, then try again.",
      },
      { status: 503 },
    );
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return NextResponse.json({ error: "This deployment cannot read builds." }, { status: 503 });
  }

  /* The title, for the Vercel project's name. Read with the service client
     against an id whose ownership is already settled — the same arrangement
     every other route here uses. */
  const { data: project } = await service
    .from("projects")
    .select("name")
    .eq("id", owned.projectId)
    .maybeSingle<{ name: string | null }>();

  const { data: build } = await service
    .from("project_builds")
    .select("id, deployment_url")
    .eq("project_id", owned.projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; deployment_url: string | null }>();

  if (!build) {
    return NextResponse.json(
      { error: "This project hasn't been built yet, so there is nothing to deploy." },
      { status: 409 },
    );
  }

  const tree = await loadTree(service, build.id);

  /* An empty tree is a single-page build, which is already viewable and
     already publishable through the ordinary route. Deploying it to Vercel
     would be a slower way to get the same page. */
  if (tree.length === 0) {
    return NextResponse.json(
      {
        error:
          "This build is a single page rather than a project, so it is already " +
          "live in your preview — there are no files to compile.",
      },
      { status: 409 },
    );
  }

  /* ── Checked before it is uploaded ─────────────────────────────────────
   *
   * `next build` is the strictest reader this source meets, and it used to be
   * the first: a project went from the database to Vercel, and what came back
   * two minutes later was a build log with a type error in the middle of it.
   * The customer paid for the wait and was handed the framework's own wording.
   *
   * Every rule in next-structure.ts is one that build enforces, so anything
   * blocking here is a deployment that WILL fail. Refusing it costs seconds and
   * saves minutes, and — this is the part that matters — the answer comes back
   * as findings a person can read rather than as a log they cannot.
   *
   * Advisory findings are not a refusal. A validator that would not let
   * somebody publish a project that builds, because it suspects something, is
   * the failure this codebase has had twice already. */
  /* ── Repaired on the way out, for the builds that predate the repair ───
   *
   * completeTree fixes this class of defect when a project is generated, so
   * anything built from now on arrives here already correct. Every project
   * built BEFORE that is still sitting in the database with the defect in it,
   * and those are exactly the projects this route exists for — see the header:
   * it is the way a build that was paid for and never compiled becomes a
   * running site.
   *
   * Without this, the "Fix automatically" control the workspace offers against
   * a past failure would re-upload the same broken tree and fail in precisely
   * the same way. A button that promises a fix and reproduces the failure is
   * worse than no button.
   *
   * In memory, not written back. Rewriting the stored files of a historical
   * build is a bigger claim than this route is entitled to make, and the
   * repair is deterministic — it produces the same tree every time it runs, so
   * there is nothing gained by persisting it and a customer's stored history
   * is left as it was. */
  const { tree: sound, repairs } = repairStructure(tree);

  const findings = inspectStructure(sound);
  const stopping = blocking(findings);
  if (stopping.length > 0) {
    return NextResponse.json(
      {
        error: "This project needs attention before it can go live.",
        diagnosis: diagnoseFindings(stopping),
        /* Structured, so the workspace renders the human sentences and keeps
           the framework's wording in the technical panel behind them. */
        findings: stopping.map((finding) => ({
          file: finding.file,
          problem: finding.problem,
          detail: finding.detail,
          repairable: finding.repairable,
        })),
        url: null,
      },
      { status: 422 },
    );
  }

  /* ── Whose database this app talks to ──────────────────────────────────
   *
   * THIS PROJECT'S backend, resolved from project_backends — never the
   * platform's own environment, which is what these three lines used to read.
   * The schema came from the project and the URL and key came from
   * process.env, so a redeploy of a project linked to its owner's Supabase
   * sent them QuickStark's address and QuickStark's anon key.
   *
   * Null is a real answer and not a failure: a project with no database layer
   * has no Supabase client in its tree, so no .env.production is written for
   * it at all. See deploymentFiles. */
  const backend = await resolveBackend(service, owned.projectId);
  const env = backend ? envFor(backend) : null;

  /* The Vercel project this one already deploys to, read rather than derived.
     deploymentName folds in the project's TITLE, so a rename used to create a
     second Vercel project and leave the first orphaned and still serving. */
  const vercelProject =
    (await existingVercelProject(service, owned.projectId)) ??
    deploymentName(project?.name ?? "app", owned.projectId);

  /* Started, not waited for — see the note in vercel-deploy.ts. This route asks
     for 300 seconds and gets 60, and a Next.js build takes longer than either
     with any regularity, so waiting here was how a deployment came to be
     created successfully and then lost. The address comes back from the upload
     itself; whether the build SUCCEEDS is settled by /api/cron/deployments. */
  const started = await startDeployment(sound, {
    name: vercelProject,
    supabaseUrl: env?.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env?.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseSchema: env?.NEXT_PUBLIC_SUPABASE_SCHEMA,
  });

  if (!started.ok) {
    await service
      .from("project_builds")
      .update({ deployment_url: null, deployment_error: started.reason })
      .eq("id", build.id);
    return NextResponse.json(
      { error: started.reason, diagnosis: diagnose(started.reason), url: null },
      { status: 502 },
    );
  }

  await recordDeployment(service, {
    projectId: owned.projectId,
    userId: owned.userId,
    buildId: build.id,
    deploymentId: started.deploymentId,
    vercelProject,
    url: started.url,
    inspectUrl: started.inspect,
  });

  /* The address, written where the rest of the app reads it.
   *
   * It was not, and only this path skipped it: the save route writes
   * deployment_url on the build row the moment Vercel accepts an upload, and
   * the deploy button deferred entirely to settleDeployment in the cron. So
   * pressing Deploy produced an address that lived in one fetch response and
   * was gone on reload — the workspace asked the build row, found nothing, and
   * went back to showing the summary as though nothing had been deployed.
   *
   * The failure is cleared with it. A row carrying last week's reason beside
   * this week's address would report a project as unhosted while it is
   * hosted. settleDeployment still owns the outcome and will null this again
   * if the build turns out to have failed. */
  await service
    .from("project_builds")
    .update({ deployment_url: started.url, deployment_error: null })
    .eq("id", build.id);

  /* `building: true` rather than a bare URL, because the difference is now
     real: the address exists and the site behind it does not yet. A caller that
     showed this as "live" would be making the same promise the old blocking
     version at least waited to keep. */
  return NextResponse.json({
    url: started.url,
    building: true,
    deploymentId: started.deploymentId,
    buildId: build.id,
    files: sound.length,
    /* What had to be put right on the way out, when anything did. Reported
       rather than done quietly: the customer's stored files still hold the
       defect, and somebody who downloads this project should be told why their
       copy differs from the one that is running. */
    repaired: repairs.map((repair) => repair.what),
  });
}
