import { NextResponse } from "next/server";

import { CREDIT_ACTIONS, canAfford, creditCostOf } from "@/app/dashboard/credits";
import { EditError, answerQuestion, editPage } from "@/lib/builder/edit";
import { classifyIntent, type Intent } from "@/lib/builder/intent";
import { BuilderError, startBuild, type BuildResult } from "@/lib/n8n";
import { SITE_URL } from "@/lib/site";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

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
 * is stored.
 *
 * It is also where a build is paid for. A build spends real money — an LLM call
 * to classify it, then provisioning — so it cannot be free and it cannot be
 * unbounded. Affordability is checked before the orchestrator is called and the
 * charge is taken after it answers, so a build that never ran is not billed.
 * The cost is priced here from what the build reports, never from anything the
 * caller sends. */

export const runtime = "nodejs";
/* A build is a side effect; it must never be served from a cache. */
export const dynamic = "force-dynamic";
/* The ceiling this waits under. startBuild gives up at 55s so its own message
   reaches the chat before the platform cuts the function off at 60. */
export const maxDuration = 60;

type BuildRequestBody = {
  projectId?: unknown;
  prompt?: unknown;
  requestId?: unknown;
  /* What the composer says this message is, when it says anything. An explicit
     choice always wins over the classifier — the person knows, and the
     classifier is guessing. */
  intentOverride?: unknown;
  /* Set only by the second press of "Replace project". A brand-new build
     discards a page someone has, so it is never done on a guess. */
  confirmNewProject?: unknown;
};

/* An edit is billed as generation, like a build, but priced from how many
   patches actually landed rather than from the size of the page. A one-line
   change costs the floor, which is what it should cost. */
function editUsage(applied: number): { filesTouched: number } {
  return { filesTouched: Math.max(1, applied) };
}

/* Long enough for a real description, short enough that the prompt cannot be
   used to push a large payload through to the orchestrator. */
const MAX_PROMPT = 4000;

/* A ceiling on builds per account per hour. Not a billing control — the credit
   balance is that — but a brake on a loop or a stolen session draining an
   account, and on the provisioning services behind it, faster than anyone
   notices.

   Counted from the ledger rather than from memory: this runs on serverless, so
   a per-instance counter would reset on every cold start and be counted
   separately per concurrent instance. */
const BUILDS_PER_HOUR = 20;

/* What a build is billed as. Generation, because that is what it is: it writes
   files and stands up services. */
const BUILD_ACTION = "generate" as const;

/* How much work the build reported doing. Read from the orchestrator's own
   answer, not from the request body — the caller has every reason to
   understate it and no way to be checked. Anything missing prices at the
   action's floor, which is the honest reading of "it ran but said nothing". */
function usageFrom(result: BuildResult): { filesTouched?: number } {
  const reported = (result.artifacts as { filesTouched?: unknown })?.filesTouched;
  return typeof reported === "number" && Number.isFinite(reported) && reported >= 0
    ? { filesTouched: Math.floor(reported) }
    : {};
}

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

  /* ── What is this message asking for? ───────────────────────────────────
     Every message used to be a build. "Make the header darker", "undo that"
     and "build me a law firm site" all ran the same path, which meant an edit
     cost a full rebuild and a careless sentence could replace someone's work.

     The page as it stands is read first, because it decides almost everything:
     with nothing built there is nothing to edit and nothing to lose, and with
     something built, editing is the default and replacing it needs saying so.

     Read under the caller's own session, so RLS answers for it — a project id
     is not enough to reach someone else's page. */
  const { data: lastBuild } = await supabase
    .from("project_builds")
    .select("id, html")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const currentHtml = (lastBuild?.html as string | undefined) ?? null;

  const override =
    body.intentOverride === "edit" ||
    body.intentOverride === "new_project" ||
    body.intentOverride === "question" ||
    body.intentOverride === "revert"
      ? (body.intentOverride as Intent)
      : null;

  /* A little conversation, so "make it darker too" is read against what came
     before it rather than on its own. */
  const { data: recent } = await supabase
    .from("project_messages")
    .select("role, body")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(6);

  const history = ((recent ?? []) as { role: string; body: string }[])
    .reverse()
    .map((row) => ({ from: row.role, text: row.body }));

  const decision = await classifyIntent({
    message: prompt,
    hasPage: Boolean(currentHtml),
    history,
    override,
  });

  /* Nothing to edit, revert or answer about. Whatever it looked like, the only
     thing that can happen is a first build. */
  const intent: Intent = currentHtml ? decision.intent : "new_project";

  const previewUrl = `${SITE_URL}/preview/${project.id}`;

  /* Writing a build row needs the service key: project_builds is read-only to
     the browser on purpose, so that a client cannot put its own HTML on a
     preview. Ownership was settled above, under the session. */
  const service = createSupabaseServiceClient();

  // ── REVERT ───────────────────────────────────────────────────────────────
  if (intent === "revert") {
    const { data: history2 } = await supabase
      .from("project_builds")
      .select("id, html, prompt")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(2);

    const previous = (history2 ?? [])[1] as { html: string } | undefined;

    if (!previous || !service) {
      return NextResponse.json({
        intent: "revert",
        build: {
          ok: false,
          requestId: "",
          projectId: project.id,
          intent: "webapp",
          status: "Built",
          links: { preview: currentHtml ? previewUrl : "", repo: "", admin: "" },
          configKeys: {},
          artifacts: {},
          message: previous
            ? "That cannot be undone right now."
            : "There is nothing to undo — this is the first version of the page.",
        },
        project: null,
      });
    }

    /* Restored by putting the old page back on top as a new version, never by
       deleting the newer one. Undo should be undoable. */
    await service.from("project_builds").insert({
      project_id: project.id,
      user_id: user.id,
      prompt: `Reverted: ${prompt}`.slice(0, 500),
      html: previous.html,
      model: null,
      files_touched: 0,
    });

    await service
      .from("projects")
      .update({ status: "Built", preview_url: previewUrl, last_build_at: new Date().toISOString() })
      .eq("id", project.id)
      .eq("user_id", user.id);

    const { data: reverted } = await supabase
      .from("projects")
      .select("id, name, status, updated_at, intent, preview_url, repo_url, admin_url, last_build_at")
      .eq("id", project.id)
      .maybeSingle();

    return NextResponse.json({
      intent: "revert",
      build: {
        ok: true,
        requestId: "",
        projectId: project.id,
        intent: "webapp",
        status: "Built",
        links: { preview: previewUrl, repo: "", admin: "" },
        configKeys: {},
        artifacts: {},
        message: "Put the previous version back.",
      },
      project: reverted ?? null,
    });
  }

  // ── QUESTION ─────────────────────────────────────────────────────────────
  if (intent === "question" && currentHtml) {
    try {
      const answer = await answerQuestion(prompt, currentHtml);
      return NextResponse.json({
        intent: "question",
        build: {
          ok: true,
          requestId: "",
          projectId: project.id,
          intent: "webapp",
          status: "Built",
          links: { preview: previewUrl, repo: "", admin: "" },
          configKeys: {},
          artifacts: {},
          message: answer,
        },
        project: null,
      });
    } catch (error) {
      if (error instanceof EditError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

  // ── NEW PROJECT, over something that exists ──────────────────────────────
  if (intent === "new_project" && currentHtml && body.confirmNewProject !== true) {
    /* Nothing has happened yet and nothing will until this comes back
       confirmed. Replacing a page someone spent real time and credits on is
       not a thing to do on a classifier's say-so. */
    return NextResponse.json({
      intent: "new_project",
      needsConfirmation: true,
      build: {
        ok: true,
        requestId: "",
        projectId: project.id,
        intent: "webapp",
        status: "Built",
        links: { preview: previewUrl, repo: "", admin: "" },
        configKeys: {},
        artifacts: {},
        message:
          "That reads like a brand-new build, which would replace the page you have. Do you want to start over, or change the current page?",
      },
      project: null,
    });
  }

  // ── EDIT ─────────────────────────────────────────────────────────────────
  if (intent === "edit" && currentHtml) {
    if (!service) {
      return NextResponse.json(
        { error: "Edits cannot be stored — SUPABASE_SERVICE_ROLE_KEY is not set." },
        { status: 503 },
      );
    }

    let edited;
    try {
      /* Seconds, not minutes: the model returns a handful of search/replace
         blocks rather than the whole document, which is why this can run here
         at all. A full build still goes to the orchestrator below. */
      edited = await editPage(prompt, currentHtml);
    } catch (error) {
      if (error instanceof EditError) {
        /* The page is untouched. Said plainly, and with the prompt left in the
           composer, so it can be rephrased rather than retyped. */
        return NextResponse.json(
          { error: error.message, intent: "edit", code: "edit_failed" },
          { status: error.status },
        );
      }
      throw error;
    }

    await service.from("project_builds").insert({
      project_id: project.id,
      user_id: user.id,
      prompt,
      html: edited.html,
      model: null,
      files_touched: edited.applied,
    });

    await service
      .from("projects")
      .update({
        prompt,
        status: "Built",
        intent: "webapp",
        preview_url: previewUrl,
        last_build_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .eq("user_id", user.id);

    const cost = creditCostOf(BUILD_ACTION, editUsage(edited.applied));
    const { error: chargeError } = await supabase.rpc("spend_credits", {
      p_action: BUILD_ACTION,
      p_cost: cost,
      p_description: `Edit: ${project.name}`.slice(0, 200),
      p_project_id: project.id,
      p_output_tokens: null,
      p_files_touched: edited.applied,
    });
    if (chargeError) {
      // eslint-disable-next-line no-console
      console.error("build: the edit applied but could not be charged:", chargeError);
    }

    const { data: after } = await supabase
      .from("projects")
      .select("id, name, status, updated_at, intent, preview_url, repo_url, admin_url, last_build_at")
      .eq("id", project.id)
      .maybeSingle();

    return NextResponse.json({
      intent: "edit",
      build: {
        ok: true,
        requestId: "",
        projectId: project.id,
        intent: "webapp",
        status: "Built",
        links: { preview: previewUrl, repo: "", admin: "" },
        configKeys: {},
        artifacts: { applied: edited.applied },
        message:
          edited.failures.length > 0
            ? `Done — though ${edited.failures.length} part of that could not be matched in the page.`
            : "Done.",
      },
      project: after ?? null,
    });
  }

  /* How many builds this account has been billed for in the last hour. Only
     charged builds leave a ledger row, so a run of failures is not throttled by
     this — the balance is untouched by those too, and the orchestrator's own
     branches are what fail. It is the successful, expensive path that is
     capped. */
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentBuilds } = await supabase
    .from("credit_ledger")
    .select("id", { count: "exact", head: true })
    .eq("action", BUILD_ACTION)
    .gte("created_at", anHourAgo);

  if ((recentBuilds ?? 0) >= BUILDS_PER_HOUR) {
    return NextResponse.json(
      {
        error: `That is ${BUILDS_PER_HOUR} builds in an hour. Give it a few minutes before the next one.`,
        code: "rate_limited",
      },
      { status: 429 },
    );
  }

  /* Checked before the orchestrator is called: running a build the account
     cannot pay for spends real money to produce a refusal. The floor is used
     because the true cost is not known until the build reports back. */
  const { data: balanceRow } = await supabase
    .from("credit_balances")
    .select("daily, rollover, monthly, top_up")
    .maybeSingle();

  const balance = {
    daily: Number(balanceRow?.daily ?? 0),
    rollover: Number(balanceRow?.rollover ?? 0),
    monthly: Number(balanceRow?.monthly ?? 0),
    topUp: Number(balanceRow?.top_up ?? 0),
  };

  if (balanceRow && !canAfford(balance, CREDIT_ACTIONS[BUILD_ACTION].min)) {
    return NextResponse.json(
      {
        error: "Not enough credits to start a build.",
        code: "insufficient_credits",
      },
      { status: 402 },
    );
  }

  /* Stored before the build runs, so a build that times out on the way back
     still leaves the workspace showing why it is not idle. */
  await supabase
    .from("projects")
    .update({ prompt, status: "Building" })
    .eq("id", project.id);

  const requestId =
    typeof body.requestId === "string" && body.requestId ? body.requestId : crypto.randomUUID();

  /* Only a full build reaches here, and a full build is a fresh page: whatever
     was there is being replaced, deliberately and with the person's say-so, so
     the orchestrator is given nothing to edit. */
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

  /* Billed once the build has actually answered. A failed build is not
     charged: the orchestrator's failure path returns "Failed" without having
     provisioned anything, and billing it would charge for nothing.

     spend_credits does the deduction inside one locked transaction, so two
     builds racing cannot both spend the last credit. A charge that cannot be
     covered is logged rather than raised — the build has already happened, and
     failing the response here would hide a finished build from its owner. */
  if (result.status !== "Failed") {
    const cost = creditCostOf(BUILD_ACTION, usageFrom(result));
    const { error: chargeError } = await supabase.rpc("spend_credits", {
      p_action: BUILD_ACTION,
      p_cost: cost,
      p_description: `Build: ${project.name}`.slice(0, 200),
      p_project_id: project.id,
      p_output_tokens: null,
      p_files_touched: usageFrom(result).filesTouched ?? null,
    });

    if (chargeError) {
      // eslint-disable-next-line no-console
      console.error("build: the build ran but could not be charged:", chargeError);
    }
  }

  /* What the orchestrator persisted, read back rather than assumed. If its
     Supabase step is not connected yet the row still says "Building", and the
     reply says so too instead of promising a row that was never written. */
  const { data: synced } = await supabase
    .from("projects")
    .select("id, name, status, updated_at, intent, preview_url, repo_url, admin_url, last_build_at")
    .eq("id", project.id)
    .maybeSingle();

  return NextResponse.json({ intent: "new_project", build: result, project: synced ?? null });
}
