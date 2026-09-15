/* Which of the two things to build.
 *
 * A single self-contained HTML page, or a Next.js project of files. They are
 * not two qualities of the same product — they are different products, and the
 * line between them is not how big the brief is or how much somebody paid. It
 * is whether the thing being asked for can EXIST as one page.
 *
 * A page can do a great deal: sections, animation, a form that posts to a third
 * party, a modal that opens. What it cannot do is remember anybody. There is no
 * session, no server, no second route, no row belonging to a user. So the
 * moment a brief says "people sign in", one page has stopped being a choice
 * that was made and started being a wrong answer — the login opens, it looks
 * right, and it cannot work.
 *
 * SEPARATE FROM KIND, deliberately. kinds.ts asks what a site is ABOUT and this
 * asks what it has to DO, and the two come apart in both directions constantly.
 * "A landing page with a members area" is landing by kind and an app by stack.
 * "A dashboard for tracking my macros, just the design, no accounts" is webapp
 * by kind and a page by stack. Folding them into one classifier would make both
 * answers worse.
 *
 * BIASED TOWARD THE PAGE, and this is a decision rather than an oversight. The
 * single-page stack is the one that works today, previews instantly and has
 * built every project in the table. The tree is newer and heavier. So the page
 * is what happens unless there is positive evidence for the app — an absent
 * signal is not evidence, and a brief that says nothing about accounts is a
 * brief that does not want them.
 *
 * No SDK import: this must stay readable by the browser and compilable on its
 * own, the same as kinds.ts.
 */

import type { BuildKind } from "./kinds";

export const STACKS = ["standalone-html", "nextjs"] as const;
export type Stack = (typeof STACKS)[number];

export type StackNeeds = {
  stack: Stack;
  /** Real accounts: somebody signs in and the page knows who they are. */
  auth: boolean;
  /** Anything that has to still be there tomorrow. Implied by auth. */
  backend: boolean;
  /** More than one address. A page has one, whatever it scrolls past. */
  routes: boolean;
  /** The words that decided it, so a wrong answer can be argued with. */
  why: string[];
  /* Whether this was read off the brief or inferred from the shape of it.
   *
   * The distinction is worth money. Building a project when somebody wanted a
   * landing page spends a build's credits on a scaffold they did not ask for,
   * and the only way to find out is to look at it. So where the evidence is
   * soft the caller asks instead of guessing — see stackQuestion. Certain
   * means do not ask: a brief that says "log in" has said which it is, and a
   * question about it is a question nobody needed. */
  certain: boolean;
};

/* Words people use for software and also for a page about software.
 *
 * "A dashboard for my gym" is a real application about half the time and a
 * marketing page with a screenshot on it the other half. Nobody can tell from
 * the word, which is exactly why these do not decide anything on their own —
 * they are what makes a brief worth asking about. */
const LOOSE = /\b(dashboard|portal|platform|system|tool|admin|back ?office|app)\b/i;

/* ── The signals ───────────────────────────────────────────────────────────
 *
 * Each of these is a phrase that means the thing cannot be one page. They are
 * written narrowly and the near misses are handled below, because the costly
 * mistake here is not missing an app — it is turning "sign up for our
 * newsletter" into a Next.js project with a users table.
 */

/* Signing in. The one that settles it: a session is the thing a page has not
   got. Note what is NOT here — "sign up" on its own, which is the single most
   common phrase on a marketing page and almost never means an account. It is
   handled separately below. */
const AUTH = [
  /\b(log ?in|logging in|log ?out|sign ?-?in|signed ?-?in|signing in)\b/i,
  /\b(authenticat\w+|auth flow|oauth|sso|single sign)\b/i,
  /\b(password|forgot password|reset password|magic link|2fa|two[- ]factor)\b/i,
  /\b(user accounts?|member accounts?|create an account|my account|account page)\b/i,
  /* ── An account, said the way people say it ─────────────────────────────
   *
   * The line above requires the words to be adjacent, so it reads "create an
   * account" and misses "customers create accounts", "let people set up an
   * account", "each shopper makes their own account". That is not a rare
   * phrasing — it is the commonest one, and the gap had a measurable cost:
   * kinds.ts scores a bare "accounts" as evidence of software, so a brief
   * saying "customers create accounts" was routed to the webapp blueprint by
   * one file and read as needing no authentication by this one. The word that
   * decided what to build was the same word that failed to turn auth on.
   *
   * Still narrow. The verb has to be there: an account somebody CREATES, SETS
   * UP, MAKES or REGISTERS. "Account" on its own stays out, because "your
   * account manager will call you" is a sentence on a thousand landing pages. */
  /\b(?:creat\w+|make|makes|making|open|opens|set ?up|sets ?up|register|registers|registering)\s+(?:an?\s+|their\s+|his\s+|her\s+|your\s+|my\s+|own\s+)*(?:new\s+)?accounts?\b/i,
  /* Whose accounts they are. "Customer accounts", "client accounts", "student
     accounts" — the same shape as "user accounts" above, which was written for
     two nouns and meets every other kind of customer there is. */
  /\b(customers?|clients?|shoppers?|buyers?|students?|patients?|staff|employees?|guests?|subscribers?|tenants?) accounts?\b/i,
  /* ── Data that belongs to somebody ──────────────────────────────────────
   *
   * The other half of what an account IS, and the half a brief is more likely
   * to describe than the sign-in itself. "Customers can track their orders",
   * "save their addresses", "see their booking history" — every one of those
   * needs the page to know who is asking, and none of them contains a word the
   * patterns above would catch.
   *
   * The possessive is doing the work, so it is required: "track orders" is a
   * shop's own back office and is ADMIN's business, while "track THEIR orders"
   * is a customer looking at their own. The nouns are listed rather than left
   * open for the same reason the rest of this file lists things — "their
   * favourite recipe" is not a session. */
  /\b(?:track|tracks|tracking|save|saves|saving|store|stores|view|views|see|sees|manage|manages|access|accesses|re-?order)\s+(?:their|his|her|my|your)\s+(?:own\s+)?(?:orders?|order history|bookings?|reservations?|appointments?|addresses|profiles?|history|favou?rites?|wish ?lists?|saved items?|purchases?|subscriptions?|documents?|files?|data|progress)\b/i,
  /\b(members? (?:area|only|portal|dashboard)|logged[- ]in users?)\b/i,
  /\b(user (?:profiles?|roles?|permissions?)|role[- ]based)\b/i,
  /* Roles and permissions named as a pair. Either word alone is too common —
     "file permissions", "role" as a job title — but the pair is only ever one
     thing, and it is a thing that cannot exist without knowing who is asking. */
  /\b(?:roles?\s*(?:,|and|&)\s*permissions?|permissions?\s*(?:,|and|&)\s*roles?)\b/i,
  /* Accounts listed as a feature of the thing being built.
   *
   * "Team project management application with accounts, projects, tasks and
   * permissions" named accounts first and was read as needing no
   * authentication, because every pattern above wants either an adjective in
   * front of the word or a verb before it, and a feature list has neither.
   * kinds.ts scores a bare "accounts" as evidence of software; this is the
   * same reading, held to the one position where the word cannot mean
   * anything else. */
  /\b(?:with|and|plus|including|featuring|supports?|offers?)\s+(?:user |customer |member |client )?accounts?\b/i,
  /\b(protected (?:routes?|pages?)|require sign|gated content)\b/i,
];

/* "Sign up" and "register" mean an account ONLY when they are not the thing
   every landing page on earth says. A waitlist is not a users table. */
const SIGNUP = /\b(sign ?-?up|signup|register|registration)\b/i;
/* What people sign up FOR that is not an account.
 *
 * The list began as mailing lists, which is the commonest of these and not the
 * only one. "Sign up for a class", "sign up for the workshop", "register for
 * the event" are a booking form and a confirmation email — there is no session
 * afterwards and nothing to log back into, and reading them as accounts is how
 * a yoga studio's one-page site arrives with a users table and a schema
 * migrated into a database. Every entry here is a thing somebody signs up for
 * ONCE, at a time, rather than an identity they keep. */
const NOT_REALLY_SIGNUP =
  /\b(newsletter|mailing list|waitlist|wait list|early access|updates|launch list|subscribe|email list|beta list|your interest|class(?:es)?|courses?|workshops?|sessions?|webinars?|events?|trials?|demos?|tours?|consultations?|a table|a slot|a spot|a place)\b/i;

/* Data that has to outlive the request. A form that emails somebody is fine on
   a page; a form whose answers are LOOKED AT LATER is not. */
const BACKEND = [
  /\b(database|supabase|postgres|sql|crud)\b/i,
  /\b(save|store|persist)\w*\b[^.]{0,40}\b(data|records?|entries|answers|responses|submissions?)\b/i,
  /\b(bookings?|reservations?|appointments?)\b[^.]{0,30}\b(manage|system|track|calendar)\b/i,
  /\b(orders?|inventory|stock levels?|customers?)\b[^.]{0,30}\b(manage|track|system)\b/i,
  /\b(admin (?:panel|area|dashboard)|back ?office|cms)\b/i,
  /\b(upload|submit)\w*\b[^.]{0,30}\b(and (?:save|store|keep)|to the database)\b/i,
];

/* More than one address. A page scrolls; it does not navigate. */
const ROUTES = [
  /\b(multi[- ]?page|several pages|multiple pages|separate pages)\b/i,
  /\b(routes?|routing|url structure|nested pages)\b/i,
  /\b(a page (?:for|per) each|its own page)\b/i,
];

/* Somebody saying, in as many words, that they want the project rather than
   the page. Worth honouring on its own — this is not a guess about what they
   need, it is what they asked for. */
const ASKS_FOR_APP = [
  /\b(next\.?js|nextjs|react app|full[- ]?stack|web ?app(?:lication)?|saas app)\b/i,
  /\b(file tree|codebase|repo|repository|project files|source files)\b/i,
];

/* And the opposite: somebody being explicit that one page is the point. Held
   against everything except a real auth signal — "a one-page site with a
   members login" is a contradiction, and the login is the half that cannot be
   faked. */
const ASKS_FOR_PAGE = [
  /\b(single[- ]page|one[- ]pager?|one page (?:site|website)|just a page)\b/i,
  /\b(landing page only|static (?:page|site|html)|plain html|html file)\b/i,
  /\b(brochure|coming soon page|under construction)\b/i,
  /\b(?:just|only) the (?:front[- ]?end|design|ui|markup)\b/i,
  /\b(?:front[- ]?end|design|ui) only\b/i,
  /\bmock-?up\b/i,
  /* Saying what it does NOT need, which is a thing people say precisely when
     the brief would otherwise read as an app. "A dashboard design, no accounts
     or data" is webapp-shaped by every other measure and is a page. */
  /\bno (?:accounts?|logins?|sign[- ]?in|auth\w*|database|back[- ]?end|server|users?)\b/i,
  /\bwithout (?:accounts?|logins?|auth\w*|a database|a back[- ]?end)\b/i,
];

function any(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/** The first pattern that matched, for the record of why. */
function firstMatch(patterns: RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const found = text.match(pattern);
    if (found) return found[0].toLowerCase();
  }
  return null;
}

/**
 * Which stack this brief needs, and what it needs it for.
 *
 * Deterministic and free. Never throws — a brief nobody can classify gets the
 * page, which is the safe half of a wrong answer: a page that should have been
 * an app can be rebuilt, and it previews in the meantime.
 */
export function decideStack(brief: string, kind?: BuildKind): StackNeeds {
  const text = brief ?? "";
  const why: string[] = [];

  /* AUTH. The signal that cannot be satisfied by a page under any
     circumstances, so nothing below overrides it. */
  const authPhrase = firstMatch(AUTH, text);
  let auth = authPhrase !== null;
  if (authPhrase) why.push(`"${authPhrase}" means real sessions, which one page cannot have`);

  /* "Sign up" only counts when it is not a mailing list. Checked as a whole
     brief rather than in a window: "sign up for early access" and "sign up to
     join the waitlist" put the giveaway several words away. */
  if (!auth && SIGNUP.test(text) && !NOT_REALLY_SIGNUP.test(text)) {
    auth = true;
    why.push(`"${text.match(SIGNUP)?.[0].toLowerCase()}" without a newsletter or waitlist beside it means accounts`);
  }

  const backendPhrase = firstMatch(BACKEND, text);
  const backend = auth || backendPhrase !== null;
  if (backendPhrase) why.push(`"${backendPhrase}" is data that has to still be there tomorrow`);

  const routePhrase = firstMatch(ROUTES, text);
  const routes = routePhrase !== null;
  if (routePhrase) why.push(`"${routePhrase}" is more than one address`);

  const askedPhrase = firstMatch(ASKS_FOR_APP, text);
  if (askedPhrase) why.push(`"${askedPhrase}" is the project being asked for by name`);

  /* A webapp by kind is software people sign into — that is the definition the
     kind classifier works to, so it carries here rather than being re-derived.
     It is evidence rather than proof: a brief can be webapp-shaped and still
     explicitly want one page, which the check below lets it say. */
  const appKind = kind === "webapp";
  if (appKind) why.push("this was classified as software people sign into");

  /* Hard evidence: something in the brief that cannot be done on one page, or
     the project asked for by name. Any of these settles it. */
  const hardEvidence = auth || backendPhrase !== null || routePhrase !== null || askedPhrase !== null;

  /* Soft evidence: the shape of the thing rather than anything it said. A kind
     of "software people sign into" that never mentions signing in, or a word
     that means an app and also means a page about an app. Enough to stop
     defaulting, not enough to spend a build on. */
  const loosePhrase = firstMatch([LOOSE], text);
  const softEvidence = appKind || loosePhrase !== null;
  if (loosePhrase && !hardEvidence) {
    why.push(`"${loosePhrase}" is a word for software and also for a page about software`);
  }

  const wantsApp = hardEvidence || softEvidence;

  /* Somebody saying "one page" outranks everything except auth. They have told
     us what they want; the only thing that overrules it is a requirement that
     cannot be delivered, and a login is the only one of those.
   *
     Not when they also asked for the project by name, though. "I want the file
     tree and the codebase, not just a page" contains "just a page" and means
     the opposite of it — a negation this is not going to parse, and does not
     have to: naming the thing you want beats a phrase that only looks like
     naming the thing you don't. */
  const pagePhrase = askedPhrase ? null : firstMatch(ASKS_FOR_PAGE, text);
  if (pagePhrase && !auth) {
    return {
      stack: "standalone-html",
      auth: false,
      backend: false,
      routes: false,
      why: [`"${pagePhrase}" — one page is what was asked for`],
      certain: true,
    };
  }
  if (pagePhrase && auth) {
    why.push(`"${pagePhrase}" was asked for, but a sign-in cannot be built as one`);
  }

  if (!wantsApp) {
    return {
      stack: "standalone-html",
      auth: false,
      backend: false,
      routes: false,
      why: ["nothing here needs a session, a second route or data that outlives the visit"],
      certain: true,
    };
  }

  /* Soft evidence only. The lean is toward the project, because that is what
     the shape suggests — but it is a lean, and the caller should ask rather
     than spend a build finding out. */
  return { stack: "nextjs", auth, backend, routes, why, certain: hardEvidence };
}

/**
 * The question to put to somebody, when the brief did not settle it.
 *
 * Written as a choice between two things they recognise rather than between
 * two stacks, because "standalone-html or nextjs" is our vocabulary and not
 * theirs. What they are actually choosing is whether anyone signs in.
 */
export function stackQuestion(needs: StackNeeds): string {
  return needs.certain
    ? ""
    : "Before I spend a build on it — is this a site people just look at, or software they sign into? They cost very different amounts and the wrong one is a rebuild, so I would rather ask than guess.";
}

/* The two answers, the likelier one first.
 *
 * ── Why the price is in the blurb ────────────────────────────────────────
 *
 * This question is asked at the one moment it can still save somebody money,
 * and until now it did not mention money. A person picked between "a site" and
 * "software" on the words alone, and only found out afterwards that one of
 * them had cost several times the other.
 *
 * The difference is not in the per-call rate — a page and a twelve-file project
 * both land on the generate band's ceiling, so a single call prices the same
 * either way. It is that a project is built in STAGES, one model call each, so
 * the bill is that ceiling several times over, and the carried context is
 * larger on every one of them.
 *
 * No exact figure, deliberately. It depends on the model, on how many stages
 * the brief turns into, and on what the person has already said — quoting "40
 * credits" here would be a number this function cannot actually know, and a
 * quote that turns out wrong is worse than an honest comparison. The shape of
 * the difference is what somebody needs to choose correctly, and the shape is
 * what is stated. */
export function stackOptions(needs: StackNeeds): { stack: Stack; label: string; blurb: string }[] {
  const page = {
    stack: "standalone-html" as const,
    label: "A site people look at",
    blurb:
      "One page, everything on it. One build, the cheapest thing here, and the fastest to change afterwards.",
  };
  const app = {
    stack: "nextjs" as const,
    label: "Software people sign into",
    blurb:
      "A full Next.js project with accounts, its own pages and a database behind it. Built in stages, so it costs several times a page — pick this only if people really do sign in.",
  };

  return needs.stack === "nextjs" ? [app, page] : [page, app];
}

/** The one sentence a person is told about it, when it is worth telling them. */
export function explainStack(needs: StackNeeds): string {
  if (needs.stack === "standalone-html") {
    return "Building this as a single page — it doesn't need accounts or a database, and a page is faster to change.";
  }

  const parts: string[] = [];
  if (needs.auth) parts.push("people signing in");
  if (needs.backend && !needs.auth) parts.push("data that has to persist");
  if (needs.routes) parts.push("more than one page");

  return parts.length > 0
    ? `Building this as a full Next.js project — ${parts.join(" and ")} can't be done as a single page.`
    : "Building this as a full Next.js project.";
}
