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
};

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
  /\b(members? (?:area|only|portal|dashboard)|logged[- ]in users?)\b/i,
  /\b(user (?:profiles?|roles?|permissions?)|role[- ]based)\b/i,
  /\b(protected (?:routes?|pages?)|require sign|gated content)\b/i,
];

/* "Sign up" and "register" mean an account ONLY when they are not the thing
   every landing page on earth says. A waitlist is not a users table. */
const SIGNUP = /\b(sign ?-?up|signup|register|registration)\b/i;
const NOT_REALLY_SIGNUP = /\b(newsletter|mailing list|waitlist|wait list|early access|updates|launch list|subscribe|email list|beta list)\b/i;

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

  const wantsApp = auth || backend || routes || askedPhrase !== null || appKind;

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
    };
  }

  return { stack: "nextjs", auth, backend, routes, why };
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
