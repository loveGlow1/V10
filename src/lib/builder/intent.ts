import Anthropic from "@anthropic-ai/sdk";

/* What a message in a workspace is asking for.
 *
 * Until now every message was a build. Sending "make the header darker" and
 * sending "build me a law firm site" did the same thing, and "undo that" was
 * built as though it were a design brief. The four cases below are genuinely
 * different, and only one of them should ever replace someone's work.
 *
 * Heuristics first, because they are free, instant and right almost always. The
 * model is asked only when the heuristics decline to guess — and every failure
 * path, including the model being unreachable, resolves to "edit". Failing safe
 * here means changing a page, never wiping one.
 *
 * "clarify" is the fifth case, and it is deliberately the rarest. A message can
 * ask for a change and still not say enough to make one — "make it better" names
 * no part of the page and no property of it. Guessing at those produced either a
 * wrong edit or the unhelpful "that could not be applied cleanly", so they are
 * answered with a question instead.
 *
 * It is kept narrow on purpose. A builder that asks what you meant every other
 * message is worse than one that picks a sensible reading and shows it: a wrong
 * edit is visible and undoable, a question costs a round trip before anything
 * happens. So it is reached only by the short list of genuinely contentless
 * requests below, or by the router deciding so — and it never comes from the
 * fallback, which stays "edit". */

export type Intent = "edit" | "new_project" | "question" | "revert" | "clarify";

export type IntentResult = {
  intent: Intent;
  confidence: number;
  source: "override" | "heuristic" | "model";
};

/* ── Signals ──────────────────────────────────────────────────────────────
 *
 * Each of these answers one narrow question about the message. None of them
 * decides anything on its own — they are weighed together below, which is the
 * point: real messages carry more than one signal at a time, and the first one
 * to match is not reliably the one that matters. "scrap this and make a site
 * for my dental clinic" contains an edit verb and a discard, and reading the
 * edit verb first gets it exactly wrong. */

/* Undoing. Weighted higher when it opens the message, because "undo that" is a
   command and "...so I undid it" is background. */
const REVERT = /\b(undo|revert|roll back|put it back|restore|previous version)\b/i;
const REVERT_LEADS =
  /^\s*(undo|revert|roll back|put it back)\b|^\s*go back\s*(to (the )?(previous|last|old|earlier)\b|to how it was\b|$)/i;

/* Throwing the current page away. The signal the old rules had no name for,
   and the reason two obvious new-project briefs were read as edits. */
/* Discarding the last CHANGE rather than the page. Shares its verbs with
   DISCARD below, which is why it is tested first — "scrap the last thing you
   did" read as a request to throw the whole page away. */
/* Restoring a named part to how it was: "put the old footer back". The
   old/previous/original qualifier is what separates it from "put the logo back
   on the left", which is an ordinary move. */
const REVERT_NAMED = /\bput (the |that )?(old|previous|original|former)\b.{0,24}\bback\b/i;

const REVERT_LAST =
  /\b(scrap|undo|drop|bin|forget)\s+(the\s+)?(last|previous)\s+(thing|change|edit|one|version)\b/i;

const DISCARD =
  /\b(scrap|ditch|forget|throw (it|this) away|start over|start again|from scratch|scratch that|replace (this|it|the (page|site))|instead of this)\b|^\s*(new project|new page|new site)\b/i;

/* "a completely different page", "another site" — asking for a different thing
   rather than a change to this one. A discard by implication. */
const DIFFERENT_THING =
  /\b(completely |totally |entirely |something )?(different|another|separate|second)\s+(page|site|website|web ?app|store|shop|thing|one)\b/i;

/* A brief: a build verb aimed at a kind of site, rather than at a part of one. */
const BUILD_VERB = /\b(build|create|make|generate|design|scaffold|put together)\b/i;
const SITE_NOUN =
  /\b(site|website|web ?app|landing page|home ?page|store|shop|portfolio|blog|dashboard|page (for|about)|app (for|about))\b/i;
/* "for my bakery", "for a law firm" — a brief names who it is for. */
const FOR_WHOM = /\bfor (my|a|an|our)\b/i;
/* "with a hero, a menu and a contact form" — a brief lists what goes in it. */
const SECTION_LIST = /\bwith (a|an|the)\b[^.]*\band\b/i;

/* Asking rather than instructing. Three shapes, because questions do not all
   start with a question word: "tell me what font this is" and "any idea why
   the nav breaks" are questions that the old leading-wh test walked past. */
const WH_LEADS = /^\s*(what|why|how|which|when|where|who|whose)\b/i;
const ASK_LEADS =
  /^\s*(is|are|was|were|does|do|did|can|could|should|will|would|has|have)\b\s+(the|this|that|it|there|i|you|we)\b/i;
const ASK_PHRASE = /\b(tell me|any idea|explain|what's|whats|do you know)\b/i;
const ENDS_QUESTION = /\?\s*$/;

/* Changing part of a page. "make" belongs here — it was missing, which left
   "can you make it blue" leaning on the back-reference rule to be read at all. */
const EDIT_VERBS =
  /\b(change|edit|update|fix|adjust|tweak|move|remove|delete|replace|rename|resize|shrink|enlarge|swap|add|centre|center|align|darken|lighten|increase|decrease|reorder|hide|show|make|set|turn|put|use|drop|tighten|loosen|bold|italicise|italicize|using|adding|removing|moving|changing|making|swapping|setting|dropping|bump|kill|shift|stretch|squash|speed|tidy|clean|tone|brighten|dim|trim|pad)\b/i;

/* A request aimed at the model rather than a description: "can you make…",
   "please move…". This is what separates an instruction that happens to be
   phrased as a question from an actual question. */
const POLITE_REQUEST =
  /\b(can you|could you|would you|please|i want you to|i'd like you to|id like you to)\b/i;

/* Naming a part of the page, which is what an edit has and a brief does not. */
const BACKREF =
  /\b(it|that|this|the (button|hero|nav|navbar|header|footer|card|cards|section|form|modal|sidebar|text|title|heading|logo|background|colour|color|font|spacing|padding|margin|layout|copy|cta|link|image|menu|price|pricing))\b/i;

/* Taking something out. Phrased as a preference more often than as a command
   — "I don't want the gradient anymore" is a deletion — and none of the edit
   verbs above catch any of these shapes. */
const REMOVAL =
  /\b(get rid of|no longer (need|want)|do ?n'?t (need|want)|lose the|take (out|off)|without the)\b/i;

const COMPARATIVE =
  /\b(bigger|smaller|darker|lighter|wider|narrower|taller|shorter|bolder|thinner|closer|further|tighter|looser|more|less|too (big|small|dark|light|wide|narrow|tall|short|cramped|tight|loose|close|far|busy|plain)|close together|far apart|crowded)\b/i;

/* "the CTA should be green", "'Get started' should read 'Start free'". */
const PRESCRIPTIVE =
  /\b(should (be|read|say|use|go|sit|look|feel|have)|needs? to (be|look|feel|read|have|say)|needs? (more|less)|needs? (a|an|another)|i need (this|it) to|i'?d like .{0,30}\bto\b|i want .{0,30}\bto (be|look|feel|match|say|read)\b)\b/i;

/* Wants something different, names nothing at all. Two shapes: a contentless
   instruction, and a bare verdict. Both are messages an editor cannot begin. */
const VAGUE =
  /^\s*(please\s+)?(can you\s+|could you\s+)?(just\s+|simply\s+)?(make|do|fix|change|improve|update|redo|sort)\s*(it|this|that|the page|the site|everything)?\s*(out|up)?\s*(better|nicer|good|great|prettier|beautiful|professional|modern|pop|work|right|properly)?\s*[.!]?\s*$/i;
/* Naming what is disliked without saying what it should become. "I hate the
   colours" has a target and still gives an editor nothing to do. */
const DISLIKE = /^\s*i\s+(hate|don'?t like|dislike|am not sure about)\b/i;
const BARE_VERDICT = /^\s*(rubbish|awful|ugly|terrible|horrible|needs work|not working|meh)\s*[.!]?\s*$/i;

const VERDICT =
  /^\s*((this|it|that|the (page|site|design))\s*('?s|s)?\s*)?(looks?|feels?|is|seems?)?\s*(really |very |so |a bit |kind of |kinda )?(not (great|good|right)|bad|awful|ugly|terrible|wrong|off|boring|bland|rough|meh|horrible)\s*[.!]?\s*$/i;

/* ── Weighing ─────────────────────────────────────────────────────────────
 *
 * Every signal adds to one or more intents and the highest total wins, which
 * is what lets a message carrying two signals be read as the one that
 * dominates rather than as whichever regex sits higher in the file.
 *
 * Two guards on the result. A winner has to clear a floor, and it has to beat
 * the runner-up by a margin — a message that scores 3 for edit and 3 for
 * new_project has not been understood by these rules, and saying so is what
 * sends it to the model instead of to a coin flip. That is the whole of "never
 * be lost": the cheap pass answers what it actually knows and hands over what
 * it does not, rather than guessing to avoid the handover. */
const FLOOR = 2;
const MARGIN = 1;

type Scores = Record<Intent, number>;

function score(m: string): Scores {
  const scores: Scores = { edit: 0, new_project: 0, question: 0, revert: 0, clarify: 0 };

  /* Six rather than five, which is deliberately above anything the edit rules
     can reach on their own: "undo the footer change and make the header
     taller" is both, and the undo is the part that has to happen first. Only
     an opening undo scores this — reverting is itself undoable, so leaning
     this way costs a keystroke and never costs work. */
  /* Before the discard rules, which share these verbs. */
  if (REVERT_LAST.test(m) || REVERT_NAMED.test(m)) scores.revert += 6;
  else if (REVERT_LEADS.test(m)) scores.revert += 6;
  else if (REVERT.test(m)) scores.revert += 3;

  if (DISCARD.test(m) && !REVERT_LAST.test(m)) scores.new_project += 5;
  if (DIFFERENT_THING.test(m)) scores.new_project += 4;

  /* A build verb alone is not a brief — "make the header darker" has one. It
     counts only alongside something a brief has and an edit does not: a kind of
     site, who it is for, or a list of what goes in it. */
  if (BUILD_VERB.test(m)) {
    if (SITE_NOUN.test(m)) scores.new_project += 3;
    if (FOR_WHOM.test(m)) scores.new_project += 2;
    if (SECTION_LIST.test(m)) scores.new_project += 2;
  } else if (SITE_NOUN.test(m) && FOR_WHOM.test(m)) {
    /* "a landing page for my gym" — a brief with the verb left off. */
    scores.new_project += 3;
  }

  const asks = WH_LEADS.test(m) || ASK_LEADS.test(m) || ASK_PHRASE.test(m);
  if (asks) scores.question += 3;
  if (ENDS_QUESTION.test(m)) scores.question += 1;

  if (EDIT_VERBS.test(m)) scores.edit += 2;
  if (REMOVAL.test(m)) scores.edit += 3;
  if (BACKREF.test(m)) scores.edit += 1;
  if (COMPARATIVE.test(m)) scores.edit += 2;
  if (PRESCRIPTIVE.test(m)) scores.edit += 2;

  /* "can you make it blue?" is an instruction wearing a question mark. Without
     this it reads as a question and nothing gets changed. */
  if (POLITE_REQUEST.test(m) && EDIT_VERBS.test(m)) scores.edit += 3;

  /* An instruction that opens with its verb is not a question about anything. */
  if (/^\s*(add|remove|change|move|make|set|swap|delete|fix|centre|center|align|put|use|drop|tighten|hide|show)\b/i.test(m)) {
    scores.edit += 2;
  }

  if (VAGUE.test(m) || VERDICT.test(m) || BARE_VERDICT.test(m) || DISLIKE.test(m)) {
    scores.clarify += 5;
    /* A contentless request matches an edit verb by construction — "make it
       better" — so the edit reading has to be taken back off, or the two tie
       and the message is sent to the model to decide something these rules
       already know. */
    scores.edit = 0;
  }

  return scores;
}

/* The leading reading regardless of how narrowly it leads.
 *
 * Only used when the model that was supposed to settle it could not be reached.
 * It is a worse answer than the model's and a better one than a constant: a
 * message that scored 4 for question and 4 for edit is not well described by
 * "edit", which is what this used to return in every failure case.
 *
 * new_project is deliberately not reachable here. It is the one intent that
 * proposes throwing work away, and a network error is not evidence for it. */
export function bestGuess(message: string, hasPage: boolean): Intent {
  if (!hasPage) return "new_project";
  const scores = score(message.trim());
  let leader: Intent = "edit";
  for (const intent of Object.keys(scores) as Intent[]) {
    if (intent !== "new_project" && scores[intent] > scores[leader]) leader = intent;
  }
  return leader;
}

/* What a person asked for BESIDES the undo.
 *
 * "undo that and make the header taller" is classified as a revert, and that is
 * the right call: the undo has to happen first, and applying the edit to the
 * version being thrown away would be exactly wrong. But the second half of
 * their sentence then disappears without a word, which is the part that is not
 * right — they watch the page come back, the header stays as it was, and
 * nothing ever said why.
 *
 * So it is read back out and handed to them. Not performed: doing both in one
 * turn would charge for a change somebody may well not want once they see the
 * old page again, and the whole reason revert wins is that it is the only order
 * that cannot be wrong.
 *
 * Null when the message was only an undo, which is most of them. Deliberately
 * conservative — a missed remainder costs a sentence that would have been
 * helpful, and a false one puts words in somebody's mouth. */
/* What joins the undo to the instruction after it, one link at a time.
 *
 * Stripped in a loop rather than by one match, because people stack them:
 * "roll back AND ALSO can you…", "revert that, THEN…". A single pass leaves
 * the second word in place and hands back "then add a contact form", which
 * reads back as though the joining word were part of what they asked for. */
const REVERT_JOIN = /^\s*(?:and|then|also|plus|next|after that|,)\s*/i;

/* Politeness, which is not the instruction. Stripped after the joins, since it
   is what usually sits between them and the verb. */
const REVERT_PLEASE = /^\s*(?:can you|could you|would you|will you|please)\s+/i;

/* Words that stand in for the instruction instead of being one. "undo that and
   do it" ends here: two words, both pro-forms, nothing anybody could act on —
   and reading it back would be this system saying "you also asked to do it". */
const PRO_FORMS = new Set(["do", "it", "that", "this", "them", "again", "too", "please"]);

/* What a person asked for BESIDES the undo.
 *
 * "undo that and make the header taller" is classified as a revert, and that is
 * the right call: the undo has to happen first, and applying the edit to the
 * version being thrown away would be exactly wrong. But the second half of
 * their sentence then disappears without a word, which is the part that is not
 * right — they watch the page come back, the header stays as it was, and
 * nothing ever said why.
 *
 * So it is read back out and handed to them. Not performed: doing both in one
 * turn would charge for a change somebody may well not want once they see the
 * old page again, and the whole reason revert wins is that it is the only order
 * that cannot be wrong.
 *
 * Null when the message was only an undo, which is most of them. Deliberately
 * conservative in both directions, and the false positive is the worse one: a
 * missed remainder costs a sentence that would have helped, while an invented
 * one puts words in somebody's mouth and reads as a misunderstanding. */
export function remainderAfterRevert(message: string): string | null {
  const m = message.trim();

  /* Only where the undo OPENS the message. "I undid it earlier, now make the
     header taller" is not an undo carrying an instruction — it is an edit with
     a story attached, and the classifier reads it that way too. */
  const lead = m.match(REVERT_LEADS);
  if (!lead) return null;

  let rest = m.slice(lead[0].length);

  /* The object of the undo, where it named one: "undo THAT and…", "revert THE
     LAST CHANGE and…". Dropped so what is left is the new instruction rather
     than the tail of the old one. */
  rest = rest.replace(
    /^\s*(that|it|this|the last (change|thing|edit|one)|the previous (change|edit|version))\b/i,
    "",
  );

  /* At least one join, then as many more as they stacked. Requiring the first
     is what keeps this conservative: without it, the leftovers of any sentence
     starting with "undo" would be read as a fresh instruction. */
  if (!REVERT_JOIN.test(rest)) return null;
  while (REVERT_JOIN.test(rest)) rest = rest.replace(REVERT_JOIN, "");

  const remainder = rest.replace(REVERT_PLEASE, "").trim().replace(/[.!?\s]+$/, "");
  const words = remainder.split(/\s+/).filter(Boolean);

  /* Two words at minimum, and at least one of them has to carry meaning. */
  if (words.length < 2) return null;
  if (words.every((word) => PRO_FORMS.has(word.toLowerCase()))) return null;

  return remainder;
}

/** The cheap deterministic pass. Null when genuinely ambiguous. */
export function heuristicIntent(message: string, hasPage: boolean): IntentResult | null {
  const m = message.trim();
  if (!m) return null;

  /* Nothing built yet, so there is nothing to edit and nothing to lose:
     anything actionable is the first build. Asked before the weighing, because
     with no page the words carry different weight — "make it better" is a
     hopeless edit and a perfectly ordinary opening brief. */
  if (!hasPage) {
    const asksAboutNothing =
      WH_LEADS.test(m) || ASK_LEADS.test(m) || ASK_PHRASE.test(m) || ENDS_QUESTION.test(m);
    if (asksAboutNothing && !EDIT_VERBS.test(m) && !SITE_NOUN.test(m)) {
      return { intent: "question", confidence: 0.8, source: "heuristic" };
    }
    return { intent: "new_project", confidence: 0.9, source: "heuristic" };
  }

  const scores = score(m);
  const ranked = (Object.keys(scores) as Intent[])
    .map((intent) => ({ intent, points: scores[intent] }))
    .sort((a, b) => b.points - a.points);

  const [best, runnerUp] = ranked;
  if (best.points < FLOOR || best.points - runnerUp.points < MARGIN) return null;

  /* Confidence from the margin rather than from a table of constants: how sure
     these rules are is exactly how far ahead the winner finished. Capped at
     0.95 — a regex is never certain. */
  const confidence = Math.min(0.95, 0.6 + (best.points - runnerUp.points) * 0.07);
  return { intent: best.intent, confidence, source: "heuristic" };
}

const ROUTER_SYSTEM = `You classify one message sent to a website builder. The user already has a page built.

Reply with ONLY raw JSON, no markdown fences and no preamble:
{"intent":"edit","confidence":0.0}

intent is exactly one of:
- "edit": change the existing page in any way. This is the default whenever you are unsure.
- "new_project": abandon the current page and build something entirely different.
- "question": asking about the page, not asking for a change.
- "revert": undo a change that was already made.
- "clarify": wants something different, but names no part of the page and nothing to change it to.

You are only asked when a fast rule-based pass could not decide, so these are the hard ones. What that pass finds hard:

- Asking AND instructing in one message. "why is it slow and can you fix it?" is "edit" — carrying out the request also answers the question.
- Undoing AND changing. "undo the footer change and make the header taller" is "revert": the undo has to happen first, and what remains can be asked for again.
- Going back to a previous STATE is "revert". Going back to a previous CHOICE is "edit" — "go back to using Inter" is an instruction to set a font, not to undo anything.
- Wanting a different site is "new_project". Wanting this site different is "edit". "a completely different page about hiking" is the first; "make it look completely different" is the second.
- Dissatisfaction with no direction is "clarify" — "I hate the colours", "something feels off". Dissatisfaction WITH a direction is "edit" — "the colours are too cold".

Choose "new_project" only when the user clearly wants to throw the current page away — it is the only intent that proposes discarding work.
Choose "clarify" only when you could not begin: if any reasonable reading gives you something to change, that is "edit".
Ambiguity between anything else resolves to "edit".`;

/** Classifies a message. Never throws — an unreachable model resolves to "edit". */
export async function classifyIntent(opts: {
  message: string;
  hasPage: boolean;
  history: { from: string; text: string }[];
  override?: Intent | null;
}): Promise<IntentResult> {
  if (opts.override) {
    return { intent: opts.override, confidence: 1, source: "override" };
  }

  const quick = heuristicIntent(opts.message, opts.hasPage);
  if (quick) return quick;

  if (!process.env.ANTHROPIC_API_KEY) {
    return { intent: bestGuess(opts.message, opts.hasPage), confidence: 0.4, source: "model" };
  }

  try {
    /* Haiku, and a 100-token ceiling: this is a routing decision on a short
       message, made before every build, and it is on the path of someone
       waiting. Thinking is off for the same reason — there is nothing here to
       reason about that a sentence of context does not settle. */
    const message = await new Anthropic().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 100,
      system: ROUTER_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Recent conversation:\n${
            opts.history.map((h) => `${h.from}: ${h.text}`).join("\n") || "(none)"
          }\n\nMessage: ${opts.message}`,
        },
      ],
    });

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    const parsed = JSON.parse(text) as { intent?: string; confidence?: number };
    const intent = parsed.intent;

    return {
      intent:
        intent === "new_project" ||
        intent === "question" ||
        intent === "revert" ||
        intent === "clarify"
          ? intent
          : "edit",
      confidence: Number(parsed.confidence ?? 0.5),
      source: "model",
    };
  } catch {
    /* Unreachable, rate limited, or answered with something that is not JSON.
       The heuristics' own leader is used rather than a constant — and it can
       never be new_project, so the property that mattered still holds: a
       failure here changes a page, it never replaces one. */
    return { intent: bestGuess(opts.message, opts.hasPage), confidence: 0.4, source: "model" };
  }
}
