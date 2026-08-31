import Anthropic from "@anthropic-ai/sdk";

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

export const EDIT_MODEL = "claude-opus-5";

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

async function ask(
  system: string,
  prompt: string,
  maxTokens: number,
  /* Files the person attached, as blocks. They go BEFORE the text, because the
     text refers to them — "match this screenshot" reads as an instruction only
     once the screenshot is already in view. */
  attachments: Anthropic.ContentBlockParam[] = [],
): Promise<Anthropic.Message> {
  try {
    return await client().messages.create({
      model: EDIT_MODEL,
      max_tokens: maxTokens,
      /* Adaptive thinking, low effort. Working out which lines to change and
         copying them exactly is careful work rather than hard work, and this
         call is on the path of someone watching a cursor. */
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system,
      messages: [
        {
          role: "user",
          content:
            attachments.length > 0
              ? [...attachments, { type: "text" as const, text: prompt }]
              : prompt,
        },
      ],
    });
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
  userMessage: string,
  html: string,
  attachments: Anthropic.ContentBlockParam[] = [],
): Promise<EditOutcome> {
  const first = await ask(EDIT_SYSTEM, editPrompt(userMessage, html), 8_000, attachments);

  if (first.stop_reason === "refusal") {
    throw new EditError("I wasn't able to make that change. If you can say which part of the page you mean, I'll try again.", 422);
  }

  let output = textOf(first);
  let result = applyPatches(html, output);
  let outputTokens = first.usage?.output_tokens ?? 0;
  let retried = false;

  /* One retry, and only when nothing at all landed. A partial success is left
     alone: re-running it would apply the blocks that already worked a second
     time, against a page they have already changed. */
  if (result.applied === 0) {
    const reason = result.failures.length
      ? describeFailures(result.failures)
      : "You returned no search/replace blocks.";

    const second = await ask(
      EDIT_SYSTEM,
      retryPrompt(userMessage, html, reason),
      8_000,
      attachments,
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
  };
}

/** Asks one question back, for a message with nothing in it to act on. */
export async function askClarifying(
  userMessage: string,
  html: string,
  attachments: Anthropic.ContentBlockParam[] = [],
): Promise<Answer> {
  /* 300 tokens and low effort: this is one sentence, and it is on the path of
     someone who has already waited once for the classifier. */
  const message = await ask(CLARIFY_SYSTEM, clarifyPrompt(userMessage, html), 300, attachments);

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
): Promise<Answer> {
  const message = await ask(QUESTION_SYSTEM, questionPrompt(userMessage, html), 1_500, attachments);

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
