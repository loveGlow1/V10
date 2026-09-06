import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { creditCostOf } from "@/app/dashboard/credits";
import { verifyBuildClaim } from "@/lib/build-signature";
import { chargeCredits } from "@/lib/credits-server";
import { fillImages, searchContext } from "@/lib/builder/images";
import { addPhotoCredits } from "@/lib/builder/photo-credits";
import { providerFromEnv } from "@/lib/builder/image-providers";
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

     There is a live example. The orchestrator's `Generate With Claude` node
     fans its success output out to TWO nodes: `Collect Generation`, which is
     right, and this route directly, which is not — that edge posts the raw
     Anthropic response, which has no `html` field at all, seconds before the
     real document arrives through `Extract Page`. See the DEPLOYED DEFECT note
     in n8n/build-orchestrator.workflow.ts. Refused here as a bad request,
     without touching the project row and without a word in the thread, because
     the build it would be reporting as failed is the one about to land.

     This route can only decline to make it worse. The node's error output still
     runs Flag Build Failure on that first call, and the fix for that is one
     deleted connection in n8n. */
  if (typeof body.html !== "string" || !body.html.trim()) {
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

  let html: string;
  try {
    html = readGeneratedDocument(body.html);
  } catch (error) {
    if (error instanceof PageHtmlError) {
      return await reportFailure(supabase, claim, error.message, error.status);
    }
    throw error;
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
  const pictures = await fillImages(html, providerFromEnv(), {
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
    return NextResponse.json({ previewUrl, filesTouched });
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
    /* The model n8n reports, which is the one the app sent in a signed
       request and the workflow forwarded — not a browser's word for it. */
    cost: creditCostOf("generate", { filesTouched, modelId: str(body.model) || undefined }),
    description: `Build: ${str(body.prompt).slice(0, 60) || "new page"}`,
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

  return NextResponse.json({ previewUrl, filesTouched });
}
