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

import { resolveBackend } from "@/lib/builder/backend/connection";
import { schemaNameFor } from "@/lib/builder/schema";
import { loadTree } from "@/lib/builder/store-tree";
import { deployProject, deploymentName, deploymentsConfigured } from "@/lib/publish/vercel-deploy";
import { NOT_ALLOWED, canDeploy } from "@/lib/publish/deploy-access";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { ownedProject } from "../backend/owned";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* A Next.js build on Vercel is install, compile and upload. The deploy module
   gives up on its own at three minutes; this is the ceiling for the request
   around it. */
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
  if (!canDeploy(await callerEmail())) {
    return NextResponse.json({ available: false, ready: false, reason: NOT_ALLOWED });
  }
  if (!deploymentsConfigured()) {
    return NextResponse.json({
      available: true,
      ready: false,
      reason:
        "Hosting is not configured: this deployment has no VERCEL_API_TOKEN. " +
        "Add it to the platform's environment variables and redeploy.",
    });
  }
  return NextResponse.json({ available: true, ready: true, reason: null });
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

  const backend = await resolveBackend(service, owned.projectId);

  const deployed = await deployProject(tree, {
    name: deploymentName(project?.name ?? "app", owned.projectId),
    /* The platform's own Supabase address and public key: the same pair every
       generated app is built against, and both are NEXT_PUBLIC_ by nature.
       Nothing server-only is read here — see the note in vercel-deploy.ts
       about what may and may not reach a deployed file. */
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    supabaseSchema: backend?.schema ?? schemaNameFor(owned.projectId),
  });

  /* Recorded either way, and against the build rather than the project: a
     deployment is of a particular set of files, and the next build's outcome
     is its own. */
  await service
    .from("project_builds")
    .update({
      deployment_url: deployed.ok ? deployed.url : null,
      deployment_error: deployed.ok ? null : deployed.reason,
    })
    .eq("id", build.id);

  if (!deployed.ok) {
    return NextResponse.json({ error: deployed.reason, url: null }, { status: 502 });
  }

  return NextResponse.json({ url: deployed.url, buildId: build.id, files: tree.length });
}
