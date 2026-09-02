/* What kind of thing a build is, which decides what it is built from.
 *
 * Every full build used to run on one prompt. One prompt describing "a page"
 * in general terms, for a store, a blog, a landing page and an application
 * alike — and a prompt that has to describe all four describes none of them.
 * What came back was the average of them: a hero, three feature cards, a
 * pricing table and a footer, whatever had been asked for. A demo of a website
 * rather than the website.
 *
 * So the kind is decided first, and each kind is built from its own blueprint
 * (src/lib/builder/blueprints). A landing page is not given a cart. A store is
 * not given a hero and three feature cards and called done. A blog is a
 * publication with articles in it. An app has sign-in, views, data and the
 * shape of a back end behind it.
 *
 * The four are deliberately few. Every kind is a prompt someone has to maintain
 * and a set of rules that has to stay true, and a fifth kind that is really a
 * variation of a fourth makes both worse. What varies within a kind — a SaaS
 * landing page against a restaurant one — varies in the brief, which is the
 * right place for it.
 *
 * This file is pure on purpose: regexes, labels and a scoring function, no SDK
 * import. It is read by the browser bundle (for the label on a project row) and
 * compiled on its own by tools/check-blueprint.mjs. The model fallback lives
 * next door in classify-kind.ts, which is server-only. */

export const BUILD_KINDS = ["landing", "ecommerce", "blog", "webapp"] as const;

export type BuildKind = (typeof BUILD_KINDS)[number];

export function isBuildKind(value: unknown): value is BuildKind {
  return typeof value === "string" && (BUILD_KINDS as readonly string[]).includes(value);
}

/** What each kind is called where a person reads it. */
export const KIND_LABEL: Record<BuildKind, string> = {
  landing: "Landing page",
  ecommerce: "Online store",
  blog: "Blog",
  webapp: "Web app",
};

/** The one line the chat says about what it is about to build. */
export const KIND_BLURB: Record<BuildKind, string> = {
  landing: "a landing page — one audience, one offer, one thing to do",
  ecommerce: "a storefront — catalogue, cart and a checkout that adds up",
  blog: "a publication — real articles, categories and an archive",
  webapp: "a web app — sign-in, views, data, and the back end it runs on",
};

export type KindResult = {
  kind: BuildKind;
  confidence: number;
  source: "override" | "heuristic" | "model";
};

/* ── Signals ──────────────────────────────────────────────────────────────
 *
 * The same shape as the message classifier in intent.ts, and for the same
 * reason: real briefs carry more than one signal, and the first regex to match
 * is not reliably the one that matters. "a landing page for my Shopify store"
 * says landing page and says store, and a first-match reader gets it exactly
 * backwards — which is the complaint this file exists to answer. */

/* Someone naming the kind outright. This is the strongest signal there is:
   whatever else the sentence mentions, a person who typed "landing page" has
   told you what they want and does not need it inferred. */
const LANDING_EXPLICIT =
  /\b(landing|squeeze|sales|lead(-| )(capture|gen(eration)?)|waitlist|coming[- ]soon|launch|promo(tion(al)?)?|single[- ]page|marketing)\s*(page|site)\b|\b(landing|one[- ]?pager)\b(?=[^a-z]|$)/i;

/* Page-shaped things that are landing pages by another name. A portfolio, a
   restaurant's site, an event page: one page, one audience, one action. */
const LANDING_SHAPE =
  /\b(portfolio|resume|cv|personal site|about page|event page|conference page|menu page|brochure|microsite|link in bio|linktree|profile page|teaser)\b/i;

/* Selling. Split in two because they are different strengths of evidence.
   Naming a store is a description; naming a cart is a requirement. */
const COMMERCE_NOUN =
  /\b(e[- ]?commerce|online store|storefront|web ?shop|shop|store|boutique|marketplace|dropship(ping)?|merch|catalog(ue)?|product (page|line|range)|inventory)\b/i;

const COMMERCE_FUNCTION =
  /\b(cart|basket|checkout|add to (cart|bag|basket)|payments?|pay(ments)? (page|flow)|sku|variants?|order (form|management|history)|shipping|fulfil?lment|coupon|discount code|subscription box|sell(ing)? (products?|online|goods|items?))\b/i;

/* Naming the platform something is sold on. Evidence that selling happens
   somewhere, and deliberately weaker than naming a cart: "my Shopify store" is
   a fact about a business, and every page a business has is not its shop. */
const COMMERCE_PLATFORM = /\b(stripe|shopify|woo ?commerce|paypal|square|gumroad|etsy|big ?commerce)\b/i;

/* Publishing. WordPress is here rather than in a platform of its own: what
   people mean by "a WordPress site" is, nine times in ten, a content site with
   posts and categories, and the blueprint for one says so in WordPress's own
   vocabulary. A WooCommerce brief is caught by COMMERCE_FUNCTION above and
   goes where it belongs, which is the store. */
const PUBLISHING =
  /\b(blog|wordpress|word ?press|wp|cms|content site|magazine|publication|newsletter site|news site|editorial|journal|articles?|posts?|essays?|writing site|substack|ghost|medium[- ]style|zine)\b/i;

/* The WordPress vocabulary specifically, which the blueprint answers in kind. */
const WORDPRESS = /\b(wordpress|word ?press|woo ?commerce|gutenberg|elementor|wp[- ](admin|theme|plugin))\b/i;

/* Software with people signed into it. The signal is not "app" — half the
   briefs in the world say app — it is state that belongs to somebody: an
   account, a record, a role, a table of their data. */
const APP_NOUN =
  /\b(web ?app|app(lication)?|saas|platform|portal|dashboard|admin (panel|area|tool)|back ?office|crm|erp|cms admin|internal tool|booking system|scheduler|tracker|management system|project management|help ?desk|ticketing|inventory system|analytics|reporting tool|control panel|workspace tool)\b/i;

const APP_FUNCTION =
  /\b(sign[- ]?(in|up)|log[- ]?in|authenticat(e|ion)|accounts?|users?|roles?|permissions?|multi[- ]?tenant|database|back ?end|api|crud|supabase|postgres|record (list|detail)|data table|team members?|invite|onboarding flow|settings page|billing (page|portal)|admin (users|roles))\b/i;

/* "front end and back end", "full stack" — an explicit ask for both halves. */
const FULL_STACK = /\b(full[- ]?stack|front[- ]?end and back[- ]?end|back[- ]?end and front[- ]?end|end[- ]to[- ]end app)\b/i;

/* ── Weighing ─────────────────────────────────────────────────────────────
 *
 * A winner has to clear a floor and beat the runner-up by a margin, exactly as
 * in intent.ts. Anything else is handed to the model rather than guessed at —
 * a brief that reads equally as a store and as an app is a brief these regexes
 * have not understood, and saying so is cheaper than being confidently wrong
 * about which of two very different pages to build. */
const FLOOR = 3;
const MARGIN = 2;

type Scores = Record<BuildKind, number>;

export function scoreKind(brief: string): Scores {
  const scores: Scores = { landing: 0, ecommerce: 0, blog: 0, webapp: 0 };
  const m = brief;

  /* Five, which no single signal below can match on its own. Someone who says
     "landing page" gets a landing page even though they also said "for my
     store" — that sentence is a page about a store, not a store, and building
     them a checkout is the thing they came here to complain about. */
  if (LANDING_EXPLICIT.test(m)) scores.landing += 5;
  if (LANDING_SHAPE.test(m)) scores.landing += 4;

  /* Which is why selling has to be able to outrank it. A cart, a checkout and
     a catalogue are not decoration on a landing page; they are the product. Two
     or more of them and the brief is a store whatever it called itself. */
  const commerceFunctions = countMatches(m, COMMERCE_FUNCTION);
  if (commerceFunctions > 0) scores.ecommerce += 4;
  if (commerceFunctions > 1) scores.ecommerce += 2;
  if (COMMERCE_NOUN.test(m)) scores.ecommerce += 3;
  if (COMMERCE_PLATFORM.test(m)) scores.ecommerce += 2;

  if (PUBLISHING.test(m)) scores.blog += 4;
  if (WORDPRESS.test(m)) scores.blog += 2;

  const appFunction = APP_FUNCTION.test(m);
  if (APP_NOUN.test(m)) scores.webapp += 4;
  if (appFunction) scores.webapp += 3;
  /* Asked for both halves by name. Nothing else in this file is worth six. */
  if (FULL_STACK.test(m)) scores.webapp += 6;

  /* ── What a landing page is allowed to be about ──────────────────────────
     The rule this whole file was asked for. Someone who says "landing page"
     has named the kind, and a landing page is about something: a shop, a
     product, an app, a publication. Mentioning what it is about must not turn
     it into that thing — "a landing page for my Shopify store" is a page, and
     handing back a catalogue with a basket is the complaint.

     What does overturn it is machinery a landing page cannot contain. A cart
     and a checkout are not a subject, they are a shop; sign-in and accounts
     are not a subject, they are an application. So the other readings are
     cleared only when the brief names no such machinery — and when it does,
     they are left to win on their own weight. */
  if (LANDING_EXPLICIT.test(m) && commerceFunctions === 0 && !appFunction && !FULL_STACK.test(m)) {
    scores.ecommerce = 0;
    scores.blog = 0;
    scores.webapp = 0;
  }

  return scores;
}

/* How many distinct commerce requirements a brief names. Distinct, not total:
   "cart" twice is one requirement said twice, and it should not outweigh "cart
   and checkout", which is two. */
function countMatches(text: string, pattern: RegExp): number {
  const all = text.match(new RegExp(pattern.source, "gi")) ?? [];
  return new Set(all.map((hit) => hit.toLowerCase())).size;
}

/**
 * The leading reading regardless of how narrowly it leads.
 *
 * Used only when the model that was meant to settle it could not be reached.
 * Ties fall to `landing`, which is the safe end of being wrong: a landing page
 * built for a brief that wanted a store is a page someone can ask to extend,
 * where a store built for a brief that wanted a landing page is four sections
 * of shopping furniture nobody asked for and every one of them has to be
 * removed by hand.
 */
export function bestKindGuess(brief: string): BuildKind {
  const scores = scoreKind(brief.trim());
  let leader: BuildKind = "landing";
  for (const kind of BUILD_KINDS) {
    if (scores[kind] > scores[leader]) leader = kind;
  }
  return leader;
}

/** The free deterministic pass. Null when the brief is genuinely ambiguous. */
export function heuristicKind(brief: string): KindResult | null {
  const m = brief.trim();
  if (!m) return null;

  const scores = scoreKind(m);
  const ranked = BUILD_KINDS.map((kind) => ({ kind, points: scores[kind] })).sort(
    (a, b) => b.points - a.points,
  );

  const [best, runnerUp] = ranked;
  if (best.points < FLOOR || best.points - runnerUp.points < MARGIN) return null;

  /* Confidence from the margin rather than a table of constants: how sure these
     rules are is how far ahead the winner finished. Capped at 0.95 — a regex is
     never certain. */
  const confidence = Math.min(0.95, 0.6 + (best.points - runnerUp.points) * 0.06);
  return { kind: best.kind, confidence, source: "heuristic" };
}
