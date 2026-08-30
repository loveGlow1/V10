import { NextResponse } from "next/server";

import { verifyBuildClaim } from "@/lib/build-signature";
import { GenerationError, generatePage } from "@/lib/generate-page";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { SITE_URL } from "@/lib/site";

/* Where a build is built.
 *
 * The orchestrator's one build step calls this. It generates the page, stores
 * it against the project, and answers with what `Collect WebApp Result` reads:
 * previewUrl, repoUrl and filesTouched.
 *
 * Who may call it: n8n, carrying a signature this app made in /api/build over
 * the three ids it had already checked ownership of. Nothing here trusts the
 * ids on their own — the signature is what makes them addressable, so a caller
 * who learns the URL cannot generate into someone else's project, and cannot
 * spend model credit at all. See src/lib/build-signature.ts.
 *
 * Never returns an `error` key on success: the workflow's Collect node reads
 * `$json.error ? "failed" : "provisioned"`, so that one field is the difference
 * between a green build and a red one. Failures answer with a status instead,
 * which the HTTP node surfaces as an error the branch reports honestly. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Generation is the slow part of the chain, and the chain is bounded: the
   browser's request to /api/build waits on n8n, which waits on this. Sixty
   seconds is the ceiling a Vercel function runs to, and what /api/build's own
   timeout allows. A build that needs longer than this is the signal to move the
   whole flow to an asynchronous one rather than to raise the number. */
export const maxDuration = 60;

type GenerateRequest = {
  requestId?: unknown;
  projectId?: unknown;
  userId?: unknown;
  signature?: unknown;
  prompt?: unknown;
  projectName?: unknown;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ message: "Expected a JSON body." }, { status: 400 });
  }

  const claim = {
    requestId: str(body.requestId),
    projectId: str(body.projectId),
    userId: str(body.userId),
  };

  /* Before anything is read from the database and long before a model is
     called: an unsigned request must not be able to cost money. 401 rather than
     404 — the orchestrator is the only caller, and a misconfigured workflow
     deserves to be told which of the two it is. */
  if (!verifyBuildClaim(claim, body.signature)) {
    return NextResponse.json(
      { message: "This build request is not signed by the app that starts builds." },
      { status: 401 },
    );
  }

  const prompt = str(body.prompt);
  if (!prompt) {
    return NextResponse.json({ message: "A build needs a prompt." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { message: "Building is not connected — SUPABASE_SERVICE_ROLE_KEY is not set." },
      { status: 503 },
    );
  }

  /* The project is read by the signed ids, both of them. The signature already
     proves this pair was checked in /api/build, and matching on user_id as well
     means a signature that somehow named a project the user does not own still
     finds no row — the same belt-and-braces `Sync Project Row` uses, and for the
     same reason: this client bypasses RLS. */
  const { data: project, error: lookupError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", claim.projectId)
    .eq("user_id", claim.userId)
    .maybeSingle();

  if (lookupError) {
    // eslint-disable-next-line no-console
    console.error("generate: could not read the project:", lookupError);
    return NextResponse.json({ message: "Could not read that project." }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ message: "No such project." }, { status: 404 });
  }

  /* The page as it stands, so a second message edits the app rather than
     replacing it. Missing on the first build, which is the case where there is
     nothing to edit. */
  const { data: previous } = await supabase
    .from("project_builds")
    .select("html")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let page;
  try {
    page = await generatePage({
      prompt,
      projectName: str(body.projectName) || project.name,
      previousHtml: previous?.html ?? null,
    });
  } catch (error) {
    if (error instanceof GenerationError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }

  const { error: insertError } = await supabase.from("project_builds").insert({
    project_id: project.id,
    user_id: claim.userId,
    request_id: claim.requestId || null,
    prompt,
    html: page.html,
    model: page.model,
    files_touched: page.filesTouched,
  });

  if (insertError) {
    /* The page exists but nothing can reach it, so this is a failed build
       rather than a partial one. Reported rather than swallowed: a preview
       pointing at a row that was never written is the worse outcome. */
    // eslint-disable-next-line no-console
    console.error("generate: the page was built but could not be saved:", insertError);
    return NextResponse.json(
      { message: "The page was built but could not be saved." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    /* Absolute, and from the configured site URL rather than from this
       request's host: the workspace filters anything that is not an absolute
       http(s) address, and the address has to be the one a person can open. */
    previewUrl: `${SITE_URL}/preview/${project.id}`,
    /* There is no repository yet — a single generated page is not one. Empty
       rather than invented, so the chat offers no link at all instead of a
       broken one. */
    repoUrl: "",
    filesTouched: page.filesTouched,
    model: page.model,
  });
}
