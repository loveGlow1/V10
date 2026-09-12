import Anthropic from "@anthropic-ai/sdk";

import { modelById } from "@/app/dashboard/models";

import {
  PICK_SYSTEM,
  type FilePick,
  homePageOf,
  neighbourBrief,
  pickFileLocally,
  pickPrompt,
  readPick,
} from "./pick-file";
import { type FileTree, describeTree } from "./tree";
import {
  applyLineEdits,
  applyPatches,
  describeFailures,
  noteAfterPatches,
  numberLines,
  type PatchFailure,
} from "./patch";
import {
  CLARIFY_SYSTEM,
  EDIT_SYSTEM,
  LINES_SYSTEM,
  QUESTION_SYSTEM,
  SOURCE_SYSTEM,
  clarifyPrompt,
  editPrompt,
  linesPrompt,
  questionPrompt,
  retryPrompt,
  sourcePrompt,
} from "./prompts";

/* The two model calls that run in the app rather than in the orchestrator.
 *
 * Both are short. An edit answers with a few hundred tokens of patch and a
 * question with a paragraph, so both finish in seconds and fit comfortably
 * inside the sixty a serverless function is allowed — which is exactly why a
 * full build does not live here. Generating a whole page takes minutes and runs
 * in n8n; changing one that exists does not, and should not make someone wait
 * as though it did. */

/* Haiku, the same as Auto — see AUTO_MODEL in dashboard/models.ts, which
   carries the reasoning and the tradeoff.
 *
 * This one is arguably the bigger saving of the two. A build happens once; an
 * edit or a question happens all afternoon, and each one sends the WHOLE page
 * as input before the model says anything. That input is the cost, it is paid
 * per turn, and it was being paid at Opus rates on every "make the heading
 * bigger".
 *
 * The work here suits it. Deciding which lines to change and copying them
 * exactly is careful rather than hard — the call already runs at `effort: low`
 * on that reasoning, which is an odd setting to pair with the most expensive
 * model in the range.
 *
 * NOTE: the composer's model picker still does not reach this — pick Opus for
 * a build and the edits afterwards are chosen here, not there. What IS chosen
 * here is which of the two below: see editModelFor. */
export const EDIT_MODEL = "claude-haiku-4-5";

/* The one to reach for when the edit is not a small edit.
 *
 * EDIT_MODEL's own entry in the catalogue reads "Fastest, for small edits", and
 * that is exactly what it is good at: somebody names a section, says what it
 * should become, and the change is a search and a replace.
 *
 * "Delete the part shown in this photograph" is not that. It is three jobs —
 * read a picture of a rendered page, work out which markup produced it, then
 * copy that markup character for character — and the fast model failed the
 * middle one twice on the same page, answering "I couldn't place that change"
 * for a section the person was pointing directly at.
 *
 * So the work decides the model. A message carrying a picture starts here, and
 * an edit that placed nothing tries again here rather than asking the same
 * model the same question a second time. Sonnet costs more per token than Haiku
 * and less than an edit that does not happen. */
export const EDIT_MODEL_STRONG = "claude-sonnet-5";

/* Where "small edit" stops, measured on the instruction.
 *
 * Three hundred words, matching the free brief allowance in credits.ts — not
 * for tidiness but because they measure the same thing from two directions.
 * Under it is somebody naming a change; over it is somebody specifying one, and
 * a specification is a thing that has to be held in mind while it is carried
 * out, which is what the fast model is fast at not doing. */
const SIMPLE_EDIT_WORDS = 300;

/* And where the PAGE stops being small, whatever the instruction says.
 *
 * A one-line change to a very large page still sends the whole page. At roughly
 * four characters per token, 400,000 characters is about 100,000 tokens — half
 * of Haiku's 200K window before the instruction, the reasoning or the reply are
 * counted. Past this the size of the page decides, not the size of the ask.
 * This is the case that reads as simple and is not. */
const SIMPLE_EDIT_PAGE_CHARS = 400_000;

/**
 * Which model makes this change, on the size of the job.
 *
 * A third reason to reach for the strong one, alongside the two editPage
 * already had — a picture in the message, and a first attempt that placed
 * nothing. Those two are about what the work IS; this one is about how much of
 * it there is, and it is the only one of the three that can be known before any
 * call is made.
 *
 * The bias is deliberate. Routing a large edit to the cheaper model does not
 * save the money; it spends it on an edit that half-lands and a person asking
 * again — and on this path that second ask is a retry that goes to the strong
 * model anyway, having already paid for the first.
 */
export function editModelFor(prompt: string, html: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  if (words > SIMPLE_EDIT_WORDS) return EDIT_MODEL_STRONG;
  if (html.length > SIMPLE_EDIT_PAGE_CHARS) return EDIT_MODEL_STRONG;
  return EDIT_MODEL;
}

/* How long an instruction may be is no longer a constant, and this is where it
 * used to be.
 *
 * It was maxEditPromptChars: 80,000 characters for Haiku, 600,000 for Sonnet,
 * counted against the message alone and used to refuse the person. Characters
 * are not what a model measures, and the message is not what fills a window —
 * the page, the carried conversation and every attached screenshot go into the
 * same one, and the screenshots were counted as free.
 *
 * fitEdit in src/lib/context/requests.ts measures all of it in tokens against
 * the chosen model's real window, reserves room for the reply, and restructures
 * the instruction instead of refusing it. See the note at the top of that file. */

/* Room for the reply to an edit.
 *
 * It was 8,000, which is generous for the blocks themselves — a change is a few
 * hundred tokens of markup — and is not what this number has to cover. On a
 * model that thinks before it writes, the thinking comes out of the same
 * allowance, so a careful read of a forty-thousand-character page can spend
 * most of it before the first block is written. What comes back then is a
 * truncated block with no closing marker, which parses as no blocks at all.
 *
 * Raised until that cannot be what happened, and still small enough to finish
 * inside the sixty seconds this route is allowed: a reply of this size is a few
 * hundred tokens of patch and whatever thinking preceded it, not thirty
 * thousand tokens of document. See ranOutOfRoom, which now checks. */
const PATCH_TOKENS = 24_000;

/**
 * The headings this page actually has, for the sentence that asks somebody to
 * name a section.
 *
 * Read out of the markup rather than assumed. The advice used to be "the hero,
 * the nav, the footer" — a guess at what any page contains, given to somebody
 * who had just pointed at a particular part of theirs, and possibly naming two
 * things their page does not have.
 *
 * Six at most, and short ones only: this is a prompt for the next message, not
 * a table of contents.
 */
export function sectionsHint(html: string): string {
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]{1,80}?)<\/h[1-3]>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 2 && text.length <= 40);

  const named = [...new Set(headings)].slice(0, 6);
  if (named.length === 0) {
    return " Naming the section you mean, in words that appear on the page, usually sorts it.";
  }

  return ` Try naming the section — this page has ${named
    .map((text) => `"${text}"`)
    .join(", ")}.`;
}

export class EditError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly failures: PatchFailure[] = [],
  ) {
    super(message);
    this.name = "EditError";
  }
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/* An answer that ran out of room, told apart from an answer that was finished.
 *
 * max_tokens caps the whole reply, and on a model that thinks before it writes
 * the thinking is inside that cap. A call that hits the ceiling comes back
 * looking ordinary — no error, a Message object, `content` populated — and its
 * last block simply stops. A half-written search block has no closing marker,
 * so the parser finds no blocks at all, and the person is told their change
 * could not be placed in the page: a sentence about their words, describing a
 * fault in our budget.
 *
 * So it is asked, and it is said out loud. It is also the one failure here that
 * retrying identically cannot fix. */
function ranOutOfRoom(message: Anthropic.Message): boolean {
  return message.stop_reason === "max_tokens";
}

/* When to stop writing and keep what is written.
 *
 * /api/build runs on a serverless function with a hard ceiling — maxDuration in
 * that route — and a full-page restyle asked for as an edit genuinely reaches
 * it: a real edit died at 1m 1s having completed six blocks, and every one of
 * them was thrown away because the platform killed the function rather than the
 * code returning. No answer, no error anybody can act on.
 *
 * So this stops first, deliberately, with enough room left to apply what it
 * has. A partial edit is a real outcome — applyPatches works block by block and
 * the finished ones are correct — and six changes applied with a sentence
 * saying the rest ran out of time beats a minute of work discarded and "try it
 * again", which invites the identical failure.
 *
 * It is a budget for the WHOLE edit rather than for one call, which is what
 * makes it worth having now: editPage will make up to three attempts, and three
 * attempts of PATCH_TOKENS each cannot fit in sixty seconds. A per-call limit
 * would let the first two spend the lot and the third be killed by the
 * platform, which is the failure this exists to prevent. */
const EDIT_DEADLINE_MS = 45_000;

/* Replies that were abandoned on the clock rather than finished.
 *
 * Held beside the message instead of inside it: the synthetic Message below has
 * to be indistinguishable from a real one everywhere downstream — textOf reads
 * it, applyPatches takes the complete blocks out of it — and a fake stop_reason
 * would have made it indistinguishable from ranOutOfRoom too, which is a
 * different failure needing a different sentence. */
const cutShort = new WeakSet<Anthropic.Message>();

function ranOutOfTime(message: Anthropic.Message): boolean {
  return cutShort.has(message);
}

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new EditError("I can't make edits yet — this workspace has no ANTHROPIC_API_KEY set.", 503);
  }
  return new Anthropic();
}

/* What the model is doing, reported by the model.
 *
 * The tracker used to say "claude-opus-5 is writing the change…" for the whole
 * of a fifteen-second call. That sentence is true, but it is written here — it
 * is the same words whatever was asked for, which is a placeholder wearing a
 * progress bar's clothes. This is the actual thing: the reasoning Claude
 * summarises as it works, and the count of patch blocks as they are written.
 *
 * `reasoning` is the model's own summarised thinking. It requires asking for
 * it: on Claude Opus 5 the default is `display: "omitted"`, which streams
 * thinking blocks with the text stripped out — so without the opt-in below
 * there is nothing to show and the panel would be back to inventing a line. */
export type Progress =
  | { kind: "reasoning"; text: string }
  | { kind: "writing"; blocks: number }
  /* The answer itself, arriving. Only ever emitted where the text being
     written IS the reply — a question, a clarification — and never on an edit,
     whose output is search/replace blocks that would be gibberish in a chat
     bubble. See `streamAnswer` on ask(). */
  | { kind: "answer"; delta: string };

export type OnProgress = (progress: Progress) => void;

/* How often progress is passed on. The deltas arrive many times a second and
   the panel is a line of text a person is reading; anything faster than this is
   a blur, and every one of them is also a line over the wire. */
const PROGRESS_EVERY_MS = 600;

/* How often answer text is passed on, which is a different question from the
   line above and wants a different answer.
 *
 * That one paces a sentence somebody reads: faster than 600ms and the line
 * blurs. This one paces a reply appearing, and there the eye wants continuity
 * rather than legibility — anything much over 80ms stops reading as writing and
 * starts reading as chunks landing.
 *
 * Not zero, though. Deltas arrive many times a second, and one line over the
 * wire per token would be a great deal of framing for a few characters. Fifty
 * milliseconds is twenty updates a second, which is past what anyone can
 * distinguish from continuous. */
const ANSWER_EVERY_MS = 50;

/* The last thing Claude finished saying, short enough for one line.
 *
 * Taken from the end rather than the start: the reasoning is a running
 * narration, and the sentence being worked on now is the one worth showing.
 * An unfinished trailing fragment is dropped — half a sentence appearing a word
 * at a time reads as a typing effect, which is the fake this is replacing. */
export function lastSentence(text: string): string | null {
  const finished = text.replace(/\s+/g, " ").trimEnd();
  const sentences = finished.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0);

  /* The final element is only a sentence if it is punctuated; otherwise it is
     what the model is still writing, and the one before it is the last thing it
     actually finished. */
  const complete = /[.!?]$/.test(finished) ? sentences : sentences.slice(0, -1);
  const latest = complete[complete.length - 1];
  if (!latest) return null;

  const trimmed = latest.trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
}

async function ask(
  system: string,
  prompt: string,
  maxTokens: number,
  /* Files the person attached, as blocks. They go BEFORE the text, because the
     text refers to them — "match this screenshot" reads as an instruction only
     once the screenshot is already in view. */
  attachments: Anthropic.ContentBlockParam[] = [],
  /* What was said before this message, as turns rather than as a preamble
     pasted into one. Without them "make it darker too" has no "too", and
     "change the other one as well" names nothing — see builder/brief.ts. */
  prior: Anthropic.MessageParam[] = [],
  onProgress?: OnProgress,
  /* Whether the text this call produces is the reply itself.
   *
   * True for a question or a clarification, where what the model writes is what
   * the person reads. False for an edit, where it is a stream of
   * <<<<<<< SEARCH blocks — forwarding those to a chat bubble would fill it
   * with the diff instead of the answer. The default is the safe one. */
  streamAnswer = false,
  /* Which model does this one. Defaults to the fast one, because most edits are
     small ones — see EDIT_MODEL_STRONG for when they are not. */
  model: string = EDIT_MODEL,
  /* When this call must stop, as a clock time rather than a duration: the
     budget belongs to the edit, not to the attempt, so later attempts inherit
     what the earlier ones left. Absent, it runs to completion, which is right
     for the short calls. */
  deadlineAt?: number,
): Promise<Anthropic.Message> {
  try {
    /* Streamed rather than awaited whole, and the streaming is the point: the
       events are the only source of what is happening while it happens. The
       final message is still what the caller gets, so nothing downstream
       changes shape. */
    const stream = client().messages.stream({
      model: modelById(model).apiId ?? model,
      max_tokens: maxTokens,
      /* Sent only to a model that takes them. Haiku 4.5 predates both fields
         and answers `output_config.effort` with a 400 rather than ignoring it,
         so they travel together and only when the catalogue says so.

         Where they do apply: adaptive thinking at low effort, because working
         out which lines to change and copying them exactly is careful work
         rather than hard work, and this call is on the path of someone
         watching a cursor. `display: "summarized"` is what makes that
         reasoning readable at all — the default omits it, and the raw chain of
         thought is never returned by any model.

         With reasoning off there is simply no thinking to narrate, and the
         progress handler below renders an empty string for it, which is the
         correct thing to show for a model that does not think out loud. */
      ...(modelById(model).reasoning === "none"
        ? {}
        : {
            thinking: { type: "adaptive" as const, display: "summarized" as const },
            output_config: { effort: "low" as const },
          }),
      system,
      messages: [
        ...prior,
        {
          role: "user",
          content:
            attachments.length > 0
              ? [...attachments, { type: "text" as const, text: prompt }]
              : prompt,
        },
      ],
    });

    let stopped = false;

    if (onProgress) {
      let reasoning = "";
      let written = "";
      let lastSent = 0;
      let lastLine = "";
      /* Answer text held back since it was last passed on. Coalesced rather
         than dropped: every character arrives, just fewer times. */
      let pending = "";
      let lastAnswerAt = 0;

      for await (const event of stream) {
        /* Checked on every event rather than on a timer, so the stream is left
           at a block boundary the parser can read rather than mid-token. */
        if (deadlineAt !== undefined && Date.now() > deadlineAt) {
          stopped = true;
          stream.abort();
          break;
        }

        if (event.type !== "content_block_delta") continue;

        if (event.delta.type === "thinking_delta") {
          reasoning += event.delta.thinking;
        } else if (event.delta.type === "text_delta") {
          written += event.delta.text;
          if (streamAnswer) pending += event.delta.text;
        } else {
          continue;
        }

        /* The reply, on its own clock. Ahead of the throttle below because it
           is a different thing being paced — see ANSWER_EVERY_MS. */
        if (streamAnswer && pending) {
          const since = Date.now() - lastAnswerAt;
          if (since >= ANSWER_EVERY_MS) {
            onProgress({ kind: "answer", delta: pending });
            pending = "";
            lastAnswerAt = Date.now();
          }
        }

        const now = Date.now();
        if (now - lastSent < PROGRESS_EVERY_MS) continue;
        lastSent = now;

        /* Once blocks are being written the reasoning is over, and the count is
           both more useful and more certain than the last thing it said. */
        const blocks = (written.match(/<{7} SEARCH/g) ?? []).length;
        if (blocks > 0) {
          onProgress({ kind: "writing", blocks });
          continue;
        }

        const line = lastSentence(reasoning);
        if (line && line !== lastLine) {
          lastLine = line;
          onProgress({ kind: "reasoning", text: line });
        }
      }

      /* Whatever the last window was still holding. Without this the closing
         few characters of every reply are dropped — a coalescing loop that
         never flushes truncates by design, and the caller's final message would
         disagree with what the reader watched arrive. */
      if (pending) onProgress({ kind: "answer", delta: pending });

      if (stopped) {
        /* finalMessage() waits for a stream that has been abandoned. What was
           written is already in hand, and shaped as a Message so that nothing
           downstream has to know this happened — the incomplete last block
           simply fails to place, which is what applyPatches already does with
           any block that does not match. */
        const partial = {
          id: "partial",
          type: "message",
          role: "assistant",
          model,
          content: [{ type: "text", text: written, citations: null }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: Math.ceil(written.length / 4),
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            server_tool_use: null,
            service_tier: null,
          },
        } as unknown as Anthropic.Message;
        cutShort.add(partial);
        return partial;
      }
    }

    return await stream.finalMessage();
  } catch (error) {
    if (error instanceof EditError) throw error;

    /* A file the API would not take must not take the edit down with it.
     *
       Every check that can be made on the bytes is made before they are sent
       (see sniffImage in builder/attachments.ts), and a 400 that still arrives
       with attachments in the request means something about one of them was
       refused for a reason this side could not see — an image the decoder
       rejects, dimensions past a limit, a PDF that is not one.
     *
       The change somebody asked for usually has nothing to do with the picture,
       so it is tried once more without the files rather than abandoned. What
       comes back is a real edit; the caller says the attachment was left out,
       so nobody is told a photograph was used when it was not. */
    if (error instanceof Anthropic.BadRequestError && attachments.length > 0) {
      // eslint-disable-next-line no-console
      console.error("edit: retrying without the attachments after:", error.message);
      return await ask(system, prompt, maxTokens, [], prior, onProgress, streamAnswer, model, deadlineAt);
    }

    if (error instanceof Anthropic.AuthenticationError) {
      throw new EditError("The ANTHROPIC_API_KEY this workspace is using was rejected — it will need replacing before I can edit.", 502);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new EditError("I'm rate limited at the moment. Send that again in a few seconds and it should go through.", 429);
    }
    /* A 400 is not "could not reach". The request arrived, was read, and was
       refused — and the API says why in a sentence. That sentence used to be
       thrown away and replaced with a status code, so a photograph the model
       could not decode reached somebody as "HTTP 400", which names nothing they
       can do anything about and nothing anybody debugging it could use either.
     *
       Logged whole, and the API's own words are passed on. They are written for
       a developer rather than for the person in the chat, which is why the
       sentence around them says what it means for their page. */
    if (error instanceof Anthropic.BadRequestError) {
      // eslint-disable-next-line no-console
      console.error("edit: the model refused the request:", error.message);
      throw new EditError(
        `The model refused that request, so nothing was changed. ${error.message}`,
        400,
      );
    }
    if (error instanceof Anthropic.APIError) {
      throw new EditError(`I couldn't reach the model (HTTP ${error.status}). Nothing was changed — try that again.`, 502);
    }
    throw new EditError("I couldn't reach the model, so nothing was changed. Try that again.", 502);
  }
}

export type EditOutcome = {
  html: string;
  applied: number;
  /** Blocks that were refused even though others landed. Worth surfacing. */
  failures: PatchFailure[];
  /** What the call cost, reported by the API rather than guessed. */
  outputTokens: number;
  /** Whether the first attempt had to be retried. Real, and worth showing. */
  retried: boolean;
  /* Whether writing was cut short by the time budget. True means the blocks in
     `applied` are correct and complete but the change as a whole is not — the
     person needs to be told there is more to ask for rather than left to spot
     it. See EDIT_DEADLINE_MS. */
  ranOutOfTime: boolean;
  /* Which model actually made the change. An edit can escalate — a picture in
     the message, or a first attempt that placed nothing — and the charge has to
     follow the model that did the work rather than the one that usually does
     it. */
  model: string;
  /* How the change was made in the end: by quoting the page, or by naming line
     numbers after quoting it had failed twice. Reported rather than hidden —
     the second route is the weaker one, and which route an edit took is the
     first thing worth knowing when one lands wrong. */
  route: "patch" | "lines";
  /* The one next step the model was allowed to offer after its blocks, when it
     had one worth offering. It rides on the edit call rather than costing a
     second one — the model has just read the page closely enough to patch it,
     which is exactly when it knows what is now inconsistent with the change. */
  note: string | null;
};

/**
 * Applies a described change to a page. Throws {@link EditError} when nothing
 * could be applied — and in that case the page is left exactly as it was.
 */
/**
 * Which file in a project an instruction is about.
 *
 * Local rules first and a model only when they run out — see pick-file.ts,
 * which carries the reasoning. The call, when it happens, is the cheapest one
 * in the pipeline: the file LISTING goes over, not the files, so choosing among
 * forty of them costs a few hundred tokens rather than the whole project.
 *
 * Never throws. Everything here has a fallback, because failing to choose must
 * degrade to editing the home page rather than to refusing an edit somebody
 * asked for.
 */
export async function pickFile(
  userMessage: string,
  tree: FileTree,
  onProgress?: OnProgress,
): Promise<FilePick | null> {
  const local = pickFileLocally(userMessage, tree);
  if (local) return local;

  onProgress?.({ kind: "reasoning", text: "Working out which file that belongs in…" });

  try {
    const answer = await ask(
      PICK_SYSTEM,
      pickPrompt(userMessage, describeTree(tree)),
      /* One path. Anything past this is the model explaining itself, which it
         was told not to do and which readPick discards anyway. */
      100,
      [],
      [],
      undefined,
      false,
      EDIT_MODEL,
    );

    const path = readPick(textOf(answer), tree);
    if (path) return { path, why: "model" };
  } catch {
    /* A picker that cannot run must not take the edit down with it. */
  }

  const home = homePageOf(tree);
  return home ? { path: home, why: "convention" } : null;
}

export async function editPage(
  userMessage: string,
  html: string,
  attachments: Anthropic.ContentBlockParam[] = [],
  prior: Anthropic.MessageParam[] = [],
  onProgress?: OnProgress,
  /* What the project is, and what this change may not touch — see
     src/lib/builder/edit-plan.ts, editPlanBrief. Optional, and absent for every
     project built before the architecture was recorded: the edit then behaves
     exactly as it did, which is the correct fallback when nothing is known. */
  architecture?: string,
): Promise<EditOutcome> {
  /* A picture in the message changes what this call is. The model has to read
     the photograph, find the markup behind what it shows, and copy that markup
     exactly — and the fast model is chosen for the last of those three, not the
     middle one. See EDIT_MODEL_STRONG. */
  const looking = attachments.some((block) => block.type === "image");
  /* Or the job is simply large — a brief of several paragraphs, or a page too
     big to leave the fast model room to work in. Either reason is enough on its
     own; see editModelFor. */
  const model = looking ? EDIT_MODEL_STRONG : editModelFor(userMessage, html);

  /* One clock for the whole edit, started before the first call and inherited
     by the retries. See EDIT_DEADLINE_MS. */
  const deadlineAt = Date.now() + EDIT_DEADLINE_MS;

  const first = await ask(
    EDIT_SYSTEM,
    editPrompt(userMessage, html, architecture),
    PATCH_TOKENS,
    attachments,
    prior,
    onProgress,
    false,
    model,
    deadlineAt,
  );

  if (first.stop_reason === "refusal") {
    throw new EditError("I wasn't able to make that change. If you can say which part of the page you mean, I'll try again.", 422);
  }

  /* A reply that stopped mid-block, said out loud in the retry rather than
     described as "you returned no blocks" — which is what the model was told
     before, and is an accusation about its answer rather than a fact about the
     room it was given. */
  if (ranOutOfRoom(first)) {
    // eslint-disable-next-line no-console
    console.error("edit: the first attempt hit max_tokens before finishing a block");
  }

  let output = textOf(first);
  let result = applyPatches(html, output);
  let outputTokens = first.usage?.output_tokens ?? 0;
  let retried = false;

  /* Out of time on the first attempt, which is its own answer and not a reason
     to start a second. The retries below exist for a model that got the change
     wrong; this model was getting it right and was interrupted, and there is by
     definition no budget left to interrupt it again in.
   *
     So what landed is kept. If nothing landed there is nothing to keep, and the
     honest sentence is that the change is too large to make in one go — which
     is a different thing to tell somebody than "I couldn't place that". */
  if (ranOutOfTime(first)) {
    if (result.applied === 0) {
      throw new EditError(
        "That change is bigger than I can make in one go, so I've left the page exactly as it was. Ask for it a section at a time — the hero first, then the rest — and each one will land.",
        422,
      );
    }

    return {
      html: result.html,
      applied: result.applied,
      failures: result.failures,
      note: noteAfterPatches(output),
      outputTokens,
      retried: false,
      ranOutOfTime: true,
      model,
      route: "patch",
    };
  }

  /* One retry, and only when nothing at all landed. A partial success is left
     alone: re-running it would apply the blocks that already worked a second
     time, against a page they have already changed. */
  if (result.applied === 0) {
    const reason = ranOutOfRoom(first)
      ? "Your previous attempt ran out of room before it finished a block. Keep the blocks small — several precise ones rather than one that rewrites a section."
      : result.failures.length
        ? describeFailures(result.failures)
        : "You returned no search/replace blocks.";

    /* The second attempt reports too, and says so: a retry that narrated
       itself as a first attempt would hide the one thing worth knowing about
       it. */
    /* The retry always goes to the better model. Asking the same model the same
       question a second time is the definition of hoping, and it is what this
       used to do: two attempts, one model, one answer, and a person told twice
       that their change could not be placed. */
    onProgress?.({
      kind: "reasoning",
      text: `That didn't place cleanly. Reading the page again with ${EDIT_MODEL_STRONG}…`,
    });

    const second = await ask(
      EDIT_SYSTEM,
      retryPrompt(userMessage, html, reason, architecture),
      PATCH_TOKENS,
      attachments,
      prior,
      onProgress,
      false,
      EDIT_MODEL_STRONG,
      deadlineAt,
    );
    output = textOf(second);
    result = applyPatches(html, output);
    outputTokens += second.usage?.output_tokens ?? 0;
    retried = true;

    /* Same again for the retry, and the reason it has to be repeated rather
       than folded into the check below: `applied === 0` is what starts the
       third attempt, and starting it on an exhausted clock would abort it
       immediately and report "I couldn't place that change" for an edit nobody
       ever gave the time to try. */
    if (ranOutOfTime(second)) {
      if (result.applied === 0) {
        throw new EditError(
          "That change is bigger than I can make in one go, so I've left the page exactly as it was. Ask for it a section at a time — the hero first, then the rest — and each one will land.",
          422,
        );
      }

      return {
        html: result.html,
        applied: result.applied,
        failures: result.failures,
        note: noteAfterPatches(output),
        outputTokens,
        retried: true,
        ranOutOfTime: true,
        model: EDIT_MODEL_STRONG,
        route: "patch",
      };
    }

    if (result.applied === 0) {
      /* ── Stop asking it to quote the page ──────────────────────────────
       *
       * Twice now the model has been asked to copy text out of the document
       * and has written something that is not in it. Asking a third time is
       * the same question again, and the honest reading of two failures is
       * that copying is what it is getting wrong — not the change itself,
       * which in the conversation that produced this fix was "delete this
       * card" with the card's own words quoted in the message.
       *
       * So the last attempt changes the job rather than the model. The page
       * goes over with line numbers down the margin and the model names a
       * range. There is nothing to transcribe, so the failure that got us
       * here cannot happen; see LINES_SYSTEM for what it gives up in
       * exchange, and why that trade is the right one at this point and not
       * before it. */
      const whyPatchesFailed = result.failures.length
        ? describeFailures(result.failures)
        : "Both attempts returned no usable search/replace blocks.";

      onProgress?.({
        kind: "reasoning",
        text: "Quoting the page isn't landing. Reading it by line number instead…",
      });

      const numbered = numberLines(html);
      const third = await ask(
        LINES_SYSTEM,
        linesPrompt(userMessage, numbered, whyPatchesFailed, architecture),
        PATCH_TOKENS,
        attachments,
        prior,
        onProgress,
        false,
        EDIT_MODEL_STRONG,
        deadlineAt,
      );

      const byLine = applyLineEdits(html, textOf(third));
      outputTokens += third.usage?.output_tokens ?? 0;

      if (byLine.applied > 0) {
        return {
          html: byLine.html,
          applied: byLine.applied,
          failures: byLine.failures,
          note: noteAfterPatches(textOf(third)),
          outputTokens,
          retried: true,
          ranOutOfTime: ranOutOfTime(third),
          model: EDIT_MODEL_STRONG,
          route: "lines",
        };
      }

      /* Three attempts, two different ways of describing a change, and
         nothing landed. Now it is worth saying so.
       *
         And the sentence says which of the two things went wrong, because
         they need different answers from the person reading it. Running out
         of room is our fault and rephrasing will not help; not finding the
         part is theirs to point at, and the headings are read out of their
         own markup so they can name one. */
      if (ranOutOfRoom(third)) {
        throw new EditError(
          "That change came back longer than one edit can carry, so I've left the page exactly as it was. Asking for one section at a time will go through.",
          422,
          byLine.failures,
        );
      }

      throw new EditError(
        `I couldn't place that change in the page, so I've left it exactly as it was.${sectionsHint(html)}`,
        422,
        [...result.failures, ...byLine.failures],
      );
    }
  }

  return {
    html: result.html,
    applied: result.applied,
    failures: result.failures,
    /* Read from the output that actually landed, so a retry's note replaces the
       first attempt's rather than both being in play. */
    note: noteAfterPatches(output),
    outputTokens,
    retried,
    ranOutOfTime: false,
    /* The retry always runs on the stronger model, so a retried edit was
       finished by it whatever the first attempt used. */
    model: retried ? EDIT_MODEL_STRONG : model,
    route: "patch",
  };
}

/** Asks one question back, for a message with nothing in it to act on. */
export async function askClarifying(
  userMessage: string,
  html: string,
  attachments: Anthropic.ContentBlockParam[] = [],
  prior: Anthropic.MessageParam[] = [],
  onProgress?: OnProgress,
  /* One sentence about a page, so the fast model unless the page itself is too
     big for it to read — see editModelFor, which the caller has already asked
     and passes down rather than deciding again. */
  model: string = EDIT_MODEL,
): Promise<Answer> {
  /* 300 tokens and low effort: this is one sentence, and it is on the path of
     someone who has already waited once for the classifier. */
  const message = await ask(
    CLARIFY_SYSTEM,
    clarifyPrompt(userMessage, html),
    300,
    attachments,
    prior,
    onProgress,
    /* The one sentence it writes is the one the person reads. */
    true,
    model,
  );

  if (message.stop_reason === "refusal") {
    throw new EditError("I wasn't able to answer that one. Try asking it a different way.", 422);
  }

  const question = textOf(message).trim();
  if (!question) throw new EditError("I came back with nothing there, which is a fault my end. Try that again.", 502);

  return { text: question, outputTokens: message.usage?.output_tokens ?? 0 };
}

export type Answer = {
  text: string;
  /** What the answer cost to produce, which is what it is billed on. */
  outputTokens: number;
};

/** Answers a question about a page. Changes nothing about the page. */
export async function answerQuestion(
  userMessage: string,
  html: string,
  attachments: Anthropic.ContentBlockParam[] = [],
  prior: Anthropic.MessageParam[] = [],
  onProgress?: OnProgress,
  /* A question sends the whole page too, so the same choice applies: the page
     decides, even though nothing is being written. See editModelFor. */
  model: string = EDIT_MODEL,
): Promise<Answer> {
  const message = await ask(
    QUESTION_SYSTEM,
    questionPrompt(userMessage, html),
    1_500,
    attachments,
    prior,
    onProgress,
    /* An answer of up to 1,500 tokens, which is long enough that watching it
       arrive is materially different from waiting for it. */
    true,
    model,
  );

  if (message.stop_reason === "refusal") {
    throw new EditError("The model declined to answer that.", 422);
  }

  const answer = textOf(message).trim();
  if (!answer) throw new EditError("The model returned nothing.", 502);

  /* Reported by the API rather than guessed from the string: a question about a
     page sends the whole page, and it is a real model call whatever the answer
     ends up looking like. */
  return { text: answer, outputTokens: message.usage?.output_tokens ?? 0 };
}

/* ── Editing a project rather than a page ─────────────────────────────────
 *
 * The defect this closes is the largest one in the edit pipeline and it was
 * completely silent.
 *
 * A build of the Next.js stack stores its `.tsx` in project_files and puts a
 * SUMMARY of the project in the `html` column — a page listing the routes, the
 * tables and the files, written by projectSummary because nothing here runs
 * `next build` and a tree of source cannot be shown to anybody. The edit path
 * read `project_builds.html` and nothing else. So every edit to a project
 * edited the summary: the search blocks matched, the patch applied, the
 * validation passed, a new version was stored and charged for, and the
 * customer's actual application was not touched. Their source was frozen from
 * the first build onwards, and redeploying redeployed the original tree.
 *
 * pickFile — which chooses which file an instruction is about, and which has
 * existed and been tested this whole time — had no caller anywhere.
 *
 * This is the other half of it: the file it picked, edited.
 */
export type SourceEdit = {
  path: string;
  /** Why that file, for the step line — see FilePick. */
  why: FilePick["why"];
  contents: string;
  applied: number;
  failures: PatchFailure[];
  note: string | null;
  outputTokens: number;
  model: string;
  retried: boolean;
};

/**
 * Makes a change to one file of a project.
 *
 * Same patch mechanics as editPage and a different prompt, because a component
 * is not a document — see SOURCE_SYSTEM. No image stashing and no attachment
 * tokens: those are properties of a single self-contained page, and a project's
 * images are imports and props.
 *
 * Throws EditError for the cases the caller has to report rather than store: a
 * refusal, nothing placed, or a change too large to finish in the time a
 * request has.
 */
export async function editSource(
  userMessage: string,
  file: { path: string; content: string },
  why: FilePick["why"],
  tree: FileTree,
  prior: Anthropic.MessageParam[] = [],
  onProgress?: OnProgress,
  architecture?: string,
): Promise<SourceEdit> {
  /* Sized on the file rather than on the project: what goes into the window is
     this one file, and a forty-file project whose every file is small is not a
     large edit. */
  const model = editModelFor(userMessage, file.content);
  const deadlineAt = Date.now() + EDIT_DEADLINE_MS;

  const first = await ask(
    SOURCE_SYSTEM,
    sourcePrompt(userMessage, file.path, file.content, architecture, neighbourBrief(tree, file.path)),
    PATCH_TOKENS,
    [],
    prior,
    onProgress,
    false,
    model,
    deadlineAt,
  );

  if (first.stop_reason === "refusal") {
    throw new EditError(
      `I wasn't able to make that change to ${file.path}. If you can say which part you mean, I'll try again.`,
      422,
    );
  }

  let output = textOf(first);
  let result = applyPatches(file.content, output);
  let outputTokens = first.usage?.output_tokens ?? 0;
  let retried = false;

  /* Out of time is its own answer and not a reason to start again — there is by
     definition no budget left. What landed is kept; if nothing landed, the
     honest sentence is about the size of the change rather than about our
     inability to place it. */
  if (ranOutOfTime(first) && result.applied === 0) {
    throw new EditError(
      `That change is bigger than I can make to ${file.path} in one go. Ask for it a piece at a time and each one will land.`,
      422,
    );
  }

  /* One retry, and only when nothing at all landed — a partial success left
     alone, because re-running it would apply the blocks that already worked a
     second time against a file they have already changed. */
  if (result.applied === 0 && !ranOutOfTime(first)) {
    onProgress?.({
      kind: "reasoning",
      text: `That didn't place cleanly in ${file.path}. Reading it again with ${EDIT_MODEL_STRONG}…`,
    });

    const second = await ask(
      SOURCE_SYSTEM,
      retryPrompt(
        userMessage,
        file.content,
        result.failures.length > 0
          ? describeFailures(result.failures)
          : "no blocks were returned at all",
      ),
      PATCH_TOKENS,
      [],
      prior,
      onProgress,
      false,
      EDIT_MODEL_STRONG,
      deadlineAt,
    );

    retried = true;
    output = textOf(second);
    outputTokens += second.usage?.output_tokens ?? 0;
    result = applyPatches(file.content, output);
  }

  if (result.applied === 0) {
    /* Named, and the file is named with it. "I couldn't place that change" over
       a project is a sentence about the person's words; naming the file we were
       looking in is at least a fact they can correct. */
    throw new EditError(
      `I couldn't place that change in ${file.path}, so nothing was altered. Naming the component or quoting a line from it usually gets a clean result — or tell me which file you meant.`,
      422,
    );
  }

  return {
    path: file.path,
    why,
    contents: result.html,
    applied: result.applied,
    failures: result.failures,
    note: noteAfterPatches(output),
    outputTokens,
    model: retried ? EDIT_MODEL_STRONG : model,
    retried,
  };
}
