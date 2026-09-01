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

/* A cap on what travels to the orchestrator, so a long thread cannot push an
   unbounded payload through a webhook. */
const MAX_BRIEF = 4000;

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
  const composed = `${carried}\n\n(Follow-up instruction: ${text})`;
  return { text: composed.slice(0, MAX_BRIEF), carried };
}

/* How much of one earlier message is worth carrying into a model call. Enough
   to hold an instruction; not so much that six of them crowd out the page. */
const MAX_TURN = 700;
/* How many turns of context to send. Three exchanges is what "it", "that" and
   "too" ever refer to in practice. */
const MAX_TURNS = 6;

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
    const text = turn.text.trim().slice(0, MAX_TURN);
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
