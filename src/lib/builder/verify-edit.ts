/* Whether the change somebody asked for is actually in the page.
 *
 * Every stage of the edit path answers a different question and none of them
 * answered this one. applyPatches says the blocks matched. validate.ts says the
 * document still holds together. brain.ts says the change did not knock the nav
 * loose. All three can pass on an edit that did nothing the person asked for —
 * a model that reworded a heading when it was told to shrink a logo has written
 * a patch that applies cleanly, balances, and breaks nothing.
 *
 * So the page said "Done." and the person looked at their own site to find out
 * otherwise. That is the failure this file exists to stop, and the rule it
 * enforces is one sentence: the model that made the change does not get to be
 * the thing that decides the change was made.
 *
 * ── Criteria, not opinions ────────────────────────────────────────────────
 *
 * A request is turned into a list of things that must be TRUE of the resulting
 * document, and each is then checked against the document. "Make the header fit
 * mobile" becomes: the header's markup differs, the page has no fixed width
 * wider than a phone, and nothing that fitted before stopped fitting. Each of
 * those is answerable from the two documents with no model and no browser, and
 * each of them is answered.
 *
 * ── Three answers, not two ────────────────────────────────────────────────
 *
 * met, unmet, and COULD NOT BE CHECKED. The third is the one that makes the
 * other two mean anything: a request naming a section that is not in the page
 * is not a failed edit, it is a criterion with nothing to test against, and
 * reporting it as a pass is precisely the lie this module was written to stop
 * telling. qa/types.ts made the same distinction for the same reason.
 *
 * ── Why so few of these are errors ────────────────────────────────────────
 *
 * Because a criterion is derived from a sentence, and a sentence is not a
 * specification. "Tidy up the pricing" could correctly be answered a dozen
 * ways. A verifier that refuses a good edit because it cannot recognise the
 * shape of the fix is worse than no verifier: it would throw away work
 * somebody paid for and asked for, which is a disease this codebase has caught
 * twice already.
 *
 * So only things true in every document that has them are errors — a document
 * that did not change at all, a named section whose markup is byte-identical, a
 * removal that removed nothing, a phone layout that got worse. Everything else
 * is reported and never blocks.
 *
 * Pure: no SDK, no network, no browser, so tools/check-verify-edit.mjs can
 * compile it on its own and the edit path can run it on every edit for free.
 */

import type { EditPlan } from "./edit-plan";
import { type Region, pageRegions } from "./landmarks";
import { staticResponsiveGate } from "./qa/responsive";

/* ── What can be asked of an edit ──────────────────────────────────────────
 *
 * Each rule is a question with a deterministic answer. Nothing here asks
 * whether the result is GOOD — that is the QA gates' job and a different
 * question. These ask only whether what was requested is present.
 */
export const CRITERION_RULES = [
  /** The document is not the one we started with. */
  "changed",
  /** The part of the page the request named is not the one we started with. */
  "target-changed",
  /** What the request asked to remove is gone. */
  "removed",
  /** Words the request quoted are in the page. */
  "wording",
  /** A phone-width layout, for a request that asked for one. */
  "fits-phone",
  /** And nothing that fitted before stopped fitting. */
  "no-new-overflow",
  /** The tag without which a phone does not lay out at all. */
  "viewport",
] as const;

export type CriterionRule = (typeof CRITERION_RULES)[number];

export type Criterion = {
  rule: CriterionRule;
  /** What has to be true, phrased as somebody would say it out loud. */
  what: string;
  /* Whether failing it means the edit did not happen. Errors are things true
     in every document that has them; everything else is reported. */
  severity: "error" | "warning";
};

export type CriterionResult = Criterion & {
  /** True, false, or null for "there was nothing here to check against". */
  met: boolean | null;
  /** The evidence, when it was not met. Never an opinion — a measurement. */
  detail: string | null;
};

export type Verification = {
  /* The one thing a caller acts on. False means a criterion that blocks was
     checked and failed — never that one could not be checked. */
  complete: boolean;
  criteria: CriterionResult[];
  /** Blocking criteria that failed. Empty when complete. */
  unmet: CriterionResult[];
  /** Criteria nothing could be tested against. Not failures, and not passes. */
  unchecked: CriterionResult[];
  /** One sentence naming what is wrong, or null. For a person, not a log. */
  reason: string | null;
};

/* ── Reading the request ───────────────────────────────────────────────────
 *
 * The same approach as edit-plan.ts and for the same reasons: regexes over the
 * sentence somebody typed, because a model call here would cost a call before
 * the edit's own, answer differently on Tuesday, and be unable to say why. What
 * this cannot settle it declines to check rather than guessing at.
 */

/** Asked for something to work on a phone. */
const RESPONSIVE =
  /\b(mobile|phone|responsive|small screen|smaller screen|handset|tablet|iphone|android|fit (?:the |my )?screen|portrait)\b/i;

/** Asked for something to go away. */
const REMOVAL = /\b(remove|delete|get rid of|take (?:out|off|away)|drop|hide|strip)\b/i;

/* A named place on the page. Deliberately the words people actually use rather
   than the tags: nobody asks to change the `<header>`, they ask about the
   menu at the top. Each maps to what would identify that block — its tag, its
   id, or the words in its heading. */
const PLACES: { name: string; match: RegExp; tags: string[]; words: RegExp }[] = [
  { name: "header", match: /\b(header|top bar|nav|navbar|navigation|menu|top of the page)\b/i, tags: ["header"], words: /\b(nav|menu|header)\b/i },
  { name: "hero", match: /\b(hero|banner|masthead|splash|the top section)\b/i, tags: ["section"], words: /\b(hero|banner)\b/i },
  { name: "footer", match: /\b(footer|bottom of the page|the bottom)\b/i, tags: ["footer"], words: /\bfooter\b/i },
  { name: "pricing", match: /\b(pricing|prices|plans|packages|tiers)\b/i, tags: ["section"], words: /\b(pricing|prices|plans|packages)\b/i },
  { name: "contact", match: /\b(contact|get in touch|enquiry|enquiries|inquiry)\b/i, tags: ["section"], words: /\b(contact|touch|enquir|inquir)/i },
  { name: "about", match: /\b(about|our story|who we are)\b/i, tags: ["section"], words: /\b(about|story)\b/i },
  { name: "testimonials", match: /\b(testimonial|testimonials|reviews|what (?:our )?(?:clients|customers) say)\b/i, tags: ["section"], words: /\b(testimonial|review)/i },
  { name: "gallery", match: /\b(gallery|portfolio|our work|photos)\b/i, tags: ["section"], words: /\b(gallery|portfolio|work|photo)/i },
  { name: "features", match: /\b(features|services|what we (?:do|offer)|benefits)\b/i, tags: ["section"], words: /\b(feature|service|benefit)/i },
  { name: "faq", match: /\b(faq|faqs|questions)\b/i, tags: ["section"], words: /\b(faq|question)/i },
];

/* Text the request put in quotes. Straight and curly both, because a message
   typed on a phone has curly ones and a message pasted from anywhere has a
   mixture. Short fragments are dropped: a two-character quotation matches
   somewhere in every document and would make the criterion meaningless. */
const QUOTED = /["“”'‘’]([^"“”'‘’]{3,80})["“”'‘’]/g;

function quotationsIn(message: string): string[] {
  const out: string[] = [];
  QUOTED.lastIndex = 0;
  for (let match = QUOTED.exec(message); match; match = QUOTED.exec(message)) {
    const text = match[1].trim();
    /* A quoted sentence naming a file or a class is direction to the model,
       not copy for the page. Nobody asks for `text-sm` to appear on a website. */
    if (text.length >= 3 && !/^[\w-]+\.(tsx?|jsx?|css|html)$/i.test(text)) out.push(text);
  }
  return out;
}

/** The words of a message with the markup-ish bits taken out, for matching. */
function plain(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Whitespace-insensitive, because a reformat is not a change. */
function same(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
}

/**
 * The region the message is about, in both versions of the page.
 *
 * Matched by id first, then by heading, then by tag and position — in that
 * order because that is the order of how reliably each identifies the same
 * block across an edit. An edit that rewrote the heading still has the id; an
 * edit that added a section ahead of it has neither, and position is then the
 * best that is available and is honest about being a guess.
 *
 * Null when the message names no place, or names one the page does not have.
 * Both are "nothing to check", never "the edit failed".
 */
function locate(
  message: string,
  before: Region[],
  after: Region[],
): { name: string; before: Region; after: Region } | null {
  for (const place of PLACES) {
    if (!place.match.test(message)) continue;

    const candidates = before.filter(
      (region) =>
        place.tags.includes(region.tag) ||
        (region.id !== null && place.words.test(region.id)) ||
        (region.heading !== null && place.words.test(region.heading)),
    );

    /* Named by its own words rather than merely by its tag, where anything
       does — `<header>` matches "header" for every page, and a section called
       "Pricing" matches "pricing" for exactly the one somebody meant. */
    const named = candidates.filter(
      (region) =>
        (region.id !== null && place.words.test(region.id)) ||
        (region.heading !== null && place.words.test(region.heading)),
    );

    const pick = (named.length > 0 ? named : candidates)[0];
    if (!pick) continue;

    const twin =
      (pick.id !== null ? after.find((region) => region.id === pick.id) : undefined) ??
      (pick.heading !== null ? after.find((region) => region.heading === pick.heading) : undefined) ??
      after.find((region) => region.order === pick.order && region.tag === pick.tag);

    /* The region is in the old page and not in the new one. That is a real
       answer — it was removed — and the caller's removal criterion is the one
       that should speak to it, so this reports no pair rather than a failure. */
    if (!twin) continue;

    return { name: place.name, before: pick, after: twin };
  }

  return null;
}

/** What the request asked to be rid of, as the words that would identify it. */
function removalTarget(message: string): string | null {
  /* Everything after the removal verb, up to where the sentence turns. What is
     being removed is named immediately after "remove" in every phrasing of it
     anybody types, and the clause after "from"/"and"/"so" is where it is being
     removed FROM rather than what it is. */
  const match =
    /\b(?:remove|delete|get rid of|take out|take off|take away|drop|hide|strip)\s+(?:the\s+|that\s+|this\s+|my\s+|a\s+|an\s+)?([^.,;!?]{2,60})/i.exec(
      message,
    );
  if (!match) return null;

  const target = match[1]
    .replace(/\b(from|and|so|because|which|that|please|on|in|at)\b[\s\S]*$/i, "")
    .replace(/\b(section|block|bit|part|element|thing|area)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return target.length >= 3 ? target : null;
}

function criterion(
  rule: CriterionRule,
  what: string,
  severity: Criterion["severity"],
  met: boolean | null,
  detail: string | null = null,
): CriterionResult {
  return { rule, what, severity, met, detail };
}

export type VerifyInput = {
  /** What the person asked for, in their own words. */
  message: string;
  /** What that was classified as, when the caller has it. */
  plan?: EditPlan | null;
  /** The page as it was. */
  before: string;
  /** The page the edit produced. */
  after: string;
};

/**
 * Whether the edit did what was asked.
 *
 * Never throws. A verifier that can fail an edit by failing itself is worse
 * than no verifier — the edit was fine and somebody now has to work out that
 * the checker broke rather than the page. An error here comes back as a
 * verification with nothing checked, which the caller reads as "no evidence
 * either way" and stores the edit, exactly as it did before this existed.
 */
export function verifyEdit(input: VerifyInput): Verification {
  const criteria: CriterionResult[] = [];

  try {
    const { message, before, after } = input;
    const wantsPhone =
      RESPONSIVE.test(message) || input.plan?.kind === "responsive";

    /* ── The one that applies to every edit ─────────────────────────────
     *
     * An edit that produced the document it started with did not happen,
     * whatever the blocks reported. This is the cheapest check in the file and
     * the one that catches the most: a patch that matched a line and replaced
     * it with itself applies perfectly and changes nothing. */
    criteria.push(
      criterion(
        "changed",
        "the page is not the one we started with",
        "error",
        !same(before, after),
        same(before, after) ? "the document is identical to the version before the edit" : null,
      ),
    );

    /* ── And the part of it that was named ──────────────────────────────
     *
     * The check that separates "something changed" from "the thing you asked
     * about changed". A model asked to shrink the logo and given a whole page
     * can satisfy the criterion above by rewording a paragraph in the footer. */
    const beforeRegions = pageRegions(before);
    const afterRegions = pageRegions(after);
    const spot = locate(message, beforeRegions, afterRegions);

    if (spot) {
      const moved = !same(spot.before.source, spot.after.source);
      criteria.push(
        criterion(
          "target-changed",
          `the ${spot.name} is not the one we started with`,
          "error",
          moved,
          moved ? null : `the ${spot.name}'s markup is unchanged, so nothing in it was edited`,
        ),
      );
    } else {
      criteria.push(
        criterion(
          "target-changed",
          "the part of the page the request named changed",
          "error",
          null,
          "the request does not name a part of the page this can find, so there is nothing to compare",
        ),
      );
    }

    /* ── Removals ───────────────────────────────────────────────────────
     *
     * The request type where the model most often does something adjacent:
     * asked to remove a section it hides it behind a class, or removes one
     * item from it, or leaves it and removes the link to it. All three read as
     * a successful edit everywhere else in the pipeline. */
    if (REMOVAL.test(message)) {
      const target = removalTarget(message);
      if (target) {
        const words = target.toLowerCase().split(/\s+/).filter((word) => word.length >= 4);
        const wasThere = words.filter((word) => plain(before).includes(word));

        if (wasThere.length === 0) {
          criteria.push(
            criterion(
              "removed",
              `“${target}” is gone from the page`,
              "error",
              null,
              `nothing matching “${target}” was in the page before the edit, so there is nothing to compare`,
            ),
          );
        } else {
          const stillThere = wasThere.filter((word) => plain(after).includes(word));
          criteria.push(
            criterion(
              "removed",
              `“${target}” is gone from the page`,
              "error",
              stillThere.length === 0,
              stillThere.length === 0
                ? null
                : `“${stillThere.join(", ")}” is still in the page after the edit`,
            ),
          );
        }
      }
    }

    /* ── Words somebody asked for by quoting them ───────────────────────
     *
     * A warning rather than an error, and deliberately. Quotation marks in a
     * message are as often emphasis as they are copy — "make the 'buy' button
     * bigger" quotes a word that is already in the page and asks for nothing
     * to be written. Reported so it is visible, never blocking. */
    for (const quotation of quotationsIn(message).slice(0, 3)) {
      const present = plain(after).includes(quotation.toLowerCase());
      /* Already on the page before the edit, so its presence proves nothing
         about whether the edit did anything. */
      if (plain(before).includes(quotation.toLowerCase())) continue;
      criteria.push(
        criterion(
          "wording",
          `“${quotation}” is in the page`,
          "warning",
          present,
          present ? null : `the words “${quotation}” are not in the page`,
        ),
      );
    }

    /* ── The phone ──────────────────────────────────────────────────────
     *
     * The request this whole path most often gets wrong, because "make it fit
     * mobile" is the one request whose success is measurable and was never
     * measured. The responsive gate reads what is written in the document —
     * see qa/responsive.ts, and MEASURED there for what it cannot see without
     * a browser. Its errors are the two defects true in every document that
     * has them, which is exactly the standard this file holds itself to. */
    const errorsIn = (html: string): string[] =>
      staticResponsiveGate(html, [])
        .issues.filter((issue) => issue.severity === "error")
        .map((issue) => `${issue.rule} (${issue.where})`);

    const afterErrors = errorsIn(after);

    if (wantsPhone) {
      criteria.push(
        criterion(
          "fits-phone",
          "nothing in the page is wider than a phone",
          "error",
          afterErrors.length === 0,
          afterErrors.length === 0 ? null : `still too wide for a phone: ${afterErrors.join("; ")}`,
        ),
      );

      /* Without this the page does not lay out on a phone at all, whatever
         else is right about it. autofix inserts it on the way past, so this
         normally passes — and an edit that removed it is exactly the case
         worth catching. */
      const hasViewport = /<meta[^>]+name\s*=\s*["']viewport["']/i.test(after);
      criteria.push(
        criterion(
          "viewport",
          "the page has a viewport tag",
          "error",
          hasViewport,
          hasViewport ? null : "the viewport meta tag is missing, so a phone will lay the page out at desktop width",
        ),
      );
    }

    /* ── And what the edit must not have cost ───────────────────────────
     *
     * §14, in one criterion: an edit is not allowed to make the phone layout
     * worse than it found it, whatever it was asked for. Only NEW errors
     * count — a page that arrived with a fixed-width table and still has one
     * has not regressed, and failing an unrelated edit over a defect it did
     * not cause is how a gate gets turned off. */
    const introduced = afterErrors.filter((error) => !errorsIn(before).includes(error));
    criteria.push(
      criterion(
        "no-new-overflow",
        "the change did not break the phone layout",
        "error",
        introduced.length === 0,
        introduced.length === 0 ? null : `the change introduced ${introduced.join("; ")}`,
      ),
    );
  } catch {
    /* Nothing checked. The caller reads that as no evidence either way and
       keeps the edit, which is what it did before this module existed. */
    return { complete: true, criteria: [], unmet: [], unchecked: [], reason: null };
  }

  const unmet = criteria.filter((result) => result.met === false && result.severity === "error");
  const unchecked = criteria.filter((result) => result.met === null);

  return {
    complete: unmet.length === 0,
    criteria,
    unmet,
    unchecked,
    reason: unmet.length === 0 ? null : (unmet[0].detail ?? unmet[0].what),
  };
}

/**
 * The verifier's findings, as the editing model is given them.
 *
 * §17: the feedback goes back into the next repair round rather than into a
 * log. Written as the thing still to do rather than as a complaint about the
 * last attempt — a model told "you failed" argues, and a model told "this is
 * what is still true of the page and here is what has to become true" edits.
 *
 * Empty when there is nothing to repair, so a caller can use it as the test of
 * whether to run another round at all.
 */
export function repairBrief(verification: Verification, message: string): string {
  if (verification.unmet.length === 0) return "";

  const lines = verification.unmet.map((result) => `- ${result.what} — ${result.detail ?? "not true of the page"}`);

  return `THE LAST ATTEMPT DID NOT LAND. This is a second pass at the same request, and the page in front of you is the one that attempt produced.

What was asked for:
${message.trim()}

What is still not true of the page, measured rather than guessed:
${lines.join("\n")}

Change what has to change for those to be true and nothing else. The rest of the page is as it should be — this is a repair of one thing, not another go at the whole request.`;
}

/**
 * What to tell the person, when the edit did not do what they asked.
 *
 * Honest and specific, because the alternative is the failure this file was
 * written about: "Done." on a page where nothing was done, and a person
 * looking at their own site to find out. It says what was checked, what is not
 * true, and what to do — in that order, because that is the order somebody
 * reading it asks the questions.
 */
export function describeVerification(verification: Verification): string {
  if (verification.unmet.length === 0) return "";

  const first = verification.unmet[0];
  const rest = verification.unmet.length - 1;

  return [
    `I checked the page afterwards and ${first.detail ?? first.what}`,
    rest > 0 ? ` (and ${rest} other ${rest === 1 ? "thing" : "things"} the request asked for).` : ".",
    " I've kept what did land — say which part you want another go at and I'll take it on its own.",
  ].join("");
}
