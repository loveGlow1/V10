import { NextResponse } from "next/server";

import { BuilderError, startBuild, type BuildResult } from "@/lib/n8n";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/* Where a build is started.
 *
 * Everything the chat sends goes through here rather than straight to n8n. The
 * webhook URL stays on the server, the caller is identified from their session
 * rather than from the body, and the project is checked to be theirs before a
 * word of it reaches the orchestrator — an n8n webhook has no idea who is
 * calling it, so that check cannot live on the other side.
 *
 * The orchestrator writes the build back to the projects row itself (see
 * n8n/README.md). This route re-reads that row afterwards rather than writing
 * its own copy, so there is one writer and the reply cannot disagree with what
 * is stored. */

export const runtime = "nodejs";
/* A build is a side effect; it must never be served from a cache. */
export const dynamic = "force-dynamic";

type BuildRequestBody = {
  projectId?: unknown;
  prompt?: unknown;
  requestId?: unknown;
};

/* Long enough for a real description, short enough that the prompt cannot be
   used to push a large payload through to the orchestrator. */
const MAX_PROMPT = 4000;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json(
      { error: "Building is unavailable because Supabase is not configured." },
      { status: 503 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to build." }, { status: 401 });
  }

  let body: BuildRequestBody;
  try {
    body = (await request.json()) as BuildRequestBody;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const projectId = typeof body.projectId === "string" ? body.projectId : "";

  if (!prompt) {
    return NextResponse.json({ error: "Describe what you want built." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json(
      { error: `Keep the description under ${MAX_PROMPT} characters.` },
      { status: 400 },
    );
  }
  if (!projectId) {
    return NextResponse.json({ error: "A build needs a project to belong to." }, { status: 400 });
  }

  /* Reads under the caller's own session, so RLS answers this: a project id
     belonging to someone else comes back empty and is refused here, and never
     reaches n8n — which runs with a service key and would happily write it. */
  const { data: project, error: lookupError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();

  if (lookupError) {
    // eslint-disable-next-line no-console
    console.error("build: could not read the project:", lookupError);
    return NextResponse.json({ error: "Could not read that project." }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "That app is not in your account." }, { status: 404 });
  }

  /* Stored before the build runs, so a build that times out on the way back
     still leaves the workspace showing why it is not idle. */
  await supabase
    .from("projects")
    .update({ prompt, status: "Building" })
    .eq("id", project.id);

  const requestId =
    typeof body.requestId === "string" && body.requestId ? body.requestId : crypto.randomUUID();

  let result: BuildResult;
  try {
    result = await startBuild({
      prompt,
      projectName: project.name,
      userId: user.id,
      projectId: project.id,
      requestId,
    });
  } catch (error) {
    if (error instanceof BuilderError) {
      /* The row was moved to Building a moment ago; leaving it there would show
         a build that is not running. */
      await supabase.from("projects").update({ status: "Failed" }).eq("id", project.id);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  /* What the orchestrator persisted, read back rather than assumed. If its
     Supabase step is not connected yet the row still says "Building", and the
     reply says so too instead of promising a row that was never written. */
  const { data: synced } = await supabase
    .from("projects")
    .select("id, name, status, updated_at, intent, preview_url, repo_url, admin_url, last_build_at")
    .eq("id", project.id)
    .maybeSingle();

  return NextResponse.json({ build: result, project: synced ?? null });
}
