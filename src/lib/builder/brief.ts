import type Anthropic from "@anthropic-ai/sdk";

import { estimateTokens } from "@/lib/context/budget";
import { condense, summarizeTurns } from "@/lib/context/compress";

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

export type Turn = {
  from: string;
  text: string;
  /* What the panel drew this row as, and — see conversational() — what decides
     whether a model is allowed to see it at all. Optional because two callers
     read this thread for other purposes and do not select them. */
  tone?: string | null;
  kind?: string | null;
};

/* Whether a row is something SAID, or something the app reported.
 *
 * This is the difference between a conversation and a log, and getting it wrong
 * cost somebody an evening. Every reply the builder writes lands in the same
 * table — the answers a model wrote, and also "Your build is underway", "I
 * couldn't use that file", and "I couldn't place that change in the page, so
 * I've left it exactly as it was."
 *
 * Those last ones are the app reporting a fault. Replayed into a model call as
 * assistant turns they stop being a report and become an EXAMPLE: the model is
 * shown its own supposed refusals, twice, immediately before being asked the
 * same question a third time — and it does the consistent thing. So one failed
 * edit made the next more likely to fail, which made the next more likely
 * still, and no amount of rephrasing got out of it. The person sending the
 * messages had no way to see any of that; from the outside the builder had
 * simply stopped being able to edit their page.
 *
 * A person's own messages are always kept: "it", "that" and "too" refer to
 * them, which is the entire reason this history is sent. What is dropped is the
 * builder's side when it was not an answer — anything the panel drew as an
 * error, and anything that was a status notice rather than a chat reply. */
export function conversational(turn: Turn): boolean {
  if (turn.from === "you") return true;
  if (turn.tone === "error") return false;
  return !turn.kind || turn.kind === "chat";
}

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
 * the page they are about. An edit sends as many of these as its token
 * budget holds — see priorTurns.
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
/* How much of the conversation travels with a message, in tokens.
 *
 * It was six turns of a thousand words each, and both numbers were the same
 * kind of guess: a count of things rather than a measure of what they cost. Six
 * one-line turns is nothing and six pasted specifications is more than some
 * windows hold, so the same rule produced a thread that remembered too little
 * and one that would not fit.
 *
 * A budget instead. Roughly nine thousand words of conversation, which is far
 * more than the old rule carried in the ordinary case and bounded in the case
 * that used to break — and it is now the CALLER's to set, because the caller
 * knows which model this is going to and what else is going in the window.
 * See src/lib/context/budget.ts for where a real one comes from. */
export const PRIOR_TURN_TOKENS = 12_000;

/* Of that, what is held back for the summary of everything older. A tenth: the
   summary is a dozen one-line entries, and the point is that it always fits —
   an older conversation that gets squeezed out entirely is the failure this
   exists to prevent. */
const SUMMARY_SHARE = 0.1;

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
export function priorTurns(
  history: Turn[],
  maxTokens: number = PRIOR_TURN_TOKENS,
): Anthropic.MessageParam[] {
  const turns: Anthropic.MessageParam[] = [];

  /* Filtered BEFORE anything is measured, so a run of failures cannot push the
     messages that actually matter out of the window. Six errors in a row is
     exactly the state this is for, and measuring first would spend the budget
     on text that is then thrown away. */
  const said = history.filter(conversational).filter((turn) => turn.text.trim());

  /* Newest first, taken whole while there is room for them.
   *
   * Backwards rather than forwards because recency is the only thing that makes
   * "it", "that" and "too" resolvable — that is what this history is FOR. What
   * changes is what happens to the rest: it used to be silently dropped, and it
   * is now summarised, so a decision taken twenty messages ago survives as a
   * line rather than as nothing. */
  const summaryRoom = Math.round(maxTokens * SUMMARY_SHARE);
  let spent = 0;
  const carried: { turn: Turn; text: string }[] = [];
  let oldest = said.length;

  for (let index = said.length - 1; index >= 0; index -= 1) {
    const turn = said[index];
    const body = turn.text.trim();
    const cost = estimateTokens(body);
    const room = maxTokens - summaryRoom - spent;

    if (cost <= room) {
      carried.unshift({ turn, text: body });
      spent += cost;
      oldest = index;
      continue;
    }

    /* One turn bigger than the room left. Condensed rather than dropped when
       there is enough room left for the result to say something — a pasted
       specification three messages back is exactly the case, and losing it
       whole is what the old rule did. */
    if (room > 400) {
      const shorter = condense(body, room);
      if (shorter.reduced) {
        carried.unshift({ turn, text: shorter.text });
        spent += shorter.tokens;
        oldest = index;
      }
    }
    break;
  }

  /* Everything older than what was carried, as a list of what they asked for.
     Placed first, as a user turn, which is also the only role the API will
     accept in that position. */
  const summary = oldest > 0 ? summarizeTurns(said.slice(0, oldest)) : "";
  const shaped: { from: string; text: string }[] = summary
    ? [{ from: "you", text: summary }, ...carried.map((entry) => ({ from: entry.turn.from, text: entry.text }))]
    : carried.map((entry) => ({ from: entry.turn.from, text: entry.text }));

  for (const turn of shaped) {
    const text = turn.text;
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
