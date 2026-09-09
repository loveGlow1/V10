/* Making something shorter without making it mean less.
 *
 * Every reduction in this file is SEMANTIC: it decides what to keep by reading
 * what the text says, and it keeps what it keeps in the original order with the
 * original words. What it never does is take the first N of anything, which is
 * the one behaviour the guide rules out and the one this replaces — a brief cut
 * at a thousand words loses its acceptance criteria, because people put those
 * at the end.
 *
 * DETERMINISTIC AND FREE. No model call, no network. A compression step that
 * costs a model call cannot run on the path that is already short of room, and
 * one that costs money would make a long conversation quietly expensive. It is
 * regex and arithmetic, and it is honest about being that: it selects, it does
 * not paraphrase.
 *
 * Everything here is only ever applied to LOSSY context. What must survive
 * exactly is marked lossless upstream and never reaches these functions —
 * see ContextItem.lossless. */

import { estimateTokens } from "./budget";

/* Words that mark a sentence as a rule rather than a description.
 *
 * A brief is mostly prose and a few lines that constrain the outcome. "It
 * should feel premium" can go; "checkout must require sign-in" cannot, and it
 * is one line in the middle of a page of the former. These are what tell them
 * apart, and they are weighted heavily enough that a constraint outranks
 * position every time. */
const CONSTRAINT =
  /\b(must|must not|mustn't|never|always|required?|require[sd]?|do not|don't|cannot|can't|shall|should not|shouldn't|only|exactly|at least|at most|no more than|mandatory|forbidden|ensure|make sure)\b/i;

/* Things that are worth more as themselves than as a description of themselves:
   file paths, identifiers, routes, selectors, hex colours, quoted strings,
   numbers with units. A line carrying one of these is a line somebody will try
   to match against the real thing later. */
const IDENTIFIER =
  /(`[^`]+`|"[^"]{2,}"|\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+|\b[\w-]+\.(?:tsx?|jsx?|css|html|sql|json|md)\b|#[0-9a-fA-F]{3,8}\b|\bhttps?:\/\/\S+|\b[A-Z][a-zA-Z0-9]*(?:Section|Button|Card|Panel|Modal|Provider|Context)\b|\b\d+(?:px|rem|%|ms|s|kb|mb)\b)/;

/** A heading, a numbered step, or a bullet — structure somebody imposed. */
const STRUCTURE = /^\s*(#{1,6}\s|\d+[.)]\s|[-*•]\s|[A-Z][A-Z \d_-]{3,}:?\s*$)/;

/**
 * How much this block is worth keeping, given where it sits.
 *
 * Position is a tiebreak rather than the rule: an opening paragraph usually
 * frames the ask and a closing one usually carries the acceptance criteria, so
 * both ends get a small lift, and everything in between competes on content.
 */
function scoreBlock(block: string, index: number, total: number): number {
  let score = 0;

  if (CONSTRAINT.test(block)) score += 5;
  if (IDENTIFIER.test(block)) score += 3;
  if (STRUCTURE.test(block)) score += 2;

  /* Both ends, not just the top. The first block is the ask; the last is very
     often "it must also…", which a head-first cut throws away. */
  if (index === 0) score += 4;
  if (index === total - 1) score += 3;
  if (index === 1) score += 1;

  /* A block that is one word ("Thanks!", "ok") carries nothing and costs a
     line; a very long one is usually where the substance is. */
  const words = (block.match(/\S+/g) ?? []).length;
  if (words < 4) score -= 2;
  if (words > 40) score += 1;

  return score;
}

/** Paragraphs, or lines where there are no paragraphs. Order is preserved. */
function blocksOf(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter((block) => block.trim());
  if (paragraphs.length > 1) return paragraphs;
  return text.split(/\n/).filter((line) => line.trim());
}

/** Said in the output where material was left out, so the model knows the text
 *  it is reading is partial and does not treat a gap as a deletion. */
function elision(droppedBlocks: number, droppedTokens: number): string {
  return `[… ${droppedBlocks} passage${droppedBlocks === 1 ? "" : "s"} (~${droppedTokens} tokens) of lower-relevance detail omitted from this section; ask for it and it can be supplied in full …]`;
}

export type Condensed = {
  text: string;
  /** What it cost after condensing. */
  tokens: number;
  /** True when anything was left out. */
  reduced: boolean;
  /** Tokens removed. Zero when the text already fitted. */
  removedTokens: number;
};

/**
 * `text`, reduced to fit `maxTokens`, by dropping the least valuable blocks.
 *
 * Returns the original untouched when it already fits, which is the common case
 * and must stay free. Otherwise: score every block, keep the best ones until
 * the budget is spent, put them back IN THEIR ORIGINAL ORDER, and say plainly
 * where material was removed.
 *
 * The result can come back slightly over budget in one case — a single block
 * bigger than the whole allowance — and that is deliberate: cutting inside a
 * block is exactly the arbitrary truncation this file exists to avoid. A caller
 * that cannot afford the overshoot drops the item instead, which it can see
 * from `tokens`.
 */
export function condense(text: string, maxTokens: number): Condensed {
  const original = estimateTokens(text);
  if (original <= maxTokens || maxTokens <= 0) {
    return { text, tokens: original, reduced: false, removedTokens: 0 };
  }

  const blocks = blocksOf(text);
  if (blocks.length <= 1) {
    /* Nothing to select between. Handing back the whole block is the honest
       answer; the caller decides whether to carry it or defer it. */
    return { text, tokens: original, reduced: false, removedTokens: 0 };
  }

  const ranked = blocks
    .map((block, index) => ({
      index,
      block,
      tokens: estimateTokens(block),
      score: scoreBlock(block, index, blocks.length),
    }))
    .sort((a, b) => b.score - a.score || a.tokens - b.tokens || a.index - b.index);

  /* Room is reserved for the elision note itself, so the result does not
     overshoot because of the sentence explaining that it was shortened. */
  const noteRoom = estimateTokens(elision(99, 99_999));
  let spent = noteRoom;
  const keep = new Set<number>();

  for (const entry of ranked) {
    if (spent + entry.tokens > maxTokens) continue;
    keep.add(entry.index);
    spent += entry.tokens;
  }

  /* Never come back with nothing: if not one block fitted, keep the highest
     scoring one and let the caller see it is still over. */
  if (keep.size === 0) keep.add(ranked[0].index);

  const removedTokens = ranked
    .filter((entry) => !keep.has(entry.index))
    .reduce((total, entry) => total + entry.tokens, 0);
  const droppedCount = blocks.length - keep.size;

  /* Rebuilt in document order, with one note where the gaps are rather than a
     note per gap — a text interrupted six times reads as a broken document. */
  const kept: string[] = [];
  let gapOpen = false;
  for (let index = 0; index < blocks.length; index += 1) {
    if (keep.has(index)) {
      if (gapOpen) {
        kept.push(elision(droppedCount, removedTokens));
        gapOpen = false;
      }
      kept.push(blocks[index]);
      continue;
    }
    gapOpen = true;
  }
  if (gapOpen) kept.push(elision(droppedCount, removedTokens));

  const out = kept.join("\n\n");
  return { text: out, tokens: estimateTokens(out), reduced: true, removedTokens };
}

/* ── The requirement ledger ────────────────────────────────────────────────
 *
 * A long specification is mostly prose wrapped around a small number of things
 * that have to be true at the end. Those are what a build is judged on and they
 * are exactly what any length-based cut loses first.
 *
 * So they are pulled out and carried separately, at full fidelity, whatever
 * happens to the prose around them. This is the extraction half of the guide's
 * requirement ledger; it is deliberately literal — the person's own sentence,
 * not a paraphrase of it — because a requirement rewritten is a requirement
 * argued about later. */
export type Requirement = {
  /** REQ-001, and stable for as long as the source text is unchanged. */
  id: string;
  /** The sentence, as written. */
  text: string;
  /** Constraints outrank preferences when only some of them can be carried. */
  priority: "high" | "normal";
};

const MAX_REQUIREMENTS = 40;

/**
 * The requirements stated in a brief, in the order they were stated.
 *
 * Sentences rather than paragraphs, because "the checkout must require sign-in"
 * is a requirement and the paragraph it sits in is a description. A line that
 * merely mentions a page or a feature is a normal requirement; one carrying a
 * constraint word is a high one.
 */
export function extractRequirements(text: string): Requirement[] {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 12);

  const found: Requirement[] = [];

  for (const sentence of sentences) {
    const constrained = CONSTRAINT.test(sentence);
    const structural = STRUCTURE.test(sentence) && IDENTIFIER.test(sentence);
    if (!constrained && !structural) continue;

    found.push({
      id: `REQ-${String(found.length + 1).padStart(3, "0")}`,
      text: sentence.replace(/\s+/g, " ").trim(),
      priority: constrained ? "high" : "normal",
    });

    if (found.length >= MAX_REQUIREMENTS) break;
  }

  return found;
}

/** The ledger as a block of text for a prompt. Empty when there is nothing in
 *  it, so a caller can concatenate without checking. */
export function requirementBlock(requirements: Requirement[]): string {
  if (requirements.length === 0) return "";
  const lines = requirements.map(
    (requirement) =>
      `${requirement.id}${requirement.priority === "high" ? " (must)" : ""}: ${requirement.text}`,
  );
  return `Requirements taken from the brief, all of which the result has to satisfy:\n${lines.join("\n")}`;
}

/* ── Conversation, as state rather than as transcript ──────────────────────
 *
 * Replaying forty messages to say what four lines say is how a thread runs out
 * of room. What a model needs from an old conversation is what was DECIDED, and
 * a decision survives summarising in a way a discussion does not. */
export type Turnish = { from: string; text: string };

/**
 * A structured account of what happened earlier in a thread.
 *
 * Only the person's own messages, and only the ones that asked for something:
 * the builder's replies are its account of what it did, and the app's notices
 * are not conversation at all. Each is reduced to one line, in order, so what
 * comes out reads as a list of decisions rather than as a shortened chat.
 */
export function summarizeTurns(turns: Turnish[], maxEntries = 12): string {
  const asks = turns
    .filter((turn) => turn.from === "you")
    .map((turn) => turn.text.replace(/\s+/g, " ").trim())
    .filter((text) => text.length >= 12);

  if (asks.length === 0) return "";

  /* The oldest are the ones worth keeping in a summary — the recent ones are
     being sent in full by the caller — so this takes from the front. */
  const entries = asks.slice(0, maxEntries).map((text, index) => {
    const line = text.length > 140 ? `${text.slice(0, 137)}…` : text;
    return `${index + 1}. ${line}`;
  });

  const more = asks.length - entries.length;
  return [
    "Earlier in this conversation, they asked for:",
    ...entries,
    more > 0 ? `(and ${more} more, available on request)` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
