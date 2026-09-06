#!/usr/bin/env node
/* An edit that came out broken never becomes the page.
 *
 *   npm run check:validate
 *
 * Everything upstream decides WHAT to change and refuses rather than guess.
 * None of it asks whether the document that came out is still a page — and a
 * patch can apply perfectly and still wreck the layout. A deletion that takes
 * an opening <div> and leaves its </div> behind is clean, successful and
 * unambiguous, and it closes a section early and folds the rest of the page
 * into it. Every stage reported success, because every stage succeeded. The
 * page was stored on top of the working one anyway.
 *
 * So these checks come in two halves, and the SECOND half is the one that
 * decides whether this file is an asset or a liability.
 *
 *   WHAT MUST BE REFUSED — the shapes a broken edit actually has.
 *
 *   WHAT MUST STILL PASS — ordinary edits, including the destructive ones
 *   people legitimately ask for. A validator that refuses "delete the pricing
 *   section" has reinvented the exact failure this codebase spent a night
 *   getting out of: a rule that is right in principle and wrong about the
 *   documents it meets. Every false refusal here is a person told no for
 *   asking correctly.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-validate");
mkdirSync(out, { recursive: true });

execFileSync(
  "npx",
  ["tsc", "src/lib/builder/validate.ts", "--outDir", out, "--rootDir", "src",
   "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

const { validatePage } = await import(join(out, "lib/builder/validate.js"));

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const refused = (before, after) => validatePage(before, after).ok === false;
const passes = (before, after) => validatePage(before, after).ok === true;
const why = (before, after) => validatePage(before, after).problem ?? "(allowed)";

/* A page in the shape a real one has: the document from the conversation this
   was written for, with its structure intact. */
const PAGE = `<!doctype html>
<html>
<head><style>.hero{color:#fff}</style></head>
<body>
  <header><nav><a href="#pricing">Pricing</a></nav></header>
  <main>
    <section class="hero">
      <h1>Build. Edit. Launch.</h1>
    </section>
    <section class="pricing">
      <div class="card">
        <h3>$4,000–$12,000 before a single visitor arrives</h3>
        <p>Agency quotes routinely land in that range.</p>
      </div>
      <div class="card">
        <h3>No-code builders trap you</h3>
        <p>Locked-in hosting and a template ceiling.</p>
      </div>
    </section>
  </main>
  <footer><p>Your code leaves with you, in full</p></footer>
</body>
</html>`;

// ── What must be refused ──────────────────────────────────────────────────

/* THE ONE. A deletion that takes the opening <div> and leaves its </div>.
   Applies cleanly, reports success, and closes the section early. */
const orphanClose = PAGE.replace('      <div class="card">\n        <h3>$4,000', "        <h3>$4,000");
has(refused(PAGE, orphanClose), "a deletion that leaves a closing tag behind is refused", why(PAGE, orphanClose));

/* And the mirror image: the closer goes, the opener stays, so everything below
   is swallowed into a section that never ends. */
const orphanOpen = PAGE.replace("      </div>\n      <div class=\"card\">", "      <div class=\"card\">");
has(refused(PAGE, orphanOpen), "a deletion that leaves a tag open is refused", why(PAGE, orphanOpen));

/* A line range off by one that ate the end of the document. */
const truncated = PAGE.slice(0, PAGE.indexOf("<footer>"));
has(refused(PAGE, truncated), "an edit that cut off the end of the page is refused", why(PAGE, truncated));

/* The </body> specifically — the tag whose loss means an edit ran past where it
   was meant to stop. */
has(
  refused(PAGE, PAGE.replace("</body>\n</html>", "")),
  "an edit that removed </body> is refused",
);

/* An empty result. Never what anybody typed. */
has(refused(PAGE, ""), "an edit that emptied the page is refused");
has(refused(PAGE, "   \n  "), "and whitespace is empty too");

/* Four fifths of the document gone. Not an edit anybody asked for. */
has(
  refused(PAGE, "<html><body><h1>Build. Edit. Launch.</h1></body></html>"),
  "an edit that removed most of the page is refused",
  why(PAGE, "<html><body><h1>Build. Edit. Launch.</h1></body></html>"),
);

/* An unclosed <style> swallows the document that follows it into CSS. */
has(
  refused(PAGE, PAGE.replace("</style>", "")),
  "an edit that left a <style> block open is refused",
  why(PAGE, PAGE.replace("</style>", "")),
);

/* Tokens that never became pictures. Both are bugs upstream, and storing either
   bakes a broken image into somebody's page permanently. */
has(
  refused(PAGE, PAGE.replace("<h1>Build. Edit. Launch.</h1>", '<img src="attachment:1">')),
  "an unresolved attachment token is refused",
);
has(
  refused(PAGE, PAGE.replace("<h1>Build. Edit. Launch.</h1>", '<img src="stashed-image-2">')),
  "a picture that did not come back is refused",
);

// ── What must still pass ──────────────────────────────────────────────────
/* The half that matters more. Every false refusal here is somebody told no for
   asking correctly — which is the failure this codebase has already had twice. */

has(passes(PAGE, PAGE), "an edit that changed nothing passes");

const reworded = PAGE.replace("<h1>Build. Edit. Launch.</h1>", "<h1>Ship it.</h1>");
has(passes(PAGE, reworded), "changing a heading passes");

/* THE IMPORTANT ONE. Deleting a whole card — opener, content and closer — is
   exactly what the person kept asking for, and it must go straight through. */
const cardGone = PAGE.replace(
  `      <div class="card">
        <h3>$4,000–$12,000 before a single visitor arrives</h3>
        <p>Agency quotes routinely land in that range.</p>
      </div>\n`,
  "",
);
has(passes(PAGE, cardGone), "deleting a whole element passes", why(PAGE, cardGone));

/* A whole section, which is a bigger deletion and just as legitimate. */
const sectionGone = PAGE.replace(/    <section class="pricing">[\s\S]*?<\/section>\n/, "");
has(passes(PAGE, sectionGone), "deleting a whole section passes", why(PAGE, sectionGone));

/* Adding is the other half of editing and must never trip the balance check. */
const added = PAGE.replace(
  "  <footer>",
  '  <section class="cta"><div><h2>Start building</h2></div></section>\n  <footer>',
);
has(passes(PAGE, added), "adding a new section passes", why(PAGE, added));

/* A picture placed by an edit — a real data URI, which is what a resolved
   token becomes, and which must not be mistaken for an unresolved one. */
const withImage = PAGE.replace(
  "<h1>Build. Edit. Launch.</h1>",
  '<h1>Build. Edit. Launch.</h1><img src="data:image/png;base64,AAAA" alt="hero">',
);
has(passes(PAGE, withImage), "a page with a real embedded picture passes", why(PAGE, withImage));

/* A page that was ALREADY imbalanced stays editable. Judging balance in the
   absolute rather than as a delta would make such a page permanently
   unimprovable — the same shape of bug as the one that made a page with photos
   in it impossible to edit. */
const WONKY = `<body><main><div><section><h1>Hi</h1></div></main></body>`;
has(
  passes(WONKY, WONKY.replace("<h1>Hi</h1>", "<h1>Hello</h1>")),
  "a page that was already imbalanced can still be edited",
  why(WONKY, WONKY.replace("<h1>Hi</h1>", "<h1>Hello</h1>")),
);

/* A first build has nothing to compare against, and must not be refused for it. */
has(passes("", "<html><body><h1>New</h1></body></html>"), "a page with no previous version passes");

/* A fragment page — no <html>, no <body> — is a shape the builder really
   produces, and the scaffolding checks must not invent requirements it never
   had. */
const FRAGMENT = `<main><section><h1>Just a fragment</h1></section></main>`;
has(
  passes(FRAGMENT, FRAGMENT.replace("Just a fragment", "Still a fragment")),
  "a page with no <body> at all can still be edited",
  why(FRAGMENT, FRAGMENT.replace("Just a fragment", "Still a fragment")),
);

/* ── The noise the counting has to survive ─────────────────────────────────
 *
 * There was a slack of one tag here once, on the reasoning that counting tags
 * with a regex is approximate. It tolerated a difference of exactly one — which
 * is exactly what an orphaned </div> is, so the check passed everything it
 * existed to catch. The two cases at the top of this file are the proof; they
 * failed while that slack was in place.
 *
 * The slack is gone and the noise is removed at source instead. These are the
 * shapes that used to create it, and every one of them must now pass on its own
 * merits rather than on a threshold. */

/* Markup written inside a script is a string, not an element. This page's
   script opens three <div>s that do not exist. */
const SCRIPTED = `<body><main><script>
  const card = '<div class="card">';
  root.innerHTML = card + "<div><div>" ;
</script><h1>Hi</h1></main></body>`;
has(
  passes(SCRIPTED, SCRIPTED.replace("<h1>Hi</h1>", "<h1>Hello</h1>")),
  "tags inside a script are text, not elements",
  why(SCRIPTED, SCRIPTED.replace("<h1>Hi</h1>", "<h1>Hello</h1>")),
);

/* And an edit that genuinely breaks a page carrying such a script is still
   caught — the noise being ignored must not make the page unguarded. */
const scriptedBroken = SCRIPTED.replace("</main>", "");
has(refused(SCRIPTED, scriptedBroken), "and a real break in that page is still caught", why(SCRIPTED, scriptedBroken));

/* A commented-out section is not markup either. */
const COMMENTED = `<body><main><!-- <div class="old"> --><h1>Hi</h1></main></body>`;
has(
  passes(COMMENTED, COMMENTED.replace("<h1>Hi</h1>", "<h1>Hello</h1>")),
  "tags inside a comment are not counted",
  why(COMMENTED, COMMENTED.replace("<h1>Hi</h1>", "<h1>Hello</h1>")),
);

/* A self-closing structural tag opens and closes at once. Counted as an opener
   it would read as a section left hanging on a page that is perfectly sound. */
const SELF = `<body><main><section /><h1>Hi</h1></main></body>`;
has(
  passes(SELF, SELF.replace("<h1>Hi</h1>", "<h1>Hello</h1>")),
  "a self-closing tag is not an unclosed one",
  why(SELF, SELF.replace("<h1>Hi</h1>", "<h1>Hello</h1>")),
);

/* THE HOLE THE SLACK LEFT. One unclosed tag is one broken layout, and with a
   tolerance of one this passed. */
const oneStray = PAGE.replace("<h1>Build. Edit. Launch.</h1>", "<h1>Build.</h1><div>extra");
has(refused(PAGE, oneStray), "a single unclosed tag is refused — one is enough to break a page", why(PAGE, oneStray));

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
