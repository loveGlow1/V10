#!/usr/bin/env node
/* Which of the two things to build: a page, or a project.
 *
 *   npm run check:stack
 *
 * The line is not size and it is not price. It is whether the thing asked for
 * can EXIST as one page. A page can do sections, animation, a form that posts
 * somewhere, a modal that opens. It cannot remember anybody — no session, no
 * second route, no row belonging to a user. So "people sign in" is not a
 * preference about stacks, it is a requirement one page cannot meet: the login
 * opens, it looks right, and it cannot work.
 *
 * Both mistakes are real and they are not symmetrical.
 *
 *   AN APP BUILT AS A PAGE is a broken product. The sign-in is a prop.
 *
 *   A PAGE BUILT AS AN APP is heavier and slower than it needed to be, and
 *   still works.
 *
 * So the default is the page and the app needs positive evidence — and the
 * whole middle section here is false positives, because the costly error is
 * turning "sign up for our newsletter" into a Next.js project with a users
 * table. Every landing page on earth says "sign up".
 *
 * No keys, no network — decideStack never calls a model.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-stack");
mkdirSync(out, { recursive: true });

execFileSync(
  "npx",
  ["tsc", "src/lib/builder/stack.ts", "--outDir", out, "--rootDir", "src",
   "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

const { decideStack, explainStack, stackQuestion, stackOptions } = await import(join(out, "lib/builder/stack.js"));

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const app = (brief, kind) => {
  const got = decideStack(brief, kind);
  has(got.stack === "nextjs", `app: "${brief}"`, `got ${got.stack} — ${got.why.join("; ")}`);
  return got;
};
const page = (brief, kind) => {
  const got = decideStack(brief, kind);
  has(got.stack === "standalone-html", `page: "${brief}"`, `got ${got.stack} — ${got.why.join("; ")}`);
  return got;
};

// ── The one the whole thing exists for ────────────────────────────────────

const login = app("a full web app with a login modal and auth");
has(login.auth === true, "and it knows accounts are the reason", login.why.join("; "));
has(login.backend === true, "and that accounts imply somewhere to keep them");

page("a single page html site for my barber shop");

// ── Signing in, in the words people use ───────────────────────────────────

for (const brief of [
  "users log in to see their bookings",
  "a members area behind a login",
  "sign in with Google",
  "add authentication so people have their own dashboards",
  "password reset flow",
  "a magic link login",
  "protected routes for logged-in users",
  "user profiles with roles and permissions",
  "my account page where they change their details",
  "two-factor auth on the admin",
]) app(brief);

// ── The false positives ───────────────────────────────────────────────────
/* THE SECTION THAT MATTERS. Every one of these says a word from the auth list
   and means nothing of the kind. Getting any of them wrong turns a brochure
   into a Next.js project with a users table. */

for (const brief of [
  "a landing page with a sign up form for our newsletter",
  "sign up to join the waitlist",
  "register for early access",
  "a coming soon page — sign up for updates",
  "signup box for the mailing list at the bottom",
  "let people subscribe, big sign up button in the hero",
  "a one page site with a sign up for beta list",
]) page(brief);

// ── Data that has to outlive the visit ────────────────────────────────────

for (const brief of [
  "save the responses to a database",
  "an admin panel to manage the content",
  "a booking system to manage appointments",
  "track orders and inventory in one system",
  "store submissions so we can look at them later",
  "a CMS for the team",
]) app(brief);

/* And the form that is NOT a database: one that emails somebody is exactly
   what a page is for. */
for (const brief of [
  "a contact form that emails us",
  "a form that sends an enquiry to our inbox",
  "a page with a Calendly embed for bookings",
]) page(brief);

// ── More than one address ─────────────────────────────────────────────────

app("a multi-page site with routes for each service");
app("separate pages for each product");
page("one long scrolling page with sections for each service");

// ── Asked for by name ─────────────────────────────────────────────────────

app("build it as a Next.js app");
app("I want the file tree and the codebase, not just a page");
app("a full-stack web application");

// ── Asked for as a page, by name ──────────────────────────────────────────
/* Somebody saying "one page" has told us what they want, and it outranks the
   soft signals. */

page("a one-pager for my consultancy");
page("just a landing page, static html");
page("a single-page portfolio, plain html file");
page("a brochure site for the practice");

/* EXCEPT auth, which is the only requirement that cannot be delivered as one
   page however clearly it was asked for. */
const contradiction = app("a single page site with a members login");
has(
  contradiction.why.some((line) => /cannot be built as one/.test(line)),
  "a one-page request with a login says why it was overruled",
  contradiction.why.join("; "),
);

// ── Kind is evidence, not the answer ──────────────────────────────────────

app("a tool for tracking my team's work", "webapp");

/* The one that comes apart in the other direction: webapp-shaped, explicitly
   design-only. The kind classifier is about what a thing is ABOUT; this is
   about what it has to DO. */
page("a dashboard design, just the front end, no accounts or data", "webapp");

/* And kind must not drag a landing brief across on its own. */
page("a landing page for our new headphones", "landing");
page("a restaurant site with the menu and opening hours", "landing");
page("a portfolio of my photography", "landing");

// ── The record of why ─────────────────────────────────────────────────────
/* A decision nobody can argue with is a decision nobody can correct. */

has(decideStack("").why.length > 0, "even an empty brief records a reason");
has(decideStack("a page").stack === "standalone-html", "and an empty-ish brief gets the safe half");
has(
  app("users log in").why.some((line) => /log ?in/i.test(line)),
  "the reason quotes the words that decided it",
);

// ── What the person is told ───────────────────────────────────────────────

has(
  /single page/i.test(explainStack(decideStack("a landing page for my gym"))),
  "a page build is explained as one",
);
has(
  /signing in/i.test(explainStack(decideStack("people log in to see their orders"))),
  "and an app build names the thing that forced it",
  explainStack(decideStack("people log in to see their orders")),
);

// ── When to ask, and when asking is noise ─────────────────────────────────
/* The reason this exists, in the words it was asked for: so we do not end up
 * wasting credit on a scaffold when somebody wanted a landing page. A build is
 * the most expensive thing here and the wrong one is only discoverable by
 * looking at it.
 *
 * But a question has a cost too, and it is not small — it is a round trip
 * before anything happens, on every build, for a decision that was usually
 * obvious. So the bar is: ask when the evidence is the SHAPE of the brief, and
 * never when the brief said it outright. */

const asks = (brief, kind) => {
  const got = decideStack(brief, kind);
  has(got.certain === false, `asks: "${brief}"`, `settled it as ${got.stack} — ${got.why.join("; ")}`);
  return got;
};
const settles = (brief, kind) => {
  const got = decideStack(brief, kind);
  has(got.certain === true, `settles: "${brief}"`, `wanted to ask — ${got.why.join("; ")}`);
  return got;
};

/* THE ONE. Words that mean software and also mean a page about software.
   Nobody can tell from the word, so nobody should guess. */
asks("a dashboard for tracking my macros");
asks("an admin portal for the team", "webapp");
asks("a platform for freelancers", "landing");
asks("build me an app for my gym");
asks("a system for the clinic", "webapp");

/* And a kind of "software people sign into" that never once mentions signing
   in. The kind classifier is reading the shape too. */
asks("something for managing my team's work", "webapp");

/* Never ask when the brief said it. A question here is a question nobody
   needed, on the path of somebody who was already clear. */
settles("a landing page for my gym", "landing");
settles("a restaurant site with the menu and opening hours", "landing");
settles("users log in to see their bookings");
settles("a members area behind a login", "webapp");
settles("a one-pager for my consultancy");
settles("just a landing page, static html");
settles("build it as a Next.js app");
settles("save the responses to a database");
settles("a multi-page site with routes for each service");
settles("a dashboard design, just the front end, no accounts or data", "webapp");

/* An ambiguous brief still leans, so the likelier answer is the first thing
   under the thumb rather than a coin toss presented as a choice. */
const leaning = asks("a dashboard for my gym", "webapp");
has(leaning.stack === "nextjs", "an ambiguous brief still leans somewhere");
has(
  stackOptions(leaning)[0].stack === "nextjs",
  "and the lean is offered first",
  stackOptions(leaning).map((o) => o.stack).join(" then "),
);
has(
  stackOptions(decideStack("a landing page for my gym"))[0].stack === "standalone-html",
  "a page-leaning brief offers the page first",
);

/* The question is asked in their words, not ours. */
const question = stackQuestion(leaning);
has(question.length > 0, "an uncertain decision produces a question");
has(!/nextjs|standalone|html|stack/i.test(question), "and it does not name a stack at them", question);
has(stackQuestion(decideStack("users log in")) === "", "a settled decision produces no question");

/* Both options always offered, so neither is a trap. */
has(stackOptions(leaning).length === 2, "both answers are offered");

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
