import { NextResponse } from "next/server";

import { CREDIT_ACTIONS, canAfford, creditCostOf, formatCredits } from "@/app/dashboard/credits";
import { attachmentBlocks, attachmentText, loadAttachments, signedImageUrls } from "@/lib/builder/attachments";
import { carryBrief, priorTurns } from "@/lib/builder/brief";
import { EDIT_MODEL, EditError, answerQuestion, askClarifying, editPage } from "@/lib/builder/edit";
import { classifyIntent, type Intent } from "@/lib/builder/intent";
import { stepRecorder } from "@/lib/builder/steps";
import { BuilderError, startBuild, type BuildResult } from "@/lib/n8n";
import { SITE_URL } from "@/lib/site";
import { chargeCredits, currentBalance } from "@/lib/credits-server";
import { recordAndConfirm, recordMessage } from "@/lib/thread-server";
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
  /* Files uploaded with this message: a screenshot to match, a logo to use, a
     page of copy to lay out. Ids only — the bytes are read on the server. */
  attachmentIds?: unknown;
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

/* How each intent is named in the step list. The raw values are keys. */
const INTENT_WORDS: Record<string, string> = {
  edit: "an edit to the page",
  new_project: "a new page",
  question: "a question about the page",
  revert: "an undo",
  clarify: "needing one more detail",
};

/* What must be in the pool before anything is allowed to run.
 *
 * Two figures, because two very different things happen here. An edit is one
 * short model call and prices between the floor and about a credit, so the
 * floor is a fair thing to ask for up front. A full build is minutes of
 * generation and prices up to the ceiling, and letting someone start one on
 * 0.60 credits is how an account ends up owing more than it ever held.
 *
 * Neither is a reservation — the charge is taken afterwards, from what the work
 * actually did. They are the door: below the floor, nothing runs at all. */
const ENTRY_COST = CREDIT_ACTIONS.generate.min;
const FULL_BUILD_ENTRY_COST = CREDIT_ACTIONS.generate.max;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json(
      { error: "I can't build anything yet — this workspace has no Supabase configured." },
      { status: 503 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "You'll need to sign in before I can build." }, { status: 401 });
  }

  let body: BuildRequestBody;
  try {
    body = (await request.json()) as BuildRequestBody;
  } catch {
    return NextResponse.json({ error: "That message didn't arrive in a form I could read. Try sending it again." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const projectId = typeof body.projectId === "string" ? body.projectId : "";

  if (!prompt) {
    return NextResponse.json({ error: "Tell me what you'd like and I'll get started." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json(
      { error: `That's longer than I can take in one message — keep it under ${MAX_PROMPT} characters and send it again.` },
      { status: 400 },
    );
  }
  if (!projectId) {
    return NextResponse.json({ error: "I don't know which app that belongs to. Open one and try again." }, { status: 400 });
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
    return NextResponse.json({ error: "I couldn't read that app just now. Try again in a moment." }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "That app isn't in your account, so I can't open it." }, { status: 404 });
  }

  /* Writing a build row, and taking payment for one, both need the service key:
     project_builds and credit_balances are read-only to the browser on purpose,
     so that a client can neither put its own HTML on a preview nor decide what
     it owes. Ownership was settled just above, under the caller's session. */
  const service = createSupabaseServiceClient();

  /* ── Can this account pay for anything at all? ──────────────────────────
     Before the classifier, not after it. Classifying is itself a model call,
     and so is every branch below it: an empty account that gets as far as here
     has already been given work for free.

     Read through ensure_credit_balance rather than straight off the table, so
     that today's refill has landed and an account that has never been charged
     is not read as having nothing. */
  const balance = service ? await currentBalance(service, user.id) : null;

  if (balance && !canAfford(balance, ENTRY_COST)) {
    return NextResponse.json(
      {
        error: `Out of credits — ${formatCredits(ENTRY_COST)} is the least a change costs. Top up to keep building.`,
        code: "insufficient_credits",
      },
      { status: 402 },
    );
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

  /* The conversation so far, which is what makes this a session rather than a
     sequence of unrelated requests. It decides three things now, not one: how
     the classifier reads the message, what the model is told came before it,
     and — for a message like "rebuild", which describes nothing — what is
     actually built. See builder/brief.ts.

     Read before this message is stored, so the message is never in its own
     history. */
  const { data: recent } = await supabase
    .from("project_messages")
    .select("role, body")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const history = ((recent ?? []) as { role: string; body: string }[])
    .reverse()
    .map((row) => ({ from: row.role, text: row.body }));

  /* The classifier keeps the slice it was tuned and tested against. Widening
     what it sees is a change to how every message is read, and this is not the
     change that should make it. */
  const classifierHistory = history.slice(-6);

  /* The same conversation in the shape a model call takes. */
  const prior = priorTurns(history);

  /* Whatever was attached to this message, resolved to rows the server can
     read. Restricted to this project and this owner: the ids came from the
     caller, and the read behind them uses the service key. */
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? (body.attachmentIds.filter((id) => typeof id === "string") as string[])
    : [];
  /* From here on, every operation is recorded with what it cost and what it
     produced. The reply carries the list, and the workspace draws it — which
     is the difference between a panel that names the work and one that only
     names the wait. */
  const steps = stepRecorder();

  const attachments = await loadAttachments(attachmentIds, project.id, user.id);
  if (attachments.length > 0) {
    steps.mark(
      "attachments",
      `Read ${attachments.length} ${attachments.length === 1 ? "attachment" : "attachments"}`,
    );
  }

  /* One id for everything this message does, settled here rather than at the
     build below: it is what makes each row this request writes safe to write
     twice. A retried request, or the same message sent from two tabs, writes
     the same message once. */
  const requestId =
    typeof body.requestId === "string" && body.requestId ? body.requestId : crypto.randomUUID();

  /* ── The message goes into the thread before anything is done with it ────
     The browser used to be the only thing that wrote a thread: it rendered a
     message and inserted a row, without awaiting it. So a tab closed mid-build
     wrote nothing, and the conversation it left behind had a hole in it exactly
     where the answer should have been — which is also the context the next
     message is read against.

     Written here instead, with the file names the panel shows, so the record is
     the same whether or not anyone is still looking at it. */
  const spoken =
    attachments.length > 0
      ? `${prompt}\n\n(${attachments.map((file) => file.name).join(", ")})`
      : prompt;

  if (service) {
    await recordMessage(service, {
      projectId: project.id,
      userId: user.id,
      role: "you",
      body: spoken,
      dedupeKey: `you:${requestId}`,
    });
  }

  /* What this route says back, stored before it is charged for.
     Returns false only when the row genuinely could not be written — and then
     nothing is billed, because an answer nobody can read is not one that was
     delivered. */
  async function deliver(
    text: string,
    options: {
      kind?: "chat" | "build_started" | "build_ready" | "build_failed";
      tone?: "normal" | "error";
      links?: { label: string; href: string }[];
      key: string;
    },
  ): Promise<boolean> {
    /* No service key means nothing here can write to the thread at all. Said
       plainly rather than assumed: the answer goes back to the panel, which
       stores it the old way, and the charge below is skipped anyway because
       charging needs the same key. */
    if (!service) return false;
    return recordAndConfirm(service, {
      projectId: project!.id,
      userId: user!.id,
      role: "system",
      body: text,
      tone: options.tone,
      links: options.links,
      kind: options.kind ?? "chat",
      dedupeKey: `${options.key}:${requestId}`,
    });
  }

  const decision = await classifyIntent({
    message: prompt,
    hasPage: Boolean(currentHtml),
    history: classifierHistory,
    override,
  });

  /* Nothing to edit, revert or answer about. Whatever it looked like, the only
     thing that can happen is a first build. */
  const intent: Intent = currentHtml ? decision.intent : "new_project";

  /* How the reading was reached, not just what it was. "heuristic" means the
     free pass settled it and no model was called at all, which is worth being
     able to see — it is the difference between an instant answer and a
     round trip, and between a message that was understood and one that was
     guessed at. */
  steps.mark(
    "intent",
    `Read the message as ${INTENT_WORDS[intent] ?? intent}`,
    decision.source === "heuristic"
      ? "rules only, no model call"
      : decision.source === "override"
        ? "you chose this mode"
        : `claude-haiku-4-5, confidence ${decision.confidence.toFixed(2)}`,
  );

  const previewUrl = `${SITE_URL}/preview/${project.id}`;

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
      const message = previous
        ? "That cannot be undone right now."
        : "There is nothing to undo — this is the first version of the page.";
      const stored = await deliver(message, { key: "revert-none" });
      return NextResponse.json({
        stored,
        steps: steps.list(),
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
          message,
        },
        project: null,
      });
    }

    /* Restored by putting the old page back on top as a new version, never by
       deleting the newer one. Undo should be undoable. */
    steps.mark("history", "Read the last two versions");
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

    steps.mark("restore", "Put the previous version back on top");

    const storedRevert = await deliver("Put the previous version back.", { key: "revert" });

    const { data: reverted } = await supabase
      .from("projects")
      .select("id, name, status, updated_at, intent, preview_url, repo_url, admin_url, last_build_at")
      .eq("id", project.id)
      .maybeSingle();

    return NextResponse.json({
      stored: storedRevert,
      steps: steps.list(),
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

  // ── CLARIFY ──────────────────────────────────────────────────────────────
  /* A change was asked for, but the message names nothing to change. Answered
     with one question rather than a guess: guessing produced either an edit
     nobody asked for or "that could not be applied cleanly", and both cost a
     round trip to discover anyway.

     Nothing is written and no build is started, so the page is untouched — this
     branch is a sentence, and it is placed above the others because it must not
     fall through into one that edits. */
  if (intent === "clarify" && currentHtml) {
    try {
      const question = await askClarifying(prompt, currentHtml, await attachmentBlocks(attachments), prior);
      steps.mark(
        "clarify",
        "Wrote one question back",
        `${EDIT_MODEL}, ${question.outputTokens} output tokens`,
      );

      /* Stored before it is billed. A question that never reached anyone is
         not a question that was asked, and the ledger should not say it was. */
      const delivered = await deliver(question.text, { key: "clarify" });

      /* Billed as chat, like a question, because that is what it is: one short
         model call with the page in it. Charging a build rate for a sentence
         that changed nothing would be charging for the classifier's caution. */
      if (service && delivered) {
        await chargeCredits(service, {
          userId: user.id,
          action: "chat",
          cost: creditCostOf("chat", { outputTokens: question.outputTokens }),
          description: `Clarify: ${project.name}`,
          projectId: project.id,
          outputTokens: question.outputTokens,
        });
      }

      return NextResponse.json({
        stored: delivered,
        steps: steps.list(),
        intent: "clarify",
        build: {
          ok: true,
          requestId: "",
          projectId: project.id,
          intent: "webapp",
          status: "Built",
          links: { preview: previewUrl, repo: "", admin: "" },
          configKeys: {},
          artifacts: {},
          message: question.text,
        },
        project: null,
      });
    } catch (error) {
      /* A clarifier that cannot run must not block the message. Falling through
         to the edit path below is the old behaviour, which was survivable — an
         unanswerable question is not. */
      if (!(error instanceof EditError)) throw error;
    }
  }

  // ── QUESTION ─────────────────────────────────────────────────────────────
  if (intent === "question" && currentHtml) {
    try {
      const answer = await answerQuestion(prompt, currentHtml, await attachmentBlocks(attachments), prior);
      steps.mark(
        "answer",
        "Answered from the page",
        `${EDIT_MODEL}, ${answer.outputTokens} output tokens`,
      );

      const delivered = await deliver(answer.text, { key: "answer" });

      /* Billed as chat, on what it said. Asking about a page is a model call
         with the whole page in it, so it is not free — but the chat band starts
         at zero and reaches one credit only at a full page of answer, which is
         what keeps troubleshooting from feeling metered. */
      if (service && delivered) {
        await chargeCredits(service, {
          userId: user.id,
          action: "chat",
          cost: creditCostOf("chat", { outputTokens: answer.outputTokens }),
          description: `Question: ${project.name}`,
          projectId: project.id,
          outputTokens: answer.outputTokens,
        });
      }

      return NextResponse.json({
        stored: delivered,
        steps: steps.list(),
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
          message: answer.text,
        },
        project: null,
      });
    } catch (error) {
      if (error instanceof EditError) {
        const stored = await deliver(error.message, { tone: "error", key: "answer-failed" });
        return NextResponse.json({ error: error.message, stored }, { status: error.status });
      }
      throw error;
    }
  }

  // ── NEW PROJECT, over something that exists ──────────────────────────────
  if (intent === "new_project" && currentHtml && body.confirmNewProject !== true) {
    /* Nothing has happened yet and nothing will until this comes back
       confirmed. Replacing a page someone spent real time and credits on is
       not a thing to do on a classifier's say-so. */
    const asked =
      "That reads like a brand-new build, which would replace the page you have. Do you want to start over, or change the current page?";
    const stored = await deliver(asked, { key: "confirm" });
    return NextResponse.json({
      stored,
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
        message: asked,
      },
      project: null,
    });
  }

  // ── EDIT ─────────────────────────────────────────────────────────────────
  if (intent === "edit" && currentHtml) {
    if (!service) {
      return NextResponse.json(
        { error: "I can make the edit but not save it — this workspace has no SUPABASE_SERVICE_ROLE_KEY set." },
        { status: 503 },
      );
    }

    let edited;
    try {
      /* Seconds, not minutes: the model returns a handful of search/replace
         blocks rather than the whole document, which is why this can run here
         at all. A full build still goes to the orchestrator below. */
      edited = await editPage(prompt, currentHtml, await attachmentBlocks(attachments), prior);
      steps.mark(
        "edit",
        edited.failures.length > 0
          ? `Applied ${edited.applied} of ${edited.applied + edited.failures.length} changes`
          : `Applied ${edited.applied} ${edited.applied === 1 ? "change" : "changes"}`,
        `${EDIT_MODEL}, ${edited.outputTokens} output tokens${edited.retried ? ", retried once" : ""}`,
      );
    } catch (error) {
      if (error instanceof EditError) {
        /* The page is untouched. Said plainly, and with the prompt left in the
           composer, so it can be rephrased rather than retyped. */
        const stored = await deliver(error.message, { tone: "error", key: "edit-failed" });
        return NextResponse.json(
          { error: error.message, intent: "edit", code: "edit_failed", stored },
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
    steps.mark("version", "Saved a new version of the page");

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

    /* The reply, composed here rather than in the response body, because it
       goes into the thread before it goes into the ledger: the edit is in the
       page, and the sentence saying so must survive the tab that asked for it. */
    const said = [
      edited.failures.length > 0
        ? `Done — though ${edited.failures.length} part of that could not be matched in the page.`
        : "Done.",
      /* The model's own next step, when it had one. It came back on the
         edit call, so it costs nothing extra and it is about the page as it
         now stands rather than as it was. */
      edited.note ? `Next: ${edited.note}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    const storedEdit = await deliver(said, { key: "edit" });

    /* Charged, not attempted. The edit is already in the page — refusing the
       charge now would not take it back, it would only leave the work unpaid
       and the balance unchanged, which is precisely how an account came to sit
       at 0.50 forever while the edits kept arriving. charge_credits takes what
       is there and reports what it could not, so an account that overdraws
       lands at zero and the gate above turns the next one away. */
    const charge = await chargeCredits(service, {
      userId: user.id,
      action: BUILD_ACTION,
      cost: creditCostOf(BUILD_ACTION, editUsage(edited.applied)),
      description: `Edit: ${project.name}`,
      projectId: project.id,
      filesTouched: edited.applied,
    });

    if (charge) {
      steps.mark("charge", `Charged ${formatCredits(charge.charged)} credits`);
    }

    const { data: after } = await supabase
      .from("projects")
      .select("id, name, status, updated_at, intent, preview_url, repo_url, admin_url, last_build_at")
      .eq("id", project.id)
      .maybeSingle();

    return NextResponse.json({
      stored: storedEdit,
      steps: steps.list(),
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
        /* Said to the screen rather than written to the thread: running out
           mid-sentence is a worse surprise than being told, but next week's
           reader of this conversation does not need to know what the balance
           was on the day. */
        message:
          charge && charge.remaining <= 0
            ? `${said} That used the last of your credits. Top up to keep building.`
            : said,
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
    const said = `That's ${BUILDS_PER_HOUR} builds inside an hour, which is the limit here. Give it a few minutes and I'll carry on.`;
    /* Stored, though nothing was charged for it. The message that asked is
       already in the thread, and a question with no answer under it is exactly
       the hole this whole change is about. */
    const stored = await deliver(said, { tone: "error", key: "rate-limited" });
    return NextResponse.json({ error: said, code: "rate_limited", stored }, { status: 429 });
  }

  /* Checked again, and against a bigger number than the door upstairs.
     Building a whole page is minutes of generation and prices anywhere up to
     the ceiling of the band, so what has to be in the pool is the ceiling —
     not the floor, which was the old check and which let an account start a
     2.50 build holding 0.50.

     Read fresh rather than reusing the balance from the top of the request: an
     edit or another build may have been charged in between. */
  const beforeBuild = service ? await currentBalance(service, user.id) : null;

  if (beforeBuild && !canAfford(beforeBuild, FULL_BUILD_ENTRY_COST)) {
    const said = `A full build costs up to ${formatCredits(FULL_BUILD_ENTRY_COST)} credits and you have ${formatCredits(
      beforeBuild.daily + beforeBuild.rollover + beforeBuild.monthly + beforeBuild.topUp,
    )}. Ask for a change to the page instead — an edit costs far less — or top up.`;
    const stored = await deliver(said, { tone: "error", key: "no-credits" });
    return NextResponse.json({ error: said, code: "insufficient_credits", stored }, { status: 402 });
  }

  /* ── What is actually being built ────────────────────────────────────────
     "Rebuild" is a real thing people type, and on its own it describes nothing.
     It used to be handed to the orchestrator as the design brief, which built
     what you would expect from the word "rebuild" — and told someone who had
     described an e-commerce store two messages earlier that it had forgotten.

     So a message that only asks for the last thing again carries the last thing
     with it. A message that describes something is passed through exactly as
     typed, which is every other message. See builder/brief.ts. */
  const brief = carryBrief(prompt, history);

  if (brief.carried) {
    steps.mark(
      "brief",
      "Carried your earlier description forward",
      `"${brief.carried.slice(0, 60)}${brief.carried.length > 60 ? "…" : ""}"`,
    );
  }

  /* Stored before the build runs, so a build that times out on the way back
     still leaves the workspace showing why it is not idle. The brief is stored
     rather than the message, so the row says what was built rather than the
     word that asked for it again. */
  await supabase
    .from("projects")
    .update({ prompt: brief.text, status: "Building" })
    .eq("id", project.id);

  /* Only a full build reaches here, and a full build is a fresh page: whatever
     was there is being replaced, deliberately and with the person's say-so, so
     the orchestrator is given nothing to edit. */
  let result: BuildResult;
  try {
    steps.running("orchestrator", "Generating the page", "handed to the build orchestrator");
    result = await startBuild({
      prompt: brief.text,
      projectName: project.name,
      userId: user.id,
      projectId: project.id,
      requestId,
      /* What was attached, in the two forms a workflow can carry: signed
         addresses for images, and text already read for everything else. */
      attachmentUrls: await signedImageUrls(attachments),
      attachmentText: await attachmentText(attachments),
    });
  } catch (error) {
    if (error instanceof BuilderError) {
      /* The row was moved to Building a moment ago; leaving it there would show
         a build that is not running. */
      await supabase.from("projects").update({ status: "Failed" }).eq("id", project.id);
      /* Stored as well as returned. This one matters on reopening: without it a
         workspace whose tab was closed on a failed start shows a build that
         never finishes and never explains itself. */
      const stored = await deliver(error.message, {
        kind: "build_failed",
        tone: "error",
        key: "build-failed",
      });
      return NextResponse.json({ error: error.message, stored }, { status: error.status });
    }
    throw error;
  }

  /* Deliberately not charged here.
   *
   * This used to bill the build the moment the orchestrator answered — but
   * since generation moved into n8n, all it answers with is "Building". The
   * page does not exist yet, so there is nothing to price it from, and
   * creditCostOf fell back to the floor: every full build, however large, cost
   * 0.50. A whole generated dashboard priced the same as a one-word edit.
   *
   * The page arrives at /api/builder/webapp/save a few minutes later, and that
   * is where the charge is taken now — from the document itself, counted by
   * filesTouchedFor, which is a number the workflow cannot inflate because the
   * app derives it rather than reading it. It also means a build that never
   * finishes is never billed, which is the right answer for a build nobody
   * got. */

  /* The build is running and the thread says so — from here, not from the
     browser. It is what a session reopened five minutes later reads to know
     there is something still in flight to pick back up. */
  const storedBuild = await deliver(result.message, { kind: "build_started", key: "build" });

  /* What the orchestrator persisted, read back rather than assumed. If its
     Supabase step is not connected yet the row still says "Building", and the
     reply says so too instead of promising a row that was never written. */
  const { data: synced } = await supabase
    .from("projects")
    .select("id, name, status, updated_at, intent, preview_url, repo_url, admin_url, last_build_at")
    .eq("id", project.id)
    .maybeSingle();

  return NextResponse.json({
    stored: storedBuild,
    steps: steps.list(),
    intent: "new_project",
    build: result,
    project: synced ?? null,
  });
}
