import type { AssetType, VisualDirection } from "@/lib/builder/assets/asset-types";
import type { BuildKind } from "@/lib/builder/kinds";

/* Choosing WHICH photograph, not merely finding one.
 *
 * The planner already does the hard part. It settles one visual direction for
 * the whole project — register, palette, lighting, environment, mood — and
 * gives every slot a spec that inherits it, so eight pictures read as one shoot
 * rather than eight companies. All of that reached the stock provider, and the
 * stock provider dropped it: it took the spec's subject, cut it at the first
 * comma, asked Unsplash for ONE result, and used whatever came back.
 *
 * Three things follow from that, and all three were visible on real pages.
 *
 *   THE DIRECTION WAS NEVER SPENT. "Premium AI legal assistant, luxury
 *   editorial register" searched for the subject alone, so the register that
 *   was carefully chosen made no difference to the photograph that arrived.
 *
 *   THERE WAS NOTHING TO CHOOSE BETWEEN. per_page=1 and results[0] is not a
 *   selection, it is an acceptance. A technically valid photograph of the wrong
 *   thing ranks first as easily as the right one.
 *
 *   A STOREFRONT GOT ONE PHOTOGRAPH EIGHT TIMES. Eight product slots with the
 *   same subject make the same query, and the same query returns the same first
 *   result. Nothing errored; the page simply had one picture on it, repeated.
 *
 * So this file is the part that was missing: build several queries from what
 * the planner decided, ask for a page of results rather than one, and rank what
 * comes back against what was actually wanted.
 *
 * ONE HONEST LIMIT, stated here because it shapes everything below. Unsplash
 * and Pexels have no negative-term syntax — there is no way to ask for "premium
 * technology, NOT shopping". So the negatives are applied to the RESULTS
 * instead: candidates whose own words betray the wrong category are dropped
 * after the search. That is why this is a scorer and not just a query builder. */

export type Orientation = "landscape" | "portrait" | "squarish";

/** What a slot actually wants, gathered from the plan rather than guessed. */
export type StockWant = {
  /** What the picture is of, from the spec the planner wrote. */
  subject: string;
  type: AssetType;
  kind: BuildKind;
  /** The project's register — "luxury editorial", "warm documentary". */
  register: string;
  orientation: Orientation;
  /** The longest edge this quality level asked for. */
  minWidth: number;
};

/** One result from a stock search, in the only shape both APIs agree on. */
export type Candidate = {
  id: string;
  description?: string | null;
  tags?: string[];
  width?: number;
  height?: number;
};

/* ── Building the searches ─────────────────────────────────────────────────
 *
 * A ladder, most specific first, because stock search degrades in a particular
 * way: every word added narrows the result set, and past about six words it
 * narrows it to nothing. A single long query is therefore not "more precise",
 * it is a coin flip between an excellent match and no match at all.
 *
 * So specificity is tried and then given up, one rung at a time, and the first
 * rung that returns something worth having wins. */

/* What each kind of slot is, in the words a photographer would use. These are
   search terms, not descriptions — "product photography studio" finds product
   photography, where "product" alone finds anything anybody sells. */
const TYPE_TERMS: Partial<Record<AssetType, string>> = {
  hero: "",
  product: "product photography studio",
  portrait: "portrait professional",
  lifestyle: "lifestyle candid",
  editorial: "editorial",
  "article-cover": "editorial documentary",
  background: "texture minimal abstract",
  gallery: "",
};

/* The words in a register that a photograph can actually be tagged with.
   "luxury editorial" is worth searching; "considered, quiet, expensive" is a
   mood note for a generation model and finds nothing on a stock site. */
const REGISTER_TERMS = /\b(luxury|premium|editorial|documentary|clinical|technical|industrial|minimal|fashion|press|studio)\b/gi;

/* Words that describe the WEBSITE rather than the photograph. A person writes
   "build me a landing page for an AI legal assistant", and searching for the
   word "landing" returns aeroplanes. */
const NOT_A_SUBJECT =
  /\b(website|web ?site|page|landing|homepage|site|app|web ?app|store|shop|storefront|blog|platform|build|create|make|design|premium|modern|beautiful|clean|responsive|professional)\b/gi;

/** The subject as a searchable phrase: what it is OF, at most a few words. */
export function subjectTerms(subject: string): string {
  return subject
    .replace(NOT_A_SUBJECT, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 5)
    .join(" ");
}

/** What to fall back to when a project's own subject finds nothing. */
const KIND_TERMS: Record<BuildKind, string> = {
  landing: "modern technology editorial",
  ecommerce: "product photography studio",
  blog: "editorial documentary photography",
  news: "press photography reportage",
  webapp: "workspace technology minimal",
};

/**
 * The searches to try, in order, most specific first.
 *
 * Between two and four. Fewer than two is no ladder at all; more than four is
 * four round trips on the path of a build that has a deadline.
 */
export function searchTerms(want: StockWant): string[] {
  const subject = subjectTerms(want.subject);
  const type = TYPE_TERMS[want.type] ?? "";
  const register = (want.register.match(REGISTER_TERMS) ?? []).slice(0, 2).join(" ");

  const ladder = [
    [subject, type, register],
    [subject, type],
    [subject],
    [KIND_TERMS[want.kind], type],
  ]
    .map((parts) => parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim())
    .filter((term) => term.length >= 3);

  /* Deduplicated with order kept: when a slot has no type term and no register,
     the first three rungs collapse to the same query, and asking for it three
     times is three identical round trips. */
  return [...new Set(ladder)].slice(0, 4);
}

/* ── Keeping the wrong category out ────────────────────────────────────────
 *
 * Cross-blueprint contamination is the failure that reads worst: a page for
 * accounting software with a photograph of a market stall on it. The picture is
 * fine, and it belongs to another website.
 *
 * Applied to results rather than to the query, because neither API takes a
 * negative term — see the note at the top of this file. */
/* Grouped rather than listed one word at a time, and the grouping is the whole
 * point.
 *
 * The first version dropped a term when the project's subject contained that
 * exact word. It was wrong in the way that matters: a grocery delivery service
 * had "grocery" dropped and kept "supermarket" — and its photographs are tagged
 * supermarket, aisle and trolley, so the rule filtered out precisely the
 * pictures that project needed. A near-miss on a negative list is worse than no
 * list, because it looks like it is working.
 *
 * So a group goes as a whole. If the subject touches the CATEGORY at all, none
 * of its words disqualify anything: a business about food gets food, a business
 * about shops gets shops. What is left is the real target — an accounting
 * product that has no business showing a market stall. */
type Contamination = {
  /** Words in a photograph's own caption that put it in the wrong category. */
  terms: string[];
  /** When the project is ABOUT this category, the whole group stands down. */
  belongsHere: RegExp;
};

/* Shops and food together, deliberately. They are one category from a
   software page's point of view — "this is not a shop and not a meal" — and
   splitting them let a grocery business keep half the list, which is the bug
   that made this a group in the first place. */
const RETAIL_AND_FOOD: Contamination = {
  terms: [
    "grocery", "groceries", "supermarket", "shopping cart", "shopping trolley",
    "buffet", "cuisine", "recipe", "restaurant", "farmers market",
  ],
  belongsHere:
    /* Suffixes matter here. "restaurants" is the word people write, and a
       pattern anchored on "restaurant" alone does not match it — which would
       leave restaurant software filtering out restaurant photographs, the exact
       failure this grouping exists to prevent. */
    /\b(food\w*|grocer\w*|supermarket\w*|meal\w*|recipe\w*|restaurant\w*|caf[eé]s?|catering|bakery|bakeries|kitchen\w*|dining|diner\w*|cook\w*|produce|nutrition\w*|menu\w*|shop\w*|retail\w*|store\w*|ecommerce|e-commerce|commerce|cart\w*|basket\w*|checkout|market\w*|deliver\w*)\b/i,
};

const OCCASIONS: Contamination = {
  terms: ["wedding", "beach holiday", "birthday party"],
  belongsHere: /\b(wedding\w*|event\w*|venue\w*|party|parties|celebration\w*|holiday\w*|travel|tourism|hotel\w*|resort\w*|photograph\w*)\b/i,
};

const SOFTWARE: Contamination = {
  terms: ["source code", "programming", "server room", "data centre", "data center", "code editor"],
  belongsHere:
    /\b(software|code|coding|program\w*|develop\w*|engineer\w*|tech\w*|saas|app|application|platform|api|data|server|cloud|ai|analytics|dashboard|devops|hosting)\b/i,
};

const FAKERY: Contamination = {
  terms: ["mockup", "template", "placeholder", "stock illustration"],
  belongsHere: /\b(mockup\w*|template\w*|wireframe\w*|design tool\w*|prototyp\w*)\b/i,
};

const CONTAMINATION: Record<BuildKind, Contamination[]> = {
  landing: [RETAIL_AND_FOOD, OCCASIONS],
  webapp: [RETAIL_AND_FOOD, OCCASIONS],
  ecommerce: [SOFTWARE],
  blog: [FAKERY],
  news: [FAKERY],
};

/**
 * The terms that disqualify a result for this project.
 *
 * A group whose category the project belongs to is dropped entirely — see the
 * note above CONTAMINATION, and the check that holds it: a grocery business
 * must still be able to get a photograph of a supermarket.
 */
export function contaminationFor(kind: BuildKind, subject: string): string[] {
  return CONTAMINATION[kind]
    .filter((group) => !group.belongsHere.test(subject))
    .flatMap((group) => group.terms);
}

/* ── Ranking what came back ────────────────────────────────────────────────
 *
 * The weights are the ones worth having, in the order they matter: is it of the
 * right thing, does it belong to this sort of website, does it suit this slot,
 * is it shaped and sized right, does it match the look.
 *
 * What this is NOT is a gate. A scorer that can reject every candidate turns a
 * page with imperfect photographs into a page with grey panels, and that is a
 * worse page — so scoring RANKS, and only contamination and duplication
 * actually disqualify. See pickBest, where that rule lives. */
const WEIGHTS = {
  subject: 0.4,
  kind: 0.2,
  section: 0.15,
  composition: 0.1,
  quality: 0.1,
  style: 0.05,
};

/** Everything a candidate says about itself, lowercased, in one string. */
function words(candidate: Candidate): string {
  return [candidate.description ?? "", ...(candidate.tags ?? [])].join(" ").toLowerCase();
}

/** What share of `terms` appear in `text`. */
function overlap(text: string, terms: string): number {
  const wanted = terms.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  if (wanted.length === 0) return 0;
  return wanted.filter((word) => text.includes(word)).length / wanted.length;
}

function shapeOf(candidate: Candidate): Orientation | null {
  if (!candidate.width || !candidate.height) return null;
  const ratio = candidate.width / candidate.height;
  if (ratio > 1.15) return "landscape";
  if (ratio < 0.87) return "portrait";
  return "squarish";
}

/** How well one candidate answers what was wanted, from 0 to 1. */
export function scoreCandidate(candidate: Candidate, want: StockWant): number {
  const said = words(candidate);

  const subject = overlap(said, subjectTerms(want.subject));
  const kind = overlap(said, KIND_TERMS[want.kind]);
  const section = overlap(said, TYPE_TERMS[want.type] ?? "");
  const style = overlap(said, want.register);

  /* A hero cropped from a portrait is a hero with its subject cut off. Shape is
     the one property here that is about the page rather than the picture. */
  const shape = shapeOf(candidate);
  const composition = shape === null ? 0.5 : shape === want.orientation ? 1 : 0;

  /* Enough pixels for the size asked for, and no credit for more: a 6000px
     photograph is not a better answer than a 2000px one, it is a slower one. */
  const quality = candidate.width ? Math.min(1, candidate.width / Math.max(want.minWidth, 1)) : 0.5;

  return (
    subject * WEIGHTS.subject +
    kind * WEIGHTS.kind +
    section * WEIGHTS.section +
    composition * WEIGHTS.composition +
    quality * WEIGHTS.quality +
    style * WEIGHTS.style
  );
}

/* Below this, a result is weak enough to be worth trying the next, broader
 * query before settling for it.
 *
 * Only ever a reason to KEEP LOOKING, never a reason to give up — see pickBest.
 * Stock descriptions are written by photographers, not by this system, and a
 * perfectly good picture of a laboratory may say nothing but "glassware". A
 * threshold treated as a gate would reject it and leave a hole in the page. */
export const WORTH_TRYING_AGAIN = 0.45;

export type Chosen = { candidate: Candidate; score: number } | null;

/**
 * The best of what came back, excluding anything already used in this build.
 *
 * `taken` is what stops a storefront showing one photograph eight times. Eight
 * product slots with the same subject produce the same query and the same
 * ranking, so without this the same picture wins every slot — which is exactly
 * what was happening, silently, on every build with repeated slots.
 */
export function pickBest(candidates: Candidate[], want: StockWant, taken: ReadonlySet<string>): Chosen {
  const avoid = contaminationFor(want.kind, want.subject);

  const eligible = candidates.filter((candidate) => {
    if (taken.has(candidate.id)) return false;
    const said = words(candidate);
    return !avoid.some((term) => said.includes(term));
  });

  if (eligible.length === 0) return null;

  let best = eligible[0];
  let bestScore = scoreCandidate(best, want);

  for (const candidate of eligible.slice(1)) {
    const score = scoreCandidate(candidate, want);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return { candidate: best, score: bestScore };
}

/** A slot and the project's direction, as the one thing this file reasons about. */
export function wantFor(opts: {
  subject: string;
  type: AssetType;
  kind: BuildKind;
  direction: VisualDirection;
  orientation: Orientation;
  minWidth: number;
}): StockWant {
  return {
    subject: opts.subject,
    type: opts.type,
    kind: opts.kind,
    register: opts.direction.register,
    orientation: opts.orientation,
    minWidth: opts.minWidth,
  };
}
