import Anthropic from "@anthropic-ai/sdk";

import { modelById } from "@/app/dashboard/models";

import { applyPatches, describeFailures, noteAfterPatches, type PatchFailure } from "./patch";
import {
  CLARIFY_SYSTEM,
  EDIT_SYSTEM,
  QUESTION_SYSTEM,
  clarifyPrompt,
  editPrompt,
  questionPrompt,
  retryPrompt,
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
 * NOTE: the composer's model picker still does not reach this — pick Opus for a
 * build and the edits afterwards are chosen here, not there. What IS chosen
 * here is which of two: see editModelFor. */
export const EDIT_MODEL = "claude-haiku-4-5";

/* The model a change goes to when it is not a small one.
 *
 * Haiku is the right answer for what most edits are — "make the header darker",
 * "change the footer year" — and the wrong answer twice over for anything
 * larger. Its context is 200K against Sonnet's million, and an edit carries the
 * whole page as well as the instruction, so a long brief against a real page
 * runs out of room before it runs out of work. And a change described in
 * several paragraphs is a change that needs holding in mind while it is made,
 * which is the thing the cheaper model is cheaper at not doing. */
export const COMPLEX_EDIT_MODEL = "claude-sonnet-5";

/* Where "small" stops.
 *
 * Three hundred words, matching the free brief allowance in credits.ts — not
 * for tidiness but because they measure the same thing from two directions.
 * Under it is somebody naming a change; over it is somebody specifying one, and
 * a specification is exactly what Haiku should not be holding in a 200K window
 * alongside the page it applies to. */
const SIMPLE_EDIT_WORDS = 300;

/* And where a PAGE stops being small, whatever the instruction says.
 *
 * A one-line change to a very large page still sends the whole page. At roughly
 * four characters per token, 400,000 characters is about 100,000 tokens — half
 * of Haiku's window before the instruction, the reasoning or the reply are
 * counted. Past this the size of the page decides, not the size of the ask. */
const SIMPLE_EDIT_PAGE_CHARS = 400_000;

/**
 * Which model makes this change.
 *
 * Haiku only for the genuinely simple: a short instruction against a page that
 * fits it comfortably. Everything else goes to Sonnet, and the bias is
 * deliberate — routing a large edit to the cheaper model does not save the
 * money, it spends it on an edit that half-lands and a person asking again.
 */
export function editModelFor(prompt: string, html: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  if (words > SIMPLE_EDIT_WORDS) return COMPLEX_EDIT_MODEL;
  if (html.length > SIMPLE_EDIT_PAGE_CHARS) return COMPLEX_EDIT_MODEL;
  return EDIT_MODEL;
}

/* How long an instruction may be, for the model it is going to.
 *
 * An edit sends the whole page as well as the brief, so the brief cannot have
 * the room a build's brief has — and hitting the real ceiling is a 400 from the
 * API rather than a sentence anybody can act on.
 *
 * Haiku's 200K window makes 80,000 characters (about 20,000 tokens) the sane
 * stop, leaving the page the rest with margin. Sonnet's is a million, so the
 * only ceiling that still means anything there is the one the route already
 * applies to every brief — see MAX_PROMPT in api/build/route.ts. Note that a
 * brief long enough for the Haiku number to bind is thousands of words, so it
 * has already been routed to Sonnet by the time it gets here; the small ceiling
 * exists for correctness, not because it is reached.
 */
export function maxEditPromptChars(model: string): number {
  return model === EDIT_MODEL ? 80_000 : 600_000;
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

/* When to stop writing and keep what is written.
 *
 * /api/build runs on a serverless function with a hard ceiling — maxDuration in
 * that route — and a full-page restyle asked for as an edit genuinely reaches
 * it: eight thousand tokens of search/replace blocks is close to a minute of
 * streaming. When the platform kills the function there is no answer, no error
 * anybody can act on, and every block already written is thrown away. A real
 * edit failed that way at 1m 1s having completed six of them.
 *
 * So this stops first, deliberately, with enough room left to apply what it
 * has. A partial edit is a real outcome — applyPatches works block by block and
 * the finished ones are correct — and six changes applied with a sentence
 * saying the rest ran out of time beats a minute of work discarded and "try it
 * again", which invites the identical failure. */
const EDIT_DEADLINE_MS = 45_000;

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
  /* Which model answers. Chosen per call rather than fixed here — see
     editModelFor: a short instruction against a small page goes to Haiku, and
     anything larger goes to Sonnet, whose window can hold it. */
  model: string,
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
  /* Wall-clock budget for this call. Reached, the stream is abandoned and
     whatever was written is returned — see EDIT_DEADLINE_MS. Absent, it runs
     to completion, which is right for the short calls. */
  deadlineMs?: number,
): Promise<{ message: Anthropic.Message; ranOutOfTime: boolean }> {
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

         Low stays low on the complex path too, which looks like the wrong
         instinct and is not. Sonnet is chosen there for its window — a long
         brief and a large page have to fit somewhere — rather than for more
         deliberation, and the binding constraint on this call is the wall
         clock: EDIT_DEADLINE_MS below, against a serverless ceiling that a
         full-page restyle genuinely reaches. Raising effort would spend that
         budget on thinking instead of on blocks, and the observed failure is
         already an edit that ran out of time having written six of them.

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

    const startedAt = Date.now();
    let ranOutOfTime = false;

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
        if (deadlineMs !== undefined && Date.now() - startedAt > deadlineMs) {
          ranOutOfTime = true;
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

      if (ranOutOfTime) {
        /* finalMessage() waits for a stream that has been abandoned. What was
           written is already in hand, and shaped as a Message so that nothing
           downstream has to know this happened — textOf reads it, applyPatches
           takes the complete blocks out of it, and the incomplete last one
           simply fails to match, which is what applyPatches already does with
           a block that does not place. */
        return {
          message: {
            id: "partial",
            type: "message",
            role: "assistant",
            model,
            content: [{ type: "text", text: written, citations: null }],
            stop_reason: "max_tokens",
            stop_sequence: null,
            usage: {
              input_tokens: 0,
              output_tokens: Math.ceil(written.length / 4),
              cache_creation_input_tokens: null,
              cache_read_input_tokens: null,
              server_tool_use: null,
              service_tier: null,
            },
          } as unknown as Anthropic.Message,
          ranOutOfTime: true,
        };
      }
    }

    return { message: await stream.finalMessage(), ranOutOfTime: false };
  } catch (error) {
    if (error instanceof EditError) throw error;
    if (error instanceof Anthropic.AuthenticationError) {
      throw new EditError("The ANTHROPIC_API_KEY this workspace is using was rejected — it will need replacing before I can edit.", 502);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new EditError("I'm rate limited at the moment. Send that again in a few seconds and it should go through.", 429);
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
     person needs to know there is more to ask for, and needs to be told rather
     than left to spot it. */
  ranOutOfTime: boolean;
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
export async function editPage(
  /* Chosen by the caller with editModelFor, and passed rather than recomputed:
     the route names this model in the step list and bills on its rate, so there
     must be exactly one answer to which model made the change. */
  model: string,
  userMessage: string,
  html: string,
  attachments: Anthropic.ContentBlockParam[] = [],
  prior: Anthropic.MessageParam[] = [],
  onProgress?: OnProgress,
): Promise<EditOutcome> {
  const { message: first, ranOutOfTime } = await ask(
    model,
    EDIT_SYSTEM,
    editPrompt(userMessage, html),
    8_000,
    attachments,
    prior,
    onProgress,
    false,
    EDIT_DEADLINE_MS,
  );

  if (first.stop_reason === "refusal") {
    throw new EditError("I wasn't able to make that change. If you can say which part of the page you mean, I'll try again.", 422);
  }

  let output = textOf(first);
  let result = applyPatches(html, output);

  if (ranOutOfTime && applyPatches(html, output).applied === 0) {
    /* Cut off before a single block completed. Nothing to apply and nothing to
       report but the truth: this change is too large to make in one edit. */
    throw new EditError(
      "That change is bigger than I can make in one go, so I've left the page exactly as it was. Ask for it a section at a time — the hero first, then the rest — and each one will land.",
      422,
    );
  }
  let outputTokens = first.usage?.output_tokens ?? 0;
  let retried = false;

  /* One retry, and only when nothing at all landed. A partial success is left
     alone: re-running it would apply the blocks that already worked a second
     time, against a page they have already changed. */
  /* No retry when the clock ran out rather than the model failing. A second
     eight-thousand-token attempt has even less time than the first, and would
     spend the remainder of the budget arriving at the same place. */
  if (result.applied === 0 && !ranOutOfTime) {
    const reason = result.failures.length
      ? describeFailures(result.failures)
      : "You returned no search/replace blocks.";

    /* The second attempt reports too, and says so: a retry that narrated
       itself as a first attempt would hide the one thing worth knowing about
       it. */
    onProgress?.({ kind: "reasoning", text: "That didn't place cleanly. Looking at the page again…" });

    const { message: second } = await ask(
      model,
      EDIT_SYSTEM,
      retryPrompt(userMessage, html, reason),
      8_000,
      attachments,
      prior,
      onProgress,
      false,
      EDIT_DEADLINE_MS,
    );
    output = textOf(second);
    result = applyPatches(html, output);
    outputTokens += second.usage?.output_tokens ?? 0;
    retried = true;

    if (result.applied === 0) {
      /* Nothing was written, and saying so is the whole point: an edit that
         silently did nothing is indistinguishable from one that worked until
         someone looks closely. */
      throw new EditError(
        "I couldn't place that change in the page, so I've left it exactly as it was. Naming the section you mean — the hero, the nav, the footer — usually sorts it.",
        422,
        result.failures,
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
    ranOutOfTime,
  };
}

/** Asks one question back, for a message with nothing in it to act on. */
export async function askClarifying(
  model: string,
  userMessage: string,
  html: string,
  attachments: Anthropic.ContentBlockParam[] = [],
  prior: Anthropic.MessageParam[] = [],
  onProgress?: OnProgress,
): Promise<Answer> {
  /* 300 tokens and low effort: this is one sentence, and it is on the path of
     someone who has already waited once for the classifier. */
  const { message } = await ask(
    model,
    CLARIFY_SYSTEM,
    clarifyPrompt(userMessage, html),
    300,
    attachments,
    prior,
    onProgress,
    /* The one sentence it writes is the one the person reads. */
    true,
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
  model: string,
  userMessage: string,
  html: string,
  attachments: Anthropic.ContentBlockParam[] = [],
  prior: Anthropic.MessageParam[] = [],
  onProgress?: OnProgress,
): Promise<Answer> {
  const { message } = await ask(
    model,
    QUESTION_SYSTEM,
    questionPrompt(userMessage, html),
    1_500,
    attachments,
    prior,
    onProgress,
    /* An answer of up to 1,500 tokens, which is long enough that watching it
       arrive is materially different from waiting for it. */
    true,
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
