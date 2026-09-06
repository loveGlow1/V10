import type Anthropic from "@anthropic-ai/sdk";

/* What a message means given the ones before it.
 *
 * Every model call in this app used to be handed one sentence and nothing else.
 * That is fine for "make the header darker" and useless for "rebuild", which is
 * a real thing people type and which, on its own, describes nothing. The
 * orchestrator was handed the word "rebuild" as a design brief and built what
 * you would expect from it — and the person who had, two messages earlier,
 * described an e-commerce store in detail was told the builder had forgotten.
 *
 * There are two halves to fixing that, and they are different jobs:
 *
 *   carryBrief   — a continuation carries the standing description forward, so
 *                  a build started by one word is still the build that was
 *                  asked for.
 *   priorTurns   — edits, questions and clarifications are given the
 *                  conversation as conversation, in the shape the API takes,
 *                  so "make it darker too" has a "too" to refer to.
 *
 * Both read the same thread the panel draws. Neither invents anything: if there
 * is nothing to carry, the message is passed through exactly as typed, which is
 * what every message did before this file existed. */

export type Turn = { from: string; text: string };

/* Messages that ask for the last thing again, or say yes to it, and describe
   nothing themselves. Anchored at both ends: "go" is a continuation, "go with a
   darker header" is an instruction. */
const CONTINUATION =
  /^\s*(re-?build( it)?|build( it)?( again)?|make it|do it|do that|go( ahead|on)?|yes|yep|yeah|sure|ok(ay)?|please( do)?|continue|carry on|keep going|proceed|resume|start|again|try again|retry|same( thing)?|as before)\s*[.!]*\s*$/i;

/* Below this, a message is unlikely to be a brief on its own — but length alone
   never decides. It is only used to pick which earlier message to carry. */
const SUBSTANTIVE = 24;

/**
 * How much of one earlier message travels into a model call.
 *
 * One number for both ways a message can reach the builder, because from the
 * outside they are the same promise. A brand new page carries the description
 * it continues from (see the carriedFrom line in blueprints/index.ts, which
 * imports this); an edit carries the conversation it is an edit to, through
 * priorTurns below. Those were 400 and 700, set months apart, and nothing said
 * why they differed — so "how much does it remember?" had two answers depending
 * on a distinction nobody typing into the box can see.
 *
 * Counted in WORDS, and that is not a cosmetic choice. It was 1,000 characters,
 * which is about 170 words — so somebody who pasted a a thousand-word brief and
 * then typed "rebuild" had six sevenths of their own description dropped before
 * the model saw it. A person writing into a box thinks in words; a limit
 * expressed in anything else is a limit they cannot predict.
 *
 * Enough to hold a pasted brief in full; not so much that six of them crowd out
 * the page they are about. An edit sends up to MAX_TURNS of these.
 */
export const MAX_CONTEXT_WORDS = 1000;

/** How many words a piece of text is, counting a word as a run of non-space. */
export function countWords(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

/**
 * The first `max` words of `text`, cut on a word boundary.
 *
 * Slices the original string rather than rejoining the words, so paragraphs,
 * line breaks and the shape somebody gave their brief survive the trim. A brief
 * flattened to one long line reads to the model as a different brief.
 */
export function trimToWords(text: string, max: number): string {
  if (max <= 0) return "";

  const words = /\S+/g;
  let count = 0;
  let end = -1;

  for (let match = words.exec(text); match; match = words.exec(text)) {
    count += 1;
    if (count === max) end = match.index + match[0].length;
    if (count > max) return text.slice(0, end);
  }

  return text;
}
/* How many turns of context to send. Three exchanges is what "it", "that" and
   "too" ever refer to in practice. */
const MAX_TURNS = 6;

/* A cap on what travels to the orchestrator, so a long thread cannot push an
   unbounded payload through a webhook. Two full descriptions' worth in words:
   a composed brief is a carried description plus the message that continues
   it, and both halves are allowed to be as long as a person may paste. */
const MAX_BRIEF_WORDS = 2 * MAX_CONTEXT_WORDS;

/** Whether a message describes nothing and only asks for the last thing again. */
export function isContinuation(message: string): boolean {
  return CONTINUATION.test(message);
}

export type Brief = {
  /** What to build. The message itself, unless something had to be carried. */
  text: string;
  /** The earlier message this leant on, when it leant on one. */
  carried: string | null;
};

/**
 * The instruction a build should actually run on.
 *
 * A message that stands on its own is returned untouched — which is almost
 * every message, and deliberately so: this must not rewrite briefs that were
 * perfectly clear. Only a continuation reaches back, and it reaches back for
 * the most recent thing the person themselves described.
 */
export function carryBrief(message: string, history: Turn[]): Brief {
  const text = message.trim();
  if (!isContinuation(text)) return { text, carried: null };

  /* Theirs, not ours. A reply is the builder's account of what it did; the
     brief is what was asked for, and only one of those two is in the room. */
  const earlier = history
    .filter((turn) => turn.from === "you")
    .map((turn) => turn.text.trim())
    .filter((body) => body.length >= SUBSTANTIVE && !isContinuation(body));

  const carried = earlier.length > 0 ? earlier[earlier.length - 1] : null;
  if (!carried) return { text, carried: null };

  /* The description first, because that is the brief; the word they typed after
     it, because "rebuild" and "try again" are not the same instruction and the
     difference belongs to them, not to us. */
  const composed = `${carried}${FOLLOW_UP}${text})`;
  return { text: trimToWords(composed, MAX_BRIEF_WORDS), carried };
}

/* The seam between the two halves of a composed brief. A constant rather than a
   literal because carriedContextLength below reads it back out, and a joiner
   that only one of the two knows about is a parser that breaks silently. */
const FOLLOW_UP = "\n\n(Follow-up instruction: ";

/**
 * How much carried context a composed brief is carrying, priced.
 *
 * A full build is charged where its page lands — in /api/builder/webapp/save,
 * minutes later and one HTTP hop away — and the only thing that survives that
 * journey is the brief itself. This reads the carried half back out of it, so
 * the context can be priced there without another field having to travel
 * through the orchestrator and back.
 *
 * Capped at MAX_CONTEXT because that is what the model was actually shown: the
 * carried description reaches the prompt through the projectContext line, which
 * trims it to exactly that. Charging on the untrimmed length would bill for
 * words nothing read.
 *
 * Zero for a brief nobody continued, which is almost all of them.
 */
export function carriedContextWords(composed: string): number {
  const seam = composed.indexOf(FOLLOW_UP);
  return seam < 0 ? 0 : Math.min(countWords(composed.slice(0, seam)), MAX_CONTEXT_WORDS);
}

/**
 * The conversation so far, in the shape the Messages API takes.
 *
 * Roles must alternate and must start with the user, so consecutive messages
 * from one side are joined rather than sent as two turns — and a thread that
 * opens with a reply has that reply dropped, because there is nothing for it to
 * be a reply to.
 *
 * The final user turn is NOT included: callers add their own, carrying the page
 * with it. This is only what came before.
 */
export function priorTurns(history: Turn[]): Anthropic.MessageParam[] {
  const turns: Anthropic.MessageParam[] = [];

  for (const turn of history.slice(-MAX_TURNS)) {
    const text = trimToWords(turn.text.trim(), MAX_CONTEXT_WORDS);
    if (!text) continue;

    const role: "user" | "assistant" = turn.from === "you" ? "user" : "assistant";
    if (turns.length === 0 && role === "assistant") continue;

    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content as string}\n\n${text}`;
      continue;
    }
    turns.push({ role, content: text });
  }

  /* A trailing assistant turn would leave the model completing its own reply
     rather than answering the one that follows. The caller's user turn comes
     next, so this can only happen when the thread ends on a reply — drop it. */
  while (turns.length > 0 && turns[turns.length - 1].role === "assistant") turns.pop();

  return turns;
}
