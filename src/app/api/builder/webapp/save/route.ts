import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { contextSurcharge, creditCostOf, formatCredits, roundCredits } from "@/app/dashboard/credits";
import { carriedContextWords, countWords } from "@/lib/builder/brief";
import { verifyBuildClaim } from "@/lib/build-signature";
import { chargeCredits } from "@/lib/credits-server";
import { fillImages, searchContext } from "@/lib/builder/images";
import { addPhotoCredits } from "@/lib/builder/photo-credits";
import { providerFromEnv } from "@/lib/builder/image-providers";
import type { ArchitectureManifest, Layer } from "@/lib/builder/architecture";
import { resolveBackend } from "@/lib/builder/backend/connection";
import { systemByName } from "@/lib/builder/design";
import { allIssues, describeQa, runQa } from "@/lib/builder/qa";
import { isBuildKind } from "@/lib/builder/kinds";
import { completeTree, missingFrom } from "@/lib/builder/scaffold";
import { dataModelFor, schemaNameFor } from "@/lib/builder/schema";
import { storeTree } from "@/lib/builder/store-tree";
import { projectSummary } from "@/lib/builder/project-summary";
import { type FileTree, TreeError, previewDocument, readTree } from "@/lib/builder/tree";
import { PageHtmlError, filesTouchedFor, readGeneratedDocument } from "@/lib/page-html";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { recordAndConfirm, recordMessage } from "@/lib/thread-server";
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

/* Whether this project was asked to talk to a database.
 *
 * Read from the build request rather than guessed from the files: a project
 * that imports @/lib/supabase because the model felt like it should still not
 * get the dependency unless somebody asked for a backend. */
function withBackendFor(body: SaveRequest): boolean {
  return body.stack === "nextjs-supabase" || body.backend === true;
}

/* Which layers this project has, as /api/build decided them.
 *
 * Sent back by the orchestrator, which carries it through unchanged — the same
 * way it carries `stack` and `backend`. It is not re-derived here and must not
 * be: the manifest is what the prompt was written against and what the schema
 * was created from, and a second derivation from a different input is a second
 * answer. A tree scaffolded against a manifest the build did not use gets a
 * Supabase client for tables that were never created.
 *
 * Absent is the ordinary case, not an error: every build before this existed
 * sends nothing, so the old two booleans are read instead and the project is
 * scaffolded exactly as it was. */
function architectureFor(body: SaveRequest): ArchitectureManifest {
  const sent = body.architecture;

  if (sent && typeof sent === "object") {
    const layer = (name: Layer): boolean => (sent as Record<string, unknown>)[name] === true;
    const type = (sent as { type?: unknown }).type;

    if (isBuildKind(type)) {
      return {
        type,
        frontend: true,
        backend: layer("backend"),
        database: layer("database"),
        authentication: layer("authentication"),
        admin: layer("admin"),
        storage: layer("storage"),
        payments: layer("payments"),
      };
    }
  }

  const backend = withBackendFor(body);
  return {
    type: "webapp",
    frontend: true,
    backend,
    database: backend,
    authentication: false,
    admin: false,
    storage: false,
    payments: false,
  };
}

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
  /* The project as files, when the orchestrator built one.
   *
   * Absent on every build of the single-page stack, which is every build so
   * far — so this is additive and nothing that does not send it changes. See
   * lib/builder/tree.ts. `html` stays required either way, and that is not
   * redundancy: a tree of .tsx source cannot be shown to anybody without a
   * build step, so a file-tree build sends its files AND a rendered home page
   * to serve as the preview. */
  files?: unknown;
  stack?: unknown;
  backend?: unknown;
  /* The architecture manifest /api/build decided, carried through the
     orchestrator untouched. See architectureFor. */
  architecture?: unknown;
  /* Which of the six design systems, by name. Looked up rather than trusted as
     a payload: a name either matches one of six or it does not, so a value
     mangled in transit becomes a project with no tokens file rather than a
     project with a corrupted palette in it. */
  designSystem?: unknown;
};

/* ── A build that failed here says so, in the thread, in its own words ─────
 *
 * The save can refuse a real document — one that came back cut off at the
 * model's ceiling, one too large to store, one that is not a document at all —
 * and every one of those used to end the same way: an error returned to a
 * workflow node that reads nothing but the status code, and whose only response
 * is to write "Failed" on the project row. The person got "The build didn't
 * finish", which is the panel's sentence for a failed row and says nothing
 * about why; so did anybody trying to work out what went wrong afterwards.
 *
 * The reason exists here. This writes it down where the question was asked, and
 * moves the row itself, so the outcome does not depend on the orchestrator's
 * error branch running at all.
 */
async function reportFailure(
  supabase: SupabaseClient,
  claim: { requestId: string; projectId: string; userId: string },
  message: string,
  status: number,
) {
  await recordMessage(supabase, {
    projectId: claim.projectId,
    userId: claim.userId,
    role: "system",
    body: message,
    tone: "error",
    kind: "build_failed",
    /* Keyed on the build, so a workflow that retries a save it believes failed
       does not say the same thing twice. */
    dedupeKey: `save-failed:${claim.requestId || claim.projectId}`,
  });

  /* The same pair of writes the orchestrator's Flag Build Failure makes, made
     here because this is where the reason is known. last_build_at is what the
     workspace's watcher reads to know this run is over.

     Never over a page that landed. A build in flight is "Building"; "Built"
     means a document is already stored and being served, and a late or repeated
     save that fails validation must not take that page's project down with
     it. */
  await supabase
    .from("projects")
    .update({ status: "Failed", last_build_at: new Date().toISOString() })
    .eq("id", claim.projectId)
    .eq("user_id", claim.userId)
    .neq("status", "Built");

  return NextResponse.json({ message }, { status });
}

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

  /* A request carrying no document at all is a caller that posted the wrong
     thing, not a build that failed — and the difference decides whether
     anybody is told their build died.

     Written for a specific caller: a version of the orchestrator in which
     `Generate With Claude` also called this route directly with the raw model
     response, which has no `html` field anywhere in it. That edge is not in the
     deployed workflow — this file said it was, on the strength of a mirror that
     had gone stale, and checking the canvas is what settled it.

     The guard stays, because it is right on its own: a save with no document in
     it is a malformed request whoever sent it, and answering that by writing
     "your build failed" in somebody's conversation would be inventing an
     outcome out of a caller's mistake. Refused as a bad request, project row
     untouched, nothing said in the thread. */
  /* A build of the file-tree stack legitimately has no page in it. The model
     returns `.tsx` source, the HTML is what `next build` would produce, and
     nothing here runs `next build` — so `files` with no `html` is the ordinary
     shape of a project rather than a malformed request, and the preview is
     derived from the tree further down. Neither of them is still the caller
     mistake this guard was written for. */
  const sentPage = typeof body.html === "string" && body.html.trim().length > 0;
  const sentFiles = body.files !== undefined && body.files !== null;

  if (!sentPage && !sentFiles) {
    return NextResponse.json({ message: "This request carries no page to save." }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { message: "Builds cannot be stored — SUPABASE_SERVICE_ROLE_KEY is not set." },
      { status: 503 },
    );
  }

  /* Both signed ids, as the belt to the signature's braces: this client
     bypasses RLS, so the pair is what keeps a build off the wrong row.

     Read before the document is validated rather than after, because a refusal
     now has somewhere to be reported. */
  const { data: project, error: lookupError } = await supabase
    .from("projects")
    .select("id, name, deleted_at")
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

  /* The files, if this build produced any.
   *
   * Read and completed BEFORE the build row is written, so a project that came
   * back unbuildable is reported as a failed build rather than stored as a
   * successful one with a hole in it. The scaffold is merged in here rather
   * than asked for — see scaffold.ts, and treeBrief, which tells the model not
   * to write the plumbing precisely because this does. */
  let tree: FileTree = [];

  /* Held out here rather than inside the branch, because the preview below is
     derived from the same three answers the scaffold was built from. Deriving
     them twice would be two chances to derive them differently, and the summary
     would then describe a project that was not the one stored. */
  const sentArchitecture = Boolean(body.architecture && typeof body.architecture === "object");
  const summaryArchitecture = architectureFor(body);
  /* The schema the generated client is pointed at has to be the one the build
     actually created, so it is read back from where provisioning recorded it
     rather than recomputed — a project on somebody's own Supabase uses
     `public`, and a client scaffolded against app_<id> would query a schema
     that is not there. */
  const summaryBackend = summaryArchitecture.database
    ? await resolveBackend(supabase, claim.projectId)
    : null;
  const summaryBackendReady = summaryBackend?.ready === true;
  const summaryModel = dataModelFor(
    summaryArchitecture,
    summaryBackend?.schema ?? schemaNameFor(claim.projectId),
  );

  if (body.files !== undefined && body.files !== null) {
    try {
      tree = completeTree(
        readTree(body.files),
        (project.name as string | null) ?? "app",
        summaryArchitecture,
        summaryModel,
        /* Null for any build that did not send one — every build before this
           existed, and any caller that is not /api/build. The scaffold then
           writes no tokens file and the project keeps whatever stylesheet the
           model wrote, exactly as it did before. */
        systemByName(body.designSystem) ?? undefined,
      );

      const missing = missingFrom(tree);
      if (missing.length > 0) {
        return await reportFailure(
          supabase,
          claim,
          `The project came back incomplete — ${missing.join("; ")}. Nothing was stored.`,
          422,
        );
      }
    } catch (error) {
      if (error instanceof TreeError) {
        return await reportFailure(supabase, claim, error.message, error.status);
      }
      throw error;
    }
  }

  /* ── The document the preview shows ────────────────────────────────────
   *
   * Three cases, and the third is the one that did not exist before.
   *
   * A single-page build sends its page, and it is the page. A file-tree build
   * that somehow carries a built export answers with that export. A file-tree
   * build of source — which is every one of them, because nothing here runs
   * `next build` — has no document at all, and previewDocument says so rather
   * than guessing (see tree.ts).
   *
   * For that third case the preview is a summary of what was built: the
   * routes, the tables, the files, and how to run it. Not a mock-up of the
   * app. Rendering something that looked like the storefront would put a
   * picture of a working shop in front of somebody who does not have one,
   * which is the failure the blueprints spend paragraphs forbidding. */
  let html: string;
  let synthesised = false;

  if (sentPage) {
    try {
      html = readGeneratedDocument(body.html);
    } catch (error) {
      if (error instanceof PageHtmlError) {
        return await reportFailure(supabase, claim, error.message, error.status);
      }
      throw error;
    }
  } else {
    const built = previewDocument(tree);
    if (built) {
      html = built;
    } else {
      html = projectSummary({
        projectName: (project.name as string | null) ?? "Your project",
        manifest: summaryArchitecture,
        tree,
        model: summaryModel,
        /* Read from where provisioning stamped it, not from the manifest. The
           manifest says a database was asked for; this says whether it was
           made, and a summary that showed the first as the second would be
           reporting an intention as a fact. */
        databaseReady: summaryBackendReady,
      });
      synthesised = true;
    }
  }

  /* ── The photographs ────────────────────────────────────────────────────
     The page arrives with its pictures declared rather than drawn: an <img>
     carrying the art direction for the photograph that belongs in it, and no
     src. This is where real pixels go in.

     It happens here rather than in the orchestrator for the same reason the
     save happens here at all — nobody is waiting on this request, the page has
     already been generated, and the chat was answered minutes ago. And it
     happens before validation of size, because embedding a dozen photographs
     is what makes a page large and the limit has to be applied to what is
     actually stored.

     Unconfigured is a supported state. With no provider key set, every slot
     keeps the neutral placeholder it shipped with and the page is stored
     exactly as it would have been — so photographs are a deployment decision
     rather than a dependency. */
  /* What was actually asked for, carried into the picture search.
   *
   * Two shops selling cloth write the same "folded fabric" slot and want
   * entirely different photographs — nothing inside one <img> tag can tell them
   * apart, and the brief that produced the page can. It is used only where a
   * slot's own subject came out too generic to search for; a slot that already
   * names its goods precisely is left alone, because a stock search degrades as
   * a query lengthens and diluting a good subject would make it worse.
   *
   * Trimmed hard for the same reason: a search engine wants a few words, not a
   * paragraph of instructions. */
  /* Skipped for a summary this route wrote itself. It declares no photograph
     slots, so filling it would search for nothing and find nothing — and
     `synthesised` is a cheaper way to know that than asking a stock provider. */
  const pictures = synthesised
    ? { html, credits: [], filled: 0, skipped: 0, bytes: 0 }
    : await fillImages(html, providerFromEnv(), {
        context: searchContext(str(body.prompt)),
      });
  html = pictures.html;

  /* Who took them, in the page that publishes them.
   *
   * These were being collected and dropped. Unsplash's guidelines require the
   * photographer and Unsplash to be credited with links back — it is the
   * condition on which the pictures are free, and the first thing checked when
   * an application asks to leave the demo tier. A build that filled a dozen
   * slots and credited nobody was a licence breach on every page it wrote. */
  html = addPhotoCredits(html, pictures.credits);

  if (pictures.filled > 0) {
    // eslint-disable-next-line no-console
    console.info(
      `save: filled ${pictures.filled} of ${pictures.filled + pictures.skipped} image slots (${Math.round(
        pictures.bytes / 1024,
      )}KB)`,
    );
  }

  /* Re-read after filling: the document that gets stored is this one, and the
     size limits are about what is stored. */
  try {
    html = readGeneratedDocument(html);
  } catch (error) {
    if (error instanceof PageHtmlError) {
      return await reportFailure(supabase, claim, error.message, error.status);
    }
    throw error;
  }

  /* ── The quality gates ─────────────────────────────────────────────────
   *
   * Run on the finished document, after the photographs are in it, because
   * that is the artefact somebody will actually look at — a page judged before
   * its images are filled is a page judged in a state that never ships.
   *
   * Only the gates that need no browser run here, and that is a deployment
   * fact rather than a preference: this is a serverless function, a headless
   * Chromium is fifty megabytes and several seconds of cold start, and a
   * project of .tsx cannot be laid out at all until it has been built. The
   * rendered gates run where a browser exists — the CLI, CI — against the same
   * types, and a run without them reports "incomplete" rather than a pass. See
   * src/lib/builder/qa.
   *
   * IT DOES NOT BLOCK THE SAVE. The build is finished and paid for; refusing to
   * store it over a missing alt attribute would throw away work somebody waited
   * for and can fix in one edit. The result is recorded and reported, which is
   * what makes it actionable — a gate that deletes the thing it was judging is
   * a gate people disable. */
  const qa = await runQa({
    html,
    tree,
    manifest: sentArchitecture ? summaryArchitecture : null,
    design: systemByName(body.designSystem),
  });

  const filesTouched = tree.length > 0 ? tree.length : filesTouchedFor(html);

  const { data: inserted, error: insertError } = await supabase.from("project_builds").insert({
    project_id: project.id,
    user_id: claim.userId,
    request_id: claim.requestId || null,
    prompt: str(body.prompt) || "(no prompt recorded)",
    html,
    model: str(body.model) || null,
    files_touched: filesTouched,
  }).select("id").single();

  if (insertError) {
    // eslint-disable-next-line no-console
    console.error("save: the page could not be stored:", insertError);
    /* The one failure here that is nobody's fault but ours, and the one most
       worth saying plainly: the page was built and paid for in model time, and
       it is gone. */
    return await reportFailure(
      supabase,
      claim,
      "The page was built but could not be stored, so nothing changed. Trying again is worth it — this one is at our end.",
      500,
    );
  }

  /* The files, against the build row that now exists.
   *
   * After the build rather than before it, because a file needs a build to
   * belong to. The cost of that order is the window this catches: if the files
   * fail to land, there is already a build row saying a project was stored, and
   * it would be a project consisting of one preview page and nothing else. So
   * the build is deleted again and the whole thing is reported as failed — a
   * half-stored project is worse than no project, because the row claims
   * success. */
  if (tree.length > 0) {
    try {
      await storeTree(
        supabase,
        { buildId: inserted.id as string, projectId: project.id, userId: claim.userId },
        tree,
      );
    } catch (error) {
      await supabase.from("project_builds").delete().eq("id", inserted.id as string);
      // eslint-disable-next-line no-console
      console.error("save: the project's files could not be stored:", error);
      return await reportFailure(
        supabase,
        claim,
        "The project was built but its files could not be stored, so nothing changed. This one is at our end — trying again is worth it.",
        500,
      );
    }
  }

  /* ── Saying what the gates found ───────────────────────────────────────
   *
   * Only when something is actually wrong. A message on every build saying
   * "nothing to fix" is a message people stop reading, and the one time it
   * says something else it is read as noise too.
   *
   * Written as what to do rather than as a score. "3 problems" is a grade;
   * naming the missing alt attributes is something somebody can ask for in one
   * sentence, and the edit path can act on. */
  const qaErrors = qa.status === "failed" ? allIssues(qa).filter((issue) => issue.severity === "error") : [];

  if (qaErrors.length > 0) {
    await recordMessage(supabase, {
      projectId: project.id,
      userId: claim.userId,
      role: "system",
      body: `The build finished, and a check of it found ${qaErrors.length} ${
        qaErrors.length === 1 ? "thing" : "things"
      } worth fixing:\n\n${qaErrors
        .slice(0, 5)
        .map((issue) => `• ${issue.message}`)
        .join("\n")}${
        qaErrors.length > 5 ? `\n\n…and ${qaErrors.length - 5} more.` : ""
      }\n\nAsk me to fix ${qaErrors.length === 1 ? "it" : "them"} and I will.`,
      tone: "normal",
      kind: "build_qa",
      /* Keyed on the build, so a retried save does not say it twice. */
      dedupeKey: `qa:${claim.requestId || project.id}`,
    });
  }

  /* ── What this project IS, written down ────────────────────────────────
   *
   * The manifest and the design system were decided at build time, carried
   * through the orchestrator, used to scaffold — and then dropped. Nothing kept
   * them, so an edit arriving later read the last stored page and nothing else,
   * and could not learn that this project has a database, an admin area and a
   * design system it must stay inside.
   *
   * Recorded per project rather than per build, because that is the question an
   * edit asks: not "what did the build in March decide" but "what is this
   * project". Best effort — a project whose architecture row fails to write is
   * a project whose next edit is less informed, which is where it already was,
   * and is not a reason to fail a build that succeeded. */
  await supabase
    .from("project_architecture")
    .upsert(
      {
        project_id: project.id,
        user_id: claim.userId,
        kind: summaryArchitecture.type,
        manifest: summaryArchitecture,
        design_system: typeof body.designSystem === "string" ? body.designSystem : null,
        stack: tree.length > 0 ? "nextjs" : "standalone-html",
      },
      { onConflict: "project_id" },
    )
    .then(({ error }) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.error("save: the architecture was not recorded:", error.message);
      }
    });

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
  /* The moment this build landed, held rather than inlined: it stamps the row
     the workspace watches, and it is also what names this build in the thread
     when the workflow did not send a request id. */
  const landedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("projects")
    .update({
      status: "Built",
      intent: "webapp",
      preview_url: previewUrl,
      last_build_at: landedAt,
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

  /* ── The conversation is told, from here ─────────────────────────────────
     This used to be the browser's job: the panel polled the project row, saw
     the page land, and wrote "your page is ready" into the thread itself. Which
     worked exactly as long as the tab stayed open. Close it during a build —
     two minutes is long enough that people do — and the page was built, stored
     and charged for, while the conversation stopped at "your build is underway"
     and stayed there. There was nothing to carry on from.

     So the announcement is written where the build actually finishes. It is in
     the thread whether or not anyone is watching, it carries the preview
     address, and it is keyed on the build's own request id so a save delivered
     twice does not say it twice.

     Written before the charge, and the charge is skipped if it cannot be
     written: a build nobody can find in their conversation is not one that was
     delivered. */
  const announced = await recordAndConfirm(supabase, {
    projectId: project.id,
    userId: claim.userId,
    role: "system",
    body: "Your page is ready.",
    /* Both addresses, and the file is one of them.
       The card under this message offers Download and Publish for a few minutes
       and then takes them away, which is what a shortcut should do. These links
       are the lasting way to the same page, so the row holds them back while
       those buttons are up — offering it twice in one reply reads as two
       destinations — and shows them once the buttons go. They do not expire,
       because "I built this last week, give me the file" is a reasonable thing
       to want and the conversation is where someone goes back to look for it. */
    links: [
      { label: "Open preview", href: previewUrl },
      { label: "Download the page", href: `${previewUrl}?download=1` },
    ],
    kind: "build_ready",
    dedupeKey: `ready:${claim.requestId || landedAt}`,
  });

  if (!announced) {
    // eslint-disable-next-line no-console
    console.error("save: the page was stored but could not be announced; not charging for it.");
    return NextResponse.json({ previewUrl, filesTouched, qa });
  }

  /* Not for a page nobody can see.
   *
   * A project can be deleted while its build is still running — a minute in,
   * somebody decides they worded it wrong, bins it and starts again. The page
   * lands afterwards and this route stores it against a row the app no longer
   * shows anywhere, so what the person experienced was eight credits leaving
   * their balance for a build they never saw. That happened, on 2026-09-06, to
   * the person who owns this code.
   *
   * The page is still stored, deliberately: `deleted_at` is a soft delete, and
   * a project brought back should have the page its build produced. What does
   * not happen is the charge. Charging is for work somebody received, and the
   * whole of what they received here is a row in a table they cannot open.
   *
   * Priced from the page, and only now that there is a page. filesTouchedFor
   * reads the document rather than trusting a field in the request, so a
   * workflow anyone with n8n access can edit cannot talk the price down. */
  if (project.deleted_at) {
    // eslint-disable-next-line no-console
    console.info(`save: ${project.id} was deleted while its build ran; storing the page, not charging for it.`);
    return NextResponse.json({ previewUrl, filesTouched, charged: false, qa });
  }

  /* charge_credits rather than spend_credits: the build has happened and the
     model has been paid for, so a refusal here would not undo it — it would
     just leave the work unrecorded and the balance where it was, which is the
     bug this replaces. It takes what the account holds and reports the rest,
     so an overdraft lands at zero and the next build is turned away at the
     door. The result is not returned to n8n: what an account owes is between
     the app and its owner. */
  /* The page, and the conversation that was carried into it.
   *
   * A build charged here is charged minutes and one HTTP hop from where its
   * context was assembled, so the length is read back out of the brief itself
   * — see carriedContextLength. Nothing extra travels through the orchestrator
   * to make this work, which is the point: a price that depends on a field
   * somebody has to remember to add to a canvas is a price that will one day
   * silently be zero. */
  const pageCost = creditCostOf("generate", { filesTouched, modelId: str(body.model) || undefined });

  /* The brief that built this page, as its two halves: the description carried
     from earlier in the conversation, and the message somebody actually sent.
     Each gets its own 300 free words, the same as every other turn — the seam
     between them is what carriedContextWords reads. A brief nobody continued
     has one half and a carried count of zero. */
  const brief = str(body.prompt);
  const carriedWords = carriedContextWords(brief);
  const contextCost = contextSurcharge([carriedWords, countWords(brief) - carriedWords]);

  await chargeCredits(supabase, {
    userId: claim.userId,
    action: "generate",
    /* The model n8n reports, which is the one the app sent in a signed
       request and the workflow forwarded — not a browser's word for it. */
    cost: roundCredits(pageCost + contextCost),
    description:
      contextCost > 0
        ? `Build: ${str(body.prompt).slice(0, 40) || "new page"} — ${formatCredits(pageCost)} + ${formatCredits(contextCost)} context`
        : `Build: ${str(body.prompt).slice(0, 60) || "new page"}`,
    projectId: project.id,
    filesTouched,
    /* The most expensive charge in the system, and the one most exposed to
       arriving twice: n8n retries a webhook it believes failed, and a build
       whose save is redelivered would otherwise be paid for twice — eighty
       credits off a Pro account's three hundred for one page.
     *
     * claim.requestId is the right name for it because it comes from the
     * SIGNED claim: it is the app's own id for this build, carried through the
     * workflow and returned, not something the caller can vary to charge again.
     * The same id already dedupes the message on line 240.
     *
     * Falling back to the project id when there is no requestId is deliberate.
     * A build with no request behind it is one save per project, and charging
     * that once is the safer error. */
    dedupeKey: `build:${claim.requestId || project.id}`,
  });

  return NextResponse.json({ previewUrl, filesTouched, qa });
}
