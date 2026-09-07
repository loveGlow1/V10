import { NextResponse } from "next/server";

import {
  CREDIT_ACTIONS,
  PLANS,
  affordableModels,
  buildDoorFor,
  canAfford,
  cannotAffordBuildMessage,
  contextSurcharge,
  creditCostOf,
  roundCredits,
  downgradedModelMessage,
  formatCredits,
  modelAllowedOnPlan,
  modelsForPlan,
  planRequiredFor,
  resolveBuildModel,
} from "@/app/dashboard/credits";
import {
  attachmentBlocks,
  attachmentText,
  imagePlacements,
  loadAttachments,
  placeAttachments,
  signedImageUrls,
} from "@/lib/builder/attachments";
import { readPage, regressions } from "@/lib/builder/brain";
import { carryBrief, conversational, countWords, priorTurns } from "@/lib/builder/brief";
import { previewUrl as publishPreviewUrl } from "@/lib/publish/naming";
import { reserveSlug } from "@/lib/publish/reserve";
import { wantsDownload } from "@/lib/builder/download";
import {
  EDIT_MODEL,
  EditError,
  answerQuestion,
  askClarifying,
  editModelFor,
  editPage,
  maxEditPromptChars,
  type OnProgress,
} from "@/lib/builder/edit";
import { intakeAttachments } from "@/lib/builder/assets/asset-intake";
import { planAssets } from "@/lib/builder/assets/asset-planner";
import { resolveAssets } from "@/lib/builder/assets/asset-resolver";
import { loadAssets, recordAsset } from "@/lib/builder/assets/asset-storage";
import { usableProviders } from "@/lib/builder/assets/providers/registry";
import { composeBuildPrompt } from "@/lib/builder/blueprints";
import { treeBrief } from "@/lib/builder/scaffold";
import { type Stack, decideStack, stackOptions, stackQuestion } from "@/lib/builder/stack";
import { classifyKind } from "@/lib/builder/classify-kind";
import { classifyIntent, type Intent,
  remainderAfterRevert,
} from "@/lib/builder/intent";
import {
  bestKindGuess,
  BUILD_KINDS,
  heuristicKind,
  isBuildKind,
  KIND_BLURB,
  KIND_LABEL,
  type KindResult,
} from "@/lib/builder/kinds";
import { builderAvailability } from "@/lib/builder/availability";
import { detectMarket, isMarket, MARKET_LABEL } from "@/lib/builder/market";
import {
  DEFAULT_MODEL,
  PROVIDER_LABEL,
  creditMultiplierFor,
  resolveModel,
} from "@/app/dashboard/models";
import { generationRequest, providerConfigured, userMessage } from "@/lib/builder/model-request";
import { stepRecorder, type BuildStep, type StepSink } from "@/lib/builder/steps";
import { BuilderError, startBuild, type BuildResult } from "@/lib/n8n";
import { restoreImages, stashImages } from "@/lib/page-html";
import { validatePage } from "@/lib/builder/validate";
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
  /* Which of the two things to build, when the person was asked and answered.
     Sent back with the next request the same way buildKind is — see the
     needsStack branch, and stack.ts for when the question is worth asking at
     all. Anything else here is ignored and the brief decides. */
  stack?: unknown;
  /* Which blueprint to build from — landing, ecommerce, blog or webapp. Sent
     only when something in the interface already knows (a starter chip, a
     project whose kind is settled); otherwise the brief is classified. As with
     intentOverride, an explicit choice beats a guess. */
  buildKind?: unknown;
  /* Which market's conventions the content follows — "us" or "ng". Sent only
     when something already knows; otherwise it is read out of the brief, and
     either way a brief that names a country overrules it. */
  market?: unknown;
  /* Files uploaded with this message: a screenshot to match, a logo to use, a
     page of copy to lay out. Ids only — the bytes are read on the server. */
  attachmentIds?: unknown;
  /* Which model generates the page, as the composer's picker holds it —
     "auto", or one of the ids in src/app/dashboard/models.ts. Resolved and
     validated here rather than trusted: this arrives from a browser, and it
     decides which vendor's API is called and what it is charged. */
  model?: unknown;
};

/* An edit is billed as generation, like a build, but priced from how many
   patches actually landed rather than from the size of the page. A one-line
   change costs the floor, which is what it should cost. */
function editUsage(applied: number): { filesTouched: number } {
  return { filesTouched: Math.max(1, applied) };
}

/* How long a brief may be.
 *
 * This was 4,000 characters, then 1,000 words. Both were a paragraph or two,
 * and real briefs are not paragraphs. Somebody specifying a product writes
 * pages: the sections, the copy, the brand, the rules that matter. A ceiling
 * there turns a specification into a summary before any model sees it, and the
 * person doing the summarising is the customer.
 *
 * Six hundred thousand characters is about a hundred and fifty thousand tokens.
 * Every model the picker offers for a BUILD carries a million-token context, so
 * a brief that size arrives whole with room for the page it produces. It is
 * still a backstop against a large payload being pushed through to the
 * orchestrator on the other side of the webhook; it is no longer a limit
 * anybody writing in good faith will meet.
 *
 * And it is priced rather than merely permitted: every message gets three
 * hundred free words and the rest carries a surcharge — see contextSurcharge,
 * which prices this brief and the conversation carried with it on the same
 * terms. The ceiling that used to do this job did it by refusing, which is the
 * crudest form of pricing and the one that also refuses the legitimate case. */
const MAX_PROMPT = 600_000;

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
/* Whether a brief the free rules cannot read is put back to the person.
 *
 * True, and the reasoning is about what the two mistakes cost. A wrong kind is
 * a rebuild rather than an edit — minutes of generation and real money spent on
 * a storefront somebody wanted as a landing page. A question costs one round
 * trip, and only ever on the roughly one brief in ten that nothing could read
 * confidently; anything that names its kind, demands one kind's machinery, or
 * arrived with a chip pressed never reaches it.
 *
 * Set false and the model decides instead, silently. That is the right setting
 * for a caller that cannot be asked — an API integration, a scheduled build —
 * and the wrong one for a person sitting in front of the builder. */
const ASK_WHEN_UNSURE = true;

const ENTRY_COST = CREDIT_ACTIONS.generate.min;
const FULL_BUILD_ENTRY_COST = CREDIT_ACTIONS.generate.max;

/* The wire format between this route and the workspace.
 *
 * One JSON object per line, which is all a progress stream needs: a step the
 * moment it is known, and one final object carrying what used to be the whole
 * response. Newline-delimited rather than Server-Sent Events because there is
 * nothing here that SSE's reconnection and event names would earn — this is a
 * single request that answers once and ends.
 *
 * The status code moves into the last line. A stream commits its headers before
 * the work begins, so an HTTP status cannot describe an outcome that has not
 * happened yet; every branch below still returns a NextResponse and the wrapper
 * unwraps it, so the statuses are written where they were always written. */
type StreamLine =
  | { type: "step"; step: BuildStep }
  /* The reply itself, arriving a piece at a time.
   *
   * Only ever sent where the text IS the answer — a question, a clarification.
   * An edit's output is a stream of search/replace blocks and never reaches
   * here; see `streamAnswer` in builder/edit.ts.
   *
   * Deltas rather than the whole answer each time: the reader appends, so what
   * crosses the wire is proportional to what was written rather than to the
   * square of it. The final `result` still carries the complete text, and it is
   * the authority — this is a preview of an answer that is also being written
   * down properly. */
  | { type: "text"; delta: string }
  | { type: "result"; status: number; body: unknown };

/**
 * Where a build is started, and the only thing exported from this module that
 * anything outside it calls.
 *
 * It is a wrapper rather than the work itself, because the work has a dozen
 * exits and every one of them wants to say something different. `handle` keeps
 * those exactly as they were — a NextResponse with a status — and this unwraps
 * whichever one it took, after the steps it emitted on the way there have
 * already reached the browser.
 */
export async function POST(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      /* Guarded because a reader that goes away mid-build — the tab closed, the
         person navigated — closes the controller under us, and an enqueue after
         that throws. The build itself is unaffected: the orchestrator has the
         work and the row is written whatever happens to this connection. */
      let open = true;
      const write = (line: StreamLine) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          open = false;
        }
      };

      let response: NextResponse;
      try {
        response = await handle(
          request,
          (step) => write({ type: "step", step }),
          (delta) => write({ type: "text", delta }),
        );
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("build: the request failed outright:", error);
        response = NextResponse.json(
          { error: "Something went wrong on my side. Try that again." },
          { status: 500 },
        );
      }

      /* The body is read back out of the response rather than threaded
         separately, so the branches below stay the plain `return
         NextResponse.json(...)` they have always been. */
      const body = await response.json().catch(() => null);
      write({ type: "result", status: response.status, body });

      if (open) controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      /* Proxies that buffer a response to measure it would hold every line
         until the last one, which is the whole of what this is for. */
      "x-accel-buffering": "no",
    },
  });
}

/* Where an answer's text goes as it is written. Separate from the step sink
   because they are different kinds of thing on different clocks: a step is one
   measured operation, and this is prose appearing. */
type TextSink = (delta: string) => void;

async function handle(
  request: Request,
  emit: StepSink,
  emitText: TextSink,
): Promise<NextResponse> {
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

  /* From here on, every operation is recorded with what it cost and what it
     produced, and streamed the moment it happens rather than held until the
     reply. The list still rides back with that reply — a finished message keeps
     its timeline — but the panel fills in while the work runs, which is the
     difference between naming the work and naming the wait.

     Opened here rather than beside the classifier, where it used to be: the
     reads before that point are quick but they are not free, and a panel that
     begins at the classifier is silent for whatever they cost. */
  const steps = stepRecorder(emit);

  /* Turns what the model reports about itself into the line under a step.
   *
   * This is the difference between a tracker that narrates and one that
   * decorates. "claude-opus-5 is writing the change…" is written here — the
   * same words whatever was asked for, true of every edit and specific to
   * none. What goes through this instead is Claude's own summarised reasoning
   * as it works, and then the count of patch blocks as they are written.
   *
   * Re-announcing the same id is what makes it a live line rather than a new
   * row: the panel merges by id, so each of these replaces the last. */
  const narrate = (id: string, label: string): OnProgress => (progress) => {
    /* The reply goes out on its own channel rather than into the step's detail
       line. A step detail is one line describing an operation; an answer is
       prose the person is reading, and squeezing it into the tracker would put
       the thing they asked for inside a collapsible panel about plumbing. */
    if (progress.kind === "answer") {
      emitText(progress.delta);
      return;
    }

    steps.begin(
      id,
      label,
      progress.kind === "reasoning"
        ? progress.text
        : `writing the change — ${progress.blocks} ${progress.blocks === 1 ? "edit" : "edits"} so far…`,
    );
  };

  let body: BuildRequestBody;
  try {
    body = (await request.json()) as BuildRequestBody;
  } catch {
    return NextResponse.json({ error: "That message didn't arrive in a form I could read. Try sending it again." }, { status: 400 });
  }

  const typed = typeof body.prompt === "string" ? body.prompt.trim() : "";

  /* A file on its own is a message.
   *
   * Dragging a photograph in and pressing send, with nothing typed, is how
   * people hand something over — and it used to be answered with "tell me what
   * you'd like and I'll get started", which is a strange thing to say to
   * somebody who has just given you their logo. The words they left out are the
   * same every time, so they are supplied rather than demanded. */
  const attached = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.filter((id) => typeof id === "string").length
    : 0;
  const prompt = typed || (attached > 0 ? "Use the attached file in this page." : "");
  const projectId = typeof body.projectId === "string" ? body.projectId : "";

  if (!prompt) {
    return NextResponse.json({ error: "Tell me what you'd like and I'll get started." }, { status: 400 });
  }
  /* Counted whatever happens, because the number is wanted twice: once in the
     sentence below if the brief is past the ceiling, and once by
     contextSurcharge, which prices everything over three hundred words. */
  const promptWords = countWords(prompt);
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json(
      {
        /* Said in both units. The ceiling is counted in characters because that
           is what the payload is, but words are what the person has — so the
           sentence leads with the number they can go and look at. */
        error:
          `That brief is ${promptWords.toLocaleString("en-US")} words (${prompt.length.toLocaleString("en-US")} characters), ` +
          `which is past what I can take in one message. Keep it under ${MAX_PROMPT.toLocaleString("en-US")} characters ` +
          `and send it again — or build it in parts and add the rest as changes.`,
      },
      { status: 400 },
    );
  }
  if (!projectId) {
    return NextResponse.json({ error: "I don't know which app that belongs to. Open one and try again." }, { status: 400 });
  }

  /* Reads under the caller's own session, so RLS answers this: a project id
     belonging to someone else comes back empty and is refused here, and never
     reaches n8n — which runs with a service key and would happily write it. */
  steps.begin("open", "Opening your app", "checking it's yours to open…");
  const { data: project, error: lookupError } = await supabase
    .from("projects")
    /* slug included so the address does not have to be re-read: it is what
       both the preview URL and the published URL are made from. */
    .select("id, name, slug")
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
  steps.mark("open", `Opened ${project.name}`);

  steps.begin("page", "Reading the page as it stands", "fetching the last version you built…");
  const { data: lastBuild } = await supabase
    .from("project_builds")
    .select("id, html")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const currentHtml = (lastBuild?.html as string | undefined) ?? null;

  /* The same page with its photographs lifted out, which is the only version a
     model can be shown.
   *
     A stored page carries its pictures inside it as base64, and on a real one
     that was 416,000 of its 463,000 characters — roughly 370,000 tokens against
     the 200,000 a model will take. Every edit posted the whole document and was
     refused before it began, so a page became permanently uneditable the moment
     it got its images. The pictures go back in after the change applies. See
     stashImages in lib/page-html.ts. */
  const stashed = currentHtml ? stashImages(currentHtml) : null;
  const leanHtml = stashed?.lean ?? null;

  /* Which model handles this message, decided once and used everywhere: the
     step lines, the prompt ceiling and the charge. Deciding it in each of those
     places separately is how a step line comes to name a model that did not do
     the work, or a charge comes to be at the wrong rate. editPage may still
     escalate past this — a picture in the message, or an attempt that placed
     nothing — and reports which model finished, which is what the charge
     actually follows.
   *
     Measured on leanHtml rather than currentHtml, and the difference is not
     small: the page above is 463,000 characters stored and 47,000 once its
     photographs are lifted out. Routing on the stored size would send every
     page with images to the strong model on the strength of base64 the model is
     never going to see.
   *
     With no page there is nothing to edit and nothing to ask about, so the
     value is unused; EDIT_MODEL is the harmless default. */
  const editModel = leanHtml ? editModelFor(prompt, leanHtml) : EDIT_MODEL;

  steps.mark(
    "page",
    currentHtml ? "Read the current page" : "There is no page yet",
    currentHtml
      ? `${currentHtml.length.toLocaleString("en-US")} characters`
      : "so this message can only be a first build",
  );

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
    .select("role, body, tone, kind")
    /* tone and kind travel with the text now, and they are not decoration: they
       are how a model call tells what the builder SAID from what the app
       REPORTED. See conversational() in builder/brief.ts, and the loop it was
       written for. */
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const history = ((recent ?? []) as { role: string; body: string; tone: string | null; kind: string | null }[])
    .reverse()
    .map((row) => ({ from: row.role, text: row.body, tone: row.tone, kind: row.kind }));

  /* The classifier keeps the slice it was tuned and tested against — six turns
     — but not the status lines and the faults. Those were never conversation,
     and a window half full of "I couldn't place that change" is six turns of
     which three say nothing about what this message means. */
  const classifierHistory = history.filter(conversational).slice(-6);

  /* The same conversation in the shape a model call takes. */
  const prior = priorTurns(history);

  /* What the words on this turn cost, on top of the work they ask for: the
   * message somebody sent, and the conversation carried with it.
   *
   * The message itself is in the count because that is what somebody pastes —
   * a thousand-word brief is the case this was asked for. The rest is measured
   * off `prior` rather than off `history`, because this must be the price of
   * what was actually SENT: priorTurns trims each message to MAX_CONTEXT_WORDS
   * and joins consecutive ones from the same side. Charging off the untrimmed
   * thread would bill somebody for a paragraph the builder never read.
   *
   * Zero on a short message and a short thread, which is most of them: the
   * first 300 words of each are part of the price of the turn. See
   * contextSurcharge. */
  const contextCost = contextSurcharge([
    promptWords,
    ...prior.map((turn) => countWords(String(turn.content))),
  ]);

  /* Whatever was attached to this message, resolved to rows the server can
     read. Restricted to this project and this owner: the ids came from the
     caller, and the read behind them uses the service key. */
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? (body.attachmentIds.filter((id) => typeof id === "string") as string[])
    : [];
  if (attachmentIds.length > 0) steps.begin("attachments", "Reading what you attached", "opening the files from Storage…");
  const attachments = await loadAttachments(attachmentIds, project.id, user.id);

  /* Read once, here, and reused by whichever path this message takes. It used
     to be read again inside each of the three model calls below, which meant
     the same files were downloaded and encoded up to three times — and, worse,
     that nothing above could see what had happened to them. */
  const files = await attachmentBlocks(attachments);

  if (attachments.length > 0) {
    const usable = attachments.length - files.skipped.length;
    steps.mark(
      "attachments",
      usable === attachments.length
        ? `Read ${usable} ${usable === 1 ? "attachment" : "attachments"}`
        : `Read ${usable} of ${attachments.length} attachments`,
      attachments.map((row) => row.name).join(", "),
    );
  }

  /* One id for everything this message does, settled here rather than at the
     build below: it is what makes each row this request writes safe to write
     twice. A retried request, or the same message sent from two tabs, writes
     the same message once. */
  const requestId =
    typeof body.requestId === "string" && body.requestId ? body.requestId : crypto.randomUUID();

  /* A file the model cannot read is said out loud, before anything is built on
     the assumption it arrived.
   *
     This is what "HTTP 400" was. One photograph the API could not decode — a
     HEIC off a phone, wearing a .jpeg name — and the whole request was refused,
     so an edit that had nothing to do with the picture died with a number in
     it. The file is left out now, and the reason is a sentence about that file
     rather than a status code about the request. */
  if (files.skipped.length > 0) {
    await deliver(
      files.skipped
        .map((file) => `I couldn't use ${file.name} — ${file.reason}.`)
        .join(" "),
      { tone: "error", key: `skipped:${requestId}` },
    );
  }

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

  /* Not taking work at all.
   *
   * Above the classifier, because classifying is itself a model call — asking a
   * dead key what a message means, in order to tell somebody the key is dead,
   * is the same mistake one level down.
   *
   * This is the case a configured key cannot catch: present, valid, and refused
   * for having no balance. Nothing below runs — no classification, no credit,
   * no "Building" on the row, and above all no spinner counting up toward
   * something that cannot happen. The person keeps their words and their
   * attachments and is told plainly whose problem it is.
   *
   * Two things are still allowed through, because neither needs a model and
   * both still work: handing over the file, which is a rule and a URL, and the
   * Undo button, which sends its own intent and replays a stored page. Refusing
   * those would be an outage pretending to be bigger than it is.
   *
   * See src/lib/builder/availability.ts for why this is a switch rather than
   * something the app tries to work out for itself. */
  const availability = builderAvailability();
  const worksWhilePaused = (currentHtml && wantsDownload(prompt)) || override === "revert";
  if (availability.paused && !worksWhilePaused) {
    const stored = await deliver(availability.message, {
      kind: "build_failed",
      tone: "error",
      key: "builder-paused",
    });
    return NextResponse.json({ error: availability.message, stored, paused: true }, { status: 503 });
  }

  /* Announced before the call, not after it. Classifying is a round trip when
     the rules cannot settle it, and this is the line someone reads while that
     round trip is happening. */
  steps.begin("intent", "Reading your message", "working out whether this is a change, a question or a new build…");

  const decision = await classifyIntent({
    message: prompt,
    hasPage: Boolean(currentHtml),
    history: classifierHistory,
    override,
    /* Read before the words are. Somebody who attaches a file has said
       something the sentence often leaves out — "use this" and an empty box
       with a photograph in it are the same request — and routing that to a
       question about which section they meant is the product failing to notice
       what it was handed. See heuristicIntent. */
    hasAttachment: attachments.length > 0,
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

  /* The project's own name, reserved on the first build rather than at publish.
   *
   * It is what BOTH addresses are made from — /quickstark-app/preview while it
   * is being built, /quickstark-app once it is live — so the URL somebody
   * learns while working on a page is the URL their site keeps. A preview
   * addressed by project id was 36 characters of hex that told nobody anything.
   *
   * Never fatal. A project whose name yields no usable address still builds and
   * still previews, at /preview/<id>, which is what every link already written
   * points at anyway. */
  let addressed: { id: string; name: string; slug: string | null } = {
    id: project.id,
    name: project.name as string,
    slug: (project as { slug?: string | null }).slug ?? null,
  };

  if (service && !addressed.slug) {
    const reserved = await reserveSlug(service, addressed, user.id);
    if ("slug" in reserved) addressed = { ...addressed, slug: reserved.slug };
    else {
      // eslint-disable-next-line no-console
      console.error(`build: ${project.id} could not reserve an address (${reserved.problem})`);
    }
  }

  const previewUrl = publishPreviewUrl(addressed);

  // ── REVERT ───────────────────────────────────────────────────────────────
  if (intent === "revert") {
    steps.begin("history", "Looking up the previous version", "reading back through what you've built…");
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

    /* What else they asked for in the same breath, handed back rather than
       dropped. The undo had to happen first — applying an edit to the version
       being thrown away would be exactly wrong — but their second instruction
       vanishing without a word is how somebody comes to believe the whole
       message failed. */
    const remainder = remainderAfterRevert(prompt);
    const revertMessage = remainder
      ? `Put the previous version back. You also asked to ${remainder} — send that again and I'll make the change on this version.`
      : "Put the previous version back.";

    const storedRevert = await deliver(revertMessage, { key: "revert" });

    const { data: reverted } = await supabase
      .from("projects")
      .select("id, name, status, updated_at, intent, preview_url, repo_url, admin_url, last_build_at, slug, published_at")
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
        message: revertMessage,
      },
      project: reverted ?? null,
    });
  }

  // ── DOWNLOAD ─────────────────────────────────────────────────────────────
  /* "Send me a download file" is not a question about the page, and it used to
     be answered as one — by a model told the page is its only subject, which
     replied that it had no way to hand over files. It does: the same address
     the preview header and the result card use, which serves the page with a
     Content-Disposition and a filename.
   *
   * No model call, so nothing to bill. The address goes into the thread as a
   * link, which means it is still there tomorrow — unlike the card's button,
   * which is a shortcut with a few minutes on it by design. */
  if (currentHtml && wantsDownload(prompt)) {
    steps.mark("download", "Answered with the file", "rules only, no model call");

    const href = `${previewUrl}?download=1`;
    const said =
      "Here it is — the page as a single HTML file. It opens in any browser, and it is the same file the Download button in the preview header gives you.";
    const links = [{ label: "Download the page", href }];
    const stored = await deliver(said, { links, key: "download" });

    return NextResponse.json({
      stored,
      steps: steps.list(),
      intent: "question",
      /* The chips under the reply, named. The three in `build.links` are the
         project's own addresses and are labelled as such by the panel; this one
         is about the message, so it travels beside them with its own label —
         the same shape the thread stores and reads back. */
      messageLinks: links,
      build: {
        ok: true,
        requestId: "",
        projectId: project.id,
        intent: "webapp",
        status: "Built",
        links: { preview: previewUrl, repo: "", admin: "" },
        configKeys: {},
        artifacts: {},
        message: said,
      },
      project: null,
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
      steps.begin("clarify", "Working out what to ask you", `${editModel} is reading the page…`);
      const question = await askClarifying(
        prompt,
        leanHtml ?? currentHtml,
        files.blocks,
        prior,
        narrate("clarify", "Working out what to ask you"),
        editModel,
      );
      steps.mark(
        "clarify",
        "Wrote one question back",
        `${editModel}, ${question.outputTokens} output tokens`,
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
          cost: creditCostOf("chat", { outputTokens: question.outputTokens, modelId: editModel }),
          description: `Clarify: ${project.name}`,
          projectId: project.id,
          outputTokens: question.outputTokens,
          /* Namespaced by what the charge is FOR, not just which request it
             came from: one request takes one of these paths, but a bare request
             id would make the three indistinguishable if that ever stopped
             being true. */
          dedupeKey: `clarify:${requestId}`,
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
      steps.begin("answer", "Looking through the page for your answer", `${editModel} is reading it now…`);
      const answer = await answerQuestion(
        prompt,
        leanHtml ?? currentHtml,
        files.blocks,
        prior,
        narrate("answer", "Looking through the page for your answer"),
        editModel,
      );
      steps.mark(
        "answer",
        "Answered from the page",
        `${editModel}, ${answer.outputTokens} output tokens`,
      );

      const delivered = await deliver(answer.text, { key: "answer" });

      /* Billed as chat, on what it said. Asking about a page is a model call
         with the whole page in it, so it is not free — but the chat band starts
         at zero and reaches one credit only at a full page of answer, which is
         what keeps troubleshooting from feeling metered. */
      if (service && delivered) {
        /* Plus the conversation it was answered against, on the same terms as
           an edit: a question read with six messages behind it is a question
           that cost more to answer than one read on its own. Not charged on the
           clarify path above — that one is the builder asking for help, and
           billing somebody extra for the classifier's caution is charging them
           for our own uncertainty. */
        const askCost = creditCostOf("chat", { outputTokens: answer.outputTokens, modelId: editModel });
        await chargeCredits(service, {
          userId: user.id,
          action: "chat",
          cost: roundCredits(askCost + contextCost),
          description:
            contextCost > 0
              ? `Question: ${project.name} — ${formatCredits(askCost)} + ${formatCredits(contextCost)} context`
              : `Question: ${project.name}`,
          projectId: project.id,
          outputTokens: answer.outputTokens,
          dedupeKey: `question:${requestId}`,
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

    /* Checked here rather than at the top, because it only applies once the
       message is known to be an edit: a build's brief may be seven times this
       long, and refusing it on the edit model's window would be refusing it for
       a reason that does not apply. Said as a sentence with the next step in
       it, rather than as a limit.

       And the window is the one the CHOSEN model has — see maxEditPromptChars.
       This used to be a single number sized for Haiku's 200K, which was right
       while Haiku took every edit and wrong the moment a long brief started
       going to Sonnet instead: it would have refused, on a window's behalf, a
       brief that was long enough to be routed away from that window in the
       first place. */
    if (prompt.length > maxEditPromptChars(editModel)) {
      const said =
        `That's a lot to change in one message — it goes to the page along with everything already on it, ` +
        `and together they're past what I can read at once. Ask for it a section at a time and each part will land.`;
      const stored = await deliver(said, { tone: "error", key: "edit-too-long" });
      return NextResponse.json(
        { error: said, intent: "edit", code: "edit_prompt_too_long", stored },
        { status: 400 },
      );
    }

    let edited;
    try {
      /* Seconds, not minutes: the model returns a handful of search/replace
         blocks rather than the whole document, which is why this can run here
         at all. A full build still goes to the orchestrator below. */
      /* editPage decides for itself and can escalate past this — a picture in
         the message, or an attempt that placed nothing — so this opening line
         is the likely model rather than the settled one. steps.mark below
         reports what actually did the work. */
      steps.begin("edit", "Making the change", `${editModel} is reading the page…`);
      edited = await editPage(
        prompt,
        leanHtml ?? currentHtml,
        files.blocks,
        prior,
        narrate("edit", "Making the change"),
      );

      /* The photographs that were lifted out so the page could be read, put
         back into the page that is about to be stored. First, because
         everything below measures or saves the real document — and a page
         stored with `stashed-image-0` where a picture belongs is a page whose
         images have been deleted by a tool that was only supposed to hide them
         from a model. */
      if (stashed && stashed.images.length > 0) {
        edited = { ...edited, html: restoreImages(edited.html, stashed.images) };
      }

      /* The tokens the model wrote, swapped for the pictures they stand for.
         Done here rather than in editPage because it belongs to the page being
         stored, not to the model call: the blocks came back, they applied, and
         what is about to be written to the table is a document that should
         carry its images inside it. See imagePlacements. */
      const placements = await imagePlacements(attachments);
      if (placements.length > 0) {
        const placed = placeAttachments(edited.html, placements);
        if (placed !== edited.html) {
          steps.mark(
            "attachments",
            `Placed ${placements.length} ${placements.length === 1 ? "image" : "images"} in the page`,
            placements.map((file) => file.name).join(", "),
          );
        }
        edited = { ...edited, html: placed };
      }
      steps.mark(
        "edit",
        edited.ranOutOfTime
          ? `Applied ${edited.applied} ${edited.applied === 1 ? "change" : "changes"}, then ran out of time`
          : edited.failures.length > 0
            ? `Applied ${edited.applied} of ${edited.applied + edited.failures.length} changes`
            : `Applied ${edited.applied} ${edited.applied === 1 ? "change" : "changes"}`,
        /* The model that actually did it, not the one that usually does — an
           edit escalates, and a line that names EDIT_MODEL whatever happened is
           a label rather than a report. And the route, because "by line number"
           means quoting the page had already failed twice, which is the first
           thing worth knowing if the change landed somewhere odd. */
        `${edited.model}, ${edited.outputTokens} output tokens${
          edited.route === "lines" ? ", placed by line number" : edited.retried ? ", retried once" : ""
        }${edited.ranOutOfTime ? ", stopped at the time limit" : ""}`,
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

    /* ── The gate the working version sits behind ──────────────────────────
     *
     * Everything above decides WHAT changes. This decides whether the result is
     * allowed to become the page — and it is the last point at which the answer
     * can still be no.
     *
     * A patch can apply perfectly and still wreck the layout: a deletion that
     * takes an opening <div> and leaves its </div> closes a section early and
     * folds the rest of the page into it. Every stage before this reports
     * success, because every stage before this was successful. The page was
     * stored anyway, and the person found out by looking at their own site.
     *
     * Checked on the finished document — pictures restored, tokens resolved —
     * because that is what would be written. See validatePage, and note what it
     * deliberately does not check: this refuses what an edit BROKE, never what
     * it merely left imperfect. */
    steps.begin("check", "Checking the change", "making sure the page still holds together…");
    const verdict = validatePage(currentHtml, edited.html);

    /* And the second question, which the first one cannot answer.
     *
     * validatePage asks whether the document still HOLDS TOGETHER — tags
     * balanced, nothing catastrophically removed. This asks whether it still
     * WORKS, and the failures are the ones that pass every other check in the
     * pipeline: a nav link pointing at a section the edit deleted, a script
     * reaching for an id that is gone, the viewport tag lost so the page stops
     * laying out on a phone. Each of those renders. Each of those diffs
     * cleanly. Each of those is found by the person whose site it is.
     *
     * Reported rather than refused, and that distinction is the whole design.
     * A broken anchor is not a reason to throw away an edit somebody asked for
     * — the edit is probably right and the nav is probably a line behind it. So
     * the change is kept and the consequence is said out loud, in the reply,
     * with enough in it to ask for the follow-up in one sentence. Refusing
     * would be the failure this codebase has had twice: a rule that is right in
     * principle and wrong about the documents it meets. */
    const broke = verdict.ok ? regressions(readPage(currentHtml), readPage(edited.html)) : [];

    if (!verdict.ok) {
      /* Discarded, not stored. The previous version is still the working
         version and was never touched — the edit only ever existed in memory,
         which is what makes this safe to refuse this late.
       *
         Logged with the request id beside it, because a page that fails this is
         a bug in the patching upstream and the failure is the only trace of
         it. */
      // eslint-disable-next-line no-console
      console.error(
        `edit ${requestId}: refused after applying — ${verdict.problem}`,
        `(route ${edited.route}, model ${edited.model}, ${edited.applied} applied)`,
      );
      steps.mark("check", "Kept the previous version", verdict.problem);

      const message = `That change didn't come out right — ${verdict.problem}. I've kept the page exactly as it was. Naming the section you mean usually gets a cleaner result.`;
      const stored = await deliver(message, { tone: "error", key: "edit-invalid" });
      return NextResponse.json(
        { error: message, intent: "edit", code: "edit_invalid", stored },
        { status: 422 },
      );
    }

    steps.mark(
      "check",
      broke.length === 0
        ? "The page still holds together"
        : `Applied, but ${broke.length} thing${broke.length === 1 ? "" : "s"} the change knocked loose`,
      broke.length === 0 ? undefined : broke.join("; "),
    );

    steps.begin("version", "Saving the new version", "storing it so you can undo back to this…");
    await service.from("project_builds").insert({
      project_id: project.id,
      user_id: user.id,
      /* Both of these were being written as null on every edit, which is why
         working out what had happened to a page meant reading the chat log and
         guessing. The row now says which request made it and what did the
         work, so a version that came out wrong can be traced to the attempt
         that produced it. */
      request_id: requestId,
      prompt,
      html: edited.html,
      model: `${edited.model}${edited.route === "lines" ? " (by line)" : ""}`,
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
      edited.ranOutOfTime
        ? /* The change was too big to finish in the time a request has. What
             landed is real and correct, and saying which part is missing is the
             difference between a person asking for the rest and a person
             repeating the whole thing and hitting the same wall. */
          `I made ${edited.applied} ${edited.applied === 1 ? "change" : "changes"} before running out of time — that's as much as fits in one edit. Ask for the rest and I'll carry on from here.`
        : edited.failures.length > 0
          ? `Done — though ${edited.failures.length} part of that could not be matched in the page.`
          : "Done.",
      /* What the change knocked loose on its way through.
       *
       * Said before the model's own suggestion, because it outranks it: a
       * broken anchor is a fact about the page somebody now owns, and a next
       * step is an offer. Said at all because nothing else in the pipeline
       * can — the page renders, the markup balances, and this is the only
       * point at which anybody notices the menu stopped working. */
      broke.length > 0
        ? `One thing to know: ${broke.join("; and ")}. Say the word and I'll tidy that up.`
        : null,
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
    /* The edit, plus what the conversation behind it cost to carry. Named in
       the description rather than folded in silently: a line in a ledger that
       says only "Edit" and charges more than the last identical edit is the
       kind of thing somebody notices and cannot explain. */
    /* Priced on the model that did the work, not the one that usually does. An
       edit escalates when it carries a picture or when the first attempt placed
       nothing — see EDIT_MODEL_STRONG — and billing the cheap rate for the dear
       model is the mistake this file has made before. */
    const editCost = creditCostOf(BUILD_ACTION, { ...editUsage(edited.applied), modelId: edited.model });
    const charge = await chargeCredits(service, {
      userId: user.id,
      action: BUILD_ACTION,
      cost: roundCredits(editCost + contextCost),
      description:
        contextCost > 0
          ? `Edit: ${project.name} — ${formatCredits(editCost)} + ${formatCredits(contextCost)} context`
          : `Edit: ${project.name}`,
      projectId: project.id,
      filesTouched: edited.applied,
      dedupeKey: `edit:${requestId}`,
    });

    if (charge) {
      steps.mark("charge", `Charged ${formatCredits(charge.charged)} credits`);
    }

    const { data: after } = await supabase
      .from("projects")
      .select("id, name, status, updated_at, intent, preview_url, repo_url, admin_url, last_build_at, slug, published_at")
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

  const viewerPlan = beforeBuild?.planId ?? "free";

  /* The model is settled HERE rather than further down, because affordability
     and model choice are the same decision and pretending otherwise is what
     produced the refusal this replaces: "a full build on this model costs 8.00
     and you have 5.25 — pick a cheaper model", to somebody whose plan included
     a cheaper model that would have run.

     Asking for "auto" now means asking this account's balance what it can
     have. autoModelFor starts at the default and steps down; an explicitly
     picked model is honoured exactly as picked, because a person who chose
     Opus asked for Opus and would rather be refused than quietly downgraded. */
  const wanted = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;
  /* resolveModel turns "auto" into AUTO_MODEL and refuses anything this app
     does not offer or cannot currently call. */
  const requested = resolveModel(wanted);

  if (!requested) {
    return NextResponse.json(
      { error: "That is not a model this app can build with." },
      { status: 400 },
    );
  }

  /* The plan gate runs on what was ASKED FOR, before the balance is consulted.
     The two refusals are different things and must not be confused: a plan
     cannot be solved by spending less, so a Free account that picks Fable is
     told about the plan rather than quietly given Sonnet. Affordability, below,
     IS solved by spending less, and so it is. */
  const requiredPlan = planRequiredFor(requested);
  if (beforeBuild && requiredPlan && !modelAllowedOnPlan(requested, viewerPlan)) {
    const usable = affordableModels(beforeBuild, viewerPlan).length
      ? affordableModels(beforeBuild, viewerPlan)
      : modelsForPlan(viewerPlan);
    const said = `${requested.name} is on the ${requiredPlan.name} plan and you are on ${PLANS[viewerPlan].name}. Upgrade to build with it, or use ${usable.map((entry) => entry.name).join(" or ")} — ${PLANS[viewerPlan].name} includes ${usable.length === 1 ? "it" : "them"}.`;
    const stored = await deliver(said, { tone: "error", key: "plan-locked" });
    return NextResponse.json(
      { error: said, code: "model_requires_plan", requiredPlan: requiredPlan.id, stored },
      { status: 402 },
    );
  }

  /* Affordability, which steps down rather than refusing. The door is scaled
     per model — the band describes a turn on the default and every other model
     multiplies it — so an account holding eight credits cannot open a Fable
     build that prices at forty. What it CAN do is build on something cheaper. */
  const choice = resolveBuildModel(requested, beforeBuild, viewerPlan);

  if (!choice) {
    /* The only refusal left: nothing on this plan fits this balance. The
       message names the plan above, or the top-up, because there is no cheaper
       model left to name. */
    const said = cannotAffordBuildMessage(requested, beforeBuild!, viewerPlan);
    const stored = await deliver(said, { tone: "error", key: "no-credits" });
    return NextResponse.json(
      {
        error: said,
        code: "insufficient_credits",
        model: requested.id,
        needed: buildDoorFor(requested),
        plan: viewerPlan,
        stored,
      },
      { status: 402 },
    );
  }

  const model = choice.model;

  /* Said before the build starts, not after it finishes. A page built on a
     smaller model than the chip promised, with nothing said, is
     indistinguishable from a page that came back badly — and that is the
     conclusion somebody reaches on their own. */
  if (choice.downgradedFrom && beforeBuild) {
    await deliver(downgradedModelMessage(choice, beforeBuild), {
      /* Normal, not error: nothing failed. The build is running, just not on
         the model that was asked for, and colouring that as a failure would
         make a working build look broken. */
      key: "model-downgraded",
    });
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

  /* ── Which blueprint this is built from ──────────────────────────────────
     The decision that used to be made inside the orchestrator, on one prompt
     that had to describe a storefront, a landing page, a publication and an
     application at once — and so described none of them. Every build came back
     looking like the average of the four: a hero, three cards, a price table,
     a footer.

     It is made here now, from the brief that is actually being built rather
     than from the raw message, and it decides the whole prompt: sections,
     behaviour, depth, and — the part that matters most to anyone who has asked
     for a landing page and been handed a shop — what must not be in it. See
     src/lib/builder/blueprints.

     Free almost always: the regexes in builder/kinds.ts answer most briefs
     outright, and the model is asked only about the ones they decline. Neither
     path throws, so an unreachable classifier still builds something. */
  /* Which model, settled before anything is spent.
   *
   * Rejected rather than substituted. A body naming a model this app does not
   * offer did not come from this app's picker, and quietly building it on the
   * default would turn a tampered request into a normal-looking build. A model
   * whose provider has no key configured is refused for the opposite reason:
   * it is our misconfiguration, not the person's mistake, and it should read
   * as one rather than as a build that failed for no stated cause. */
  if (!providerConfigured(model.provider)) {
    return NextResponse.json(
      {
        error: `${model.name} is not available right now — ${PROVIDER_LABEL[model.provider]} is not configured on this deployment. Pick another model.`,
      },
      { status: 503 },
    );
  }

  steps.begin("kind", "Working out what to build", "landing page, store, publication or app…");

  /* A choice, then the free rules, then a question — and only a model if
     somebody has turned the question off.
     
     The order matters and it was wrong a moment ago: this used to call the
     model first and then ask anyway, paying for an answer it discarded. Nothing
     used it but the order of four buttons, and bestKindGuess orders them for
     nothing. So on this path no model is consulted before generation, in the
     app for the same reason none is consulted in the orchestrator. */
  const chosen = isBuildKind(body.buildKind) ? body.buildKind : null;
  const quick: KindResult | null = chosen
    ? { kind: chosen, confidence: 1, source: "selection", reason: "you chose it" }
    : heuristicKind(brief.text);

  if (!quick && ASK_WHEN_UNSURE) {
    const asked =
      "I can build this a few different ways and I would rather ask than guess. Which is it?";
    const stored = await deliver(asked, { key: "which-kind" });
    const leading = bestKindGuess(brief.text);

    return NextResponse.json({
      stored,
      steps: steps.list(),
      intent: "new_project",
      needsKind: true,
      /* Leading reading first, so the likeliest answer is the first thing
         under the thumb. Read from the scored signals rather than from a model:
         the rules could not pick a winner outright, but they still know which
         way they were leaning. */
      kindOptions: [leading, ...BUILD_KINDS.filter((option) => option !== leading)].map(
        (option) => ({ kind: option, label: KIND_LABEL[option], blurb: KIND_BLURB[option] }),
      ),
      build: {
        ok: true,
        requestId,
        projectId: project.id,
        intent: leading,
        status: "Needs Clarification",
        links: { preview: "", repo: "", admin: "" },
        configKeys: {},
        artifacts: {},
        message: asked,
      },
      project: null,
    });
  }

  /* Only reached when asking is switched off: something has to decide, and a
     model reads "something for my restaurant" better than a scoreboard does. */
  const kind = quick ?? (await classifyKind({ brief: brief.text }));
  steps.mark(
    "kind",
    `Building ${KIND_LABEL[kind.kind].toLowerCase()}`,
    `${KIND_BLURB[kind.kind]} — ${kind.reason}`,
  );

  /* ── One page, or a project of files ────────────────────────────────────
   *
   * Decided here rather than at the generation call, and the position is the
   * whole point: everything below this line costs money. The asset resolver
   * makes real requests to a stock provider and stores what it finds, and the
   * build after it is the most expensive thing in the system. Getting this
   * wrong is not recoverable by editing — a scaffold is not a landing page
   * with the wrong colours, it is a different artefact — so the only way to
   * discover the mistake is to look at what came back and pay again.
   *
   * See stack.ts. Where the brief says which it is, it is taken and nothing is
   * asked. Where the evidence is only the SHAPE of the brief — the word
   * "dashboard", a kind of "software people sign into" that never mentions
   * signing in — the question goes back before a penny is spent. */
  const chosenStack: Stack | null =
    body.stack === "nextjs" || body.stack === "standalone-html" ? body.stack : null;
  const needs = chosenStack
    ? { ...decideStack(brief.text, kind.kind), stack: chosenStack, certain: true }
    : decideStack(brief.text, kind.kind);

  if (!needs.certain && ASK_WHEN_UNSURE) {
    const asked = stackQuestion(needs);
    const stored = await deliver(asked, { key: "which-stack" });

    return NextResponse.json({
      stored,
      steps: steps.list(),
      intent: "new_project",
      needsStack: true,
      /* The lean first, so the likelier answer is under the thumb — read from
         the same signals that could not settle it outright, which still know
         which way they were leaning. */
      stackOptions: stackOptions(needs),
      /* Sent back so the answer does not re-run the classifier and possibly
         land somewhere else: the person is answering a question about THIS
         reading of the brief. */
      buildKind: kind.kind,
      build: {
        ok: true,
        requestId,
        projectId: project.id,
        intent: kind.kind,
        status: "Needs Clarification",
        links: { preview: "", repo: "", admin: "" },
        configKeys: {},
        artifacts: {},
        message: asked,
      },
      project: null,
    });
  }

  steps.mark(
    "stack",
    needs.stack === "nextjs" ? "Building this as a full project" : "Building this as a single page",
    needs.why[0],
  );

  /* ── And where it is set ────────────────────────────────────────────────
     The blueprint decides what is built; this decides the world it is built
     in — the currency on every price, the shape of an address, how people pay,
     which way round a date goes, and which English it is spelled in. Free, and
     read from the brief rather than assumed: "a storefront with Paystack
     checkout" is Nigerian without anybody typing the word. See
     src/lib/builder/market.ts. */
  const market = detectMarket(brief.text, isMarket(body.market) ? body.market : null);
  steps.mark("market", `Set in the ${MARKET_LABEL[market.market]}`, market.reason);

  /* ── The pictures, decided before a line of the page is written ─────────
     The architectural rule, at the point it actually applies: the model that
     writes the code is not asked what imagery this project needs. That is
     settled here — one visual direction for the whole project, a plan of what
     it needs, and every slot filled from the first source in the chain that can
     answer. See src/lib/builder/assets/.

     Every part of it degrades. No providers configured, no storage, no table,
     no network: the plan still exists, the direction still reaches the code
     generator, and the slots nothing could fill become toned panels. A build
     never fails over a photograph. */
  steps.begin("assets", "Planning the imagery", "one look for the whole project…");

  const library = { assets: await loadAssets(project.id) };

  /* What they attached, taken in as assets before anything is planned.
   *
     Their own photograph of their own product must beat anything we could find
     or generate, and it only can if it is in the library by the time the
     resolver walks the chain. Content images are copied into the public asset
     bucket, classified and tagged with the slot they should fill; a screenshot
     or a mockup is left alone and goes to the model as something to look at.
     See asset-intake.ts. */
  const intake = await intakeAttachments({
    projectId: project.id,
    kind: kind.kind,
    rows: attachments,
    existing: library.assets,
  });
  library.assets.push(...intake.assets);

  if (intake.assets.length > 0) {
    steps.mark(
      "attachments",
      `Took in ${intake.assets.length} of your ${intake.assets.length === 1 ? "image" : "images"}`,
      `used as ${[...new Set(intake.assets.map((asset) => asset.type))].join(", ")} rather than redrawn`,
    );
  }

  const plan = planAssets({ kind: kind.kind, brief: brief.text });
  const providers = await usableProviders(library);
  const pictures = await resolveAssets({
    projectId: project.id,
    plan,
    library,
    providers,
    /* Stored where there is a service key, so the next build reuses these
       rather than paying for them again. */
    store: Boolean(service),
    deadlineMs: 20_000,
  });

  /* Recorded, but never blocking: a build must not fail because a row did not
     write. recordAsset logs its own failures. */
  await Promise.all(pictures.created.map((asset) => recordAsset(asset).catch(() => false)));

  const sources = Object.entries(pictures.bySource)
    .map(([id, count]) => `${count} from ${id}`)
    .join(", ");
  steps.mark(
    "assets",
    `Chose the imagery — ${plan.direction.register}`,
    sources
      ? `${sources}${pictures.unresolved > 0 ? `, ${pictures.unresolved} left as panels` : ""}`
      : "no image source configured, so the layout holds plain panels",
  );

  /* Stored before the build runs, so a build that times out on the way back
     still leaves the workspace showing why it is not idle. The brief is stored
     rather than the message, so the row says what was built rather than the
     word that asked for it again.

     The kind goes down with it, rather than being left to the workflow's own
     classifier: the prompt the page is generated from was composed from this
     decision, so this is what the build actually is — and writing it here means
     the row says so even if the orchestrator's Supabase step is not connected. */
  await supabase
    .from("projects")
    .update({ prompt: brief.text, status: "Building", intent: kind.kind })
    .eq("id", project.id);

  /* Only a full build reaches here, and a full build is a fresh page: whatever
     was there is being replaced, deliberately and with the person's say-so, so
     the orchestrator is given nothing to edit. */
  let result: BuildResult;
  try {
    steps.running(
      "orchestrator",
      "Building your page",
      "handed to the orchestrator — this one takes minutes, not seconds…",
    );
    /* What was attached, in the two forms a workflow can carry: signed
       addresses for images, and text already read for everything else. Read
       once here rather than twice, because the composed prompt needs to know
       about them as well as the orchestrator. */
    /* Only the REFERENCE images. Anything taken in as an asset is in the
       manifest with a stable URL, and sending it here as well would ask the
       model to redraw a photograph it has been told to reference — which is
       the behaviour this whole path exists to stop. */
    const imageUrls = await signedImageUrls(intake.reference);
    const attachedText = await attachmentText(attachments);

    /* The whole system prompt, held rather than inlined: it is both what the
       orchestrator is sent and what the request body is built around, and
       composing it twice would be two chances to compose it differently. */
    const systemPrompt = composeBuildPrompt(kind.kind, brief.text, {
      projectName: project.name,
      attachmentText: attachedText,
      imageCount: imageUrls.length,
      carriedFrom: brief.carried,
      market: market.market,
      /* What the code generator is told about imagery, and all it is told. */
      manifest: pictures.manifest,
      /* And, when this is a project rather than a page, what a project has to
         come back as: the files, the routes, and the plumbing NOT to write
         because scaffold.ts writes it. Appended to the blueprint rather than
         replacing it — what to build is the same question either way, and only
         the shape of the answer changes. */
      treeInstructions: needs.stack === "nextjs" ? treeBrief(kind.kind, needs.backend) : undefined,
    });

    const request = generationRequest(
      model,
      systemPrompt,
      userMessage(project.name, brief.text, attachedText, imageUrls.length),
      imageUrls.map((url) => ({ url })),
    );

    result = await startBuild({
      prompt: brief.text,
      projectName: project.name,
      userId: user.id,
      projectId: project.id,
      requestId,
      attachmentUrls: imageUrls,
      attachmentText: attachedText,
      /* What to build, and the whole prompt to build it from: the base rules,
         the blueprint for this kind, the brief, and what the app knows about
         the project. The workflow is handed both rather than deciding for
         itself — prompts that live in a node can only be changed in a browser,
         with no diff and no review, and that is how one prompt came to serve
         four different kinds of product. */
      buildKind: kind.kind,
      /* Which of the two things the orchestrator is building, and whether it
         gets a database client. The workflow branches on this; the save route
         reads it back to decide whether to write @/lib/supabase into the tree.
         Sent explicitly rather than inferred from what comes back, so a
         generation that ignored its instructions is a failed build rather than
         a silently different product. */
      stack: needs.stack,
      backend: needs.backend,
      /* Which model, and everything needed to call it — the endpoint, the
         wire id, the token ceiling, and the body already shaped for that
         vendor's API. The orchestrator attaches the credential and sends it.

         Shaped here rather than on a canvas because three providers means
         three bodies, and three bodies built out of node expressions is three
         things that can drift from what this app thinks it asked for. See
         src/lib/builder/model-request.ts. */
      model: model.id,
      modelName: model.name,
      provider: request.provider,
      generationUrl: request.url,
      generationHeaders: request.headers,
      generationBody: request.body,
      responseShape: request.shape,
      systemPrompt,
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

  /* A build that came back already failed is not a build that started.
   *
   * The orchestrator answers `status: "Failed"` when a step before the build
   * branch gave out — its own classifier being unreachable is the one that
   * happens — and that reply used to be stored as `build_started` in the normal
   * tone. So the thread said "the build could not be completed" in the voice it
   * uses for "your build is underway", under a row this route had set to
   * Building a moment earlier and which nothing was going to move off it. A
   * session reopened later read a build still in flight.
   *
   * Told as what it is instead: the row goes to Failed here rather than waiting
   * on the orchestrator's own Supabase step, which is the step that has already
   * been skipped if the run got this far. */
  if (result.status === "Failed" || !result.ok) {
    await supabase.from("projects").update({ status: "Failed" }).eq("id", project.id);

    const stored = await deliver(result.message, {
      kind: "build_failed",
      tone: "error",
      key: "build-failed",
    });

    return NextResponse.json(
      { error: result.message, stored, steps: steps.list(), buildKind: kind.kind, build: result },
      { status: 502 },
    );
  }

  /* The build is running and the thread says so — from here, not from the
     browser. It is what a session reopened five minutes later reads to know
     there is something still in flight to pick back up. */
  const storedBuild = await deliver(result.message, { kind: "build_started", key: "build" });

  /* What the orchestrator persisted, read back rather than assumed. If its
     Supabase step is not connected yet the row still says "Building", and the
     reply says so too instead of promising a row that was never written. */
  const { data: synced } = await supabase
    .from("projects")
    .select("id, name, status, updated_at, intent, preview_url, repo_url, admin_url, last_build_at, slug, published_at")
    .eq("id", project.id)
    .maybeSingle();

  return NextResponse.json({
    stored: storedBuild,
    steps: steps.list(),
    intent: "new_project",
    /* What was built, beside what the message was. The workspace names the
       result from it, and the composer can send it back as buildKind to keep a
       follow-up build on the same blueprint. */
    buildKind: kind.kind,
    market: market.market,
    build: result,
    project: synced ?? null,
  });
}
