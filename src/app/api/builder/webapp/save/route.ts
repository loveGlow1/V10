import { NextResponse } from "next/server";

import { creditCostOf } from "@/app/dashboard/credits";
import { verifyBuildClaim } from "@/lib/build-signature";
import { chargeCredits } from "@/lib/credits-server";
import { PageHtmlError, filesTouchedFor, readGeneratedDocument } from "@/lib/page-html";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { SITE_URL } from "@/lib/site";

/* Where a finished page is put away.
 *
 * The orchestrator generates the page — it can, because an n8n node has no
 * sixty-second ceiling and a Vercel function does — and then posts it here. So
 * this route does no model work at all: it validates, stores, points the
 * project at its new preview, and returns. It runs in well under a second,
 * which is the point.
 *
 * The chat was answered long before this: the workflow replies "Building" as
 * soon as the prompt is classified, and the workspace watches the project row
 * for the preview this writes. Nobody is waiting on this request.
 *
 * It is also where a full build is paid for. /api/build cannot bill one: by the
 * time it answers, the page has not been generated yet, so there is nothing to
 * price it from — it fell back to the floor and every build, however large,
 * cost the same 0.50 as a one-word edit. Here the document exists and can be
 * measured. A build that never arrives is never charged, which is the right
 * answer for a build nobody got.
 *
 * Who may call it: n8n, carrying a signature this app made in /api/build over
 * the three ids it had already checked ownership of. Without it, anyone who
 * learned the URL could put their own HTML on someone else's preview — which,
 * since that HTML is then served to its owner, is the one thing here worth
 * attacking. See src/lib/build-signature.ts. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SaveRequest = {
  requestId?: unknown;
  projectId?: unknown;
  userId?: unknown;
  signature?: unknown;
  prompt?: unknown;
  html?: unknown;
  model?: unknown;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  let body: SaveRequest;
  try {
    body = (await request.json()) as SaveRequest;
  } catch {
    return NextResponse.json({ message: "Expected a JSON body." }, { status: 400 });
  }

  const claim = {
    requestId: str(body.requestId),
    projectId: str(body.projectId),
    userId: str(body.userId),
  };

  if (!verifyBuildClaim(claim, body.signature)) {
    return NextResponse.json(
      { message: "This build is not signed by the app that starts builds." },
      { status: 401 },
    );
  }

  let html: string;
  try {
    html = readGeneratedDocument(body.html);
  } catch (error) {
    if (error instanceof PageHtmlError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { message: "Builds cannot be stored — SUPABASE_SERVICE_ROLE_KEY is not set." },
      { status: 503 },
    );
  }

  /* Both signed ids, as the belt to the signature's braces: this client
     bypasses RLS, so the pair is what keeps a build off the wrong row. */
  const { data: project, error: lookupError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", claim.projectId)
    .eq("user_id", claim.userId)
    .maybeSingle();

  if (lookupError) {
    // eslint-disable-next-line no-console
    console.error("save: could not read the project:", lookupError);
    return NextResponse.json({ message: "Could not read that project." }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ message: "No such project." }, { status: 404 });
  }

  const filesTouched = filesTouchedFor(html);

  const { error: insertError } = await supabase.from("project_builds").insert({
    project_id: project.id,
    user_id: claim.userId,
    request_id: claim.requestId || null,
    prompt: str(body.prompt) || "(no prompt recorded)",
    html,
    model: str(body.model) || null,
    files_touched: filesTouched,
  });

  if (insertError) {
    // eslint-disable-next-line no-console
    console.error("save: the page could not be stored:", insertError);
    return NextResponse.json({ message: "The page could not be stored." }, { status: 500 });
  }

  const previewUrl = `${SITE_URL}/preview/${project.id}`;

  /* The row the workspace is watching. This is the moment the spinner in the
     chat becomes a preview, so it is written here rather than left to a later
     step that might not run: a stored page nothing points at is a build that
     silently did not happen.

     "Built", not "Building": the page exists. Leaving it Building was a real
     bug — the workspace reads that status to decide whether to show a spinner
     or a preview, so a finished app sat under "Building…" forever with its own
     page already stored behind it. Not "Live" either, which means published,
     which this is not. */
  const { error: updateError } = await supabase
    .from("projects")
    .update({
      status: "Built",
      intent: "webapp",
      preview_url: previewUrl,
      last_build_at: new Date().toISOString(),
    })
    .eq("id", project.id)
    .eq("user_id", claim.userId);

  if (updateError) {
    // eslint-disable-next-line no-console
    console.error("save: the page was stored but the project was not updated:", updateError);
    return NextResponse.json(
      { message: "The page was stored but the project could not be updated." },
      { status: 500 },
    );
  }

  /* Priced from the page, and only now that there is a page. filesTouchedFor
     reads the document rather than trusting a field in the request, so a
     workflow anyone with n8n access can edit cannot talk the price down.

     charge_credits rather than spend_credits: the build has happened and the
     model has been paid for, so a refusal here would not undo it — it would
     just leave the work unrecorded and the balance where it was, which is the
     bug this replaces. It takes what the account holds and reports the rest,
     so an overdraft lands at zero and the next build is turned away at the
     door. The result is not returned to n8n: what an account owes is between
     the app and its owner. */
  await chargeCredits(supabase, {
    userId: claim.userId,
    action: "generate",
    cost: creditCostOf("generate", { filesTouched }),
    description: `Build: ${str(body.prompt).slice(0, 60) || "new page"}`,
    projectId: project.id,
    filesTouched,
  });

  return NextResponse.json({ previewUrl, filesTouched });
}
