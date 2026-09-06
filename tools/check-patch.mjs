#!/usr/bin/env node
/* An edit somebody asked for clearly should land.
 *
 *   npm run check:patch
 *
 * A patch is a pair — the text to find, and what it becomes — and for a long
 * time the text had to match the page byte for byte. That rule protects
 * something real: a patch applied to the wrong place is worse than one refused,
 * because a refusal is visible and a misapplication is not.
 *
 * It also refused edits people had asked for perfectly clearly. The case that
 * forced this file: somebody quoted the exact sentence off their own page —
 * "$4,000–$12,000 before a single visitor arrives" — asked for that part to go,
 * and was told it could not be placed. The words were in the document. The
 * whitespace around them was not, because the model re-indented the block it
 * was copying.
 *
 * So the search forgives more, in stages, and the safety moved: every stage
 * still has to find exactly ONE place, and ambiguity is refused at every level.
 * These checks are in two halves, and the second half is the important one.
 *
 *   WHAT MUST NOW LAND — the shapes a model actually produces: re-indentation,
 *   joined lines, a tab where the page has spaces.
 *
 *   WHAT MUST STILL BE REFUSED — anything with two candidates, anything not
 *   in the page at all. If these ever pass, this file has stopped protecting
 *   the page and started guessing at it.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-patch");
mkdirSync(out, { recursive: true });

execFileSync(
  "npx",
  ["tsc", "src/lib/builder/patch.ts", "--outDir", out, "--rootDir", "src",
   "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

const { applyPatches } = await import(join(out, "lib/builder/patch.js"));

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const block = (search, replace) =>
  `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;

/* The page from the conversation this was written for, in the shape a real one
   has: indented, nested, with the sentence somebody wanted gone. */
const PAGE = `<main>
  <section class="hero">
    <h2>Build. Edit. Launch.</h2>
  </section>
  <section class="pricing">
    <p class="quote">
      $4,000–$12,000 before a single visitor arrives
    </p>
  </section>
  <footer>
    <p>Your code leaves with you, in full</p>
  </footer>
</main>`;

// ── What must now land ────────────────────────────────────────────────────

/* Byte for byte, which always worked and must keep working. */
const exact = applyPatches(PAGE, block(`    <h2>Build. Edit. Launch.</h2>`, `    <h2>Ship it.</h2>`));
has(exact.applied === 1 && exact.html.includes("<h2>Ship it.</h2>"), "an exact block still applies");

/* THE ONE. The model quotes the sentence with its own indentation — four
   spaces where the page has six — and every character that matters is right. */
const reindented = applyPatches(
  PAGE,
  block(`<p class="quote">\n  $4,000–$12,000 before a single visitor arrives\n</p>`, ``),
);
has(
  reindented.applied === 1 && !reindented.html.includes("$4,000"),
  "a block whose indentation differs from the page applies",
  JSON.stringify(reindented.failures),
);

/* The model joins what the page has on three lines onto one. */
const joined = applyPatches(
  PAGE,
  block(`<p class="quote"> $4,000–$12,000 before a single visitor arrives </p>`, ``),
);
has(joined.applied === 1 && !joined.html.includes("$4,000"), "a block that joined the lines applies", JSON.stringify(joined.failures));

/* The model drops the whitespace entirely between tags. */
const squashed = applyPatches(
  PAGE,
  block(`<p class="quote">$4,000–$12,000 before a single visitor arrives</p>`, ``),
);
has(squashed.applied === 1 && !squashed.html.includes("$4,000"), "a block with no whitespace at all applies", JSON.stringify(squashed.failures));

/* A tab where the page has spaces. */
const tabbed = applyPatches(PAGE, block(`\t<footer>\n\t\t<p>Your code leaves with you, in full</p>\n\t</footer>`, `  <footer></footer>`));
has(tabbed.applied === 1, "a block indented with tabs applies", JSON.stringify(tabbed.failures));

/* What it replaces is the region it matched, not a length copied from the
   search text — otherwise a shape match eats the wrong number of characters. */
has(
  squashed.html.includes('<section class="pricing">') && squashed.html.includes("</section>"),
  "the surrounding markup survives a loose match",
  squashed.html,
);

// ── What must still be refused ────────────────────────────────────────────

const TWICE = `<div><p>Read more</p></div>\n<div><p>Read more</p></div>`;

const ambiguous = applyPatches(TWICE, block(`<p>Read more</p>`, `<p>Read less</p>`));
has(
  ambiguous.applied === 0 && ambiguous.failures[0]?.reason.includes("more than once"),
  "text appearing twice is refused, not guessed at",
  JSON.stringify(ambiguous.failures),
);

/* And it must not become unambiguous by being read more loosely: two matches
   that differ only in whitespace are still two matches. */
const ambiguousWhitespace = applyPatches(
  `<div>\n  <p>Read more</p>\n</div>\n<div><p>Read more</p></div>`,
  block(`<p>Read more</p>`, `<p>Read less</p>`),
);
has(
  ambiguousWhitespace.applied === 0,
  "two matches that differ only in spacing are still two matches",
  JSON.stringify(ambiguousWhitespace.failures),
);

const absent = applyPatches(PAGE, block(`<h2>A heading this page does not have</h2>`, `<h2>x</h2>`));
has(
  absent.applied === 0 && absent.failures[0]?.reason.includes("not in the page"),
  "text that is genuinely absent is still refused",
);

/* Loosening whitespace must not loosen CONTENT. A block that gets a word wrong
   is a block about something else. */
const wrongWords = applyPatches(PAGE, block(`<p>Your code leaves with you, in part</p>`, `<p>x</p>`));
has(wrongWords.applied === 0, "a block that misquotes the page is refused");

/* Two blocks fighting over one region: the second is refused rather than
   applied to whatever the first left behind. */
const fighting = applyPatches(
  PAGE,
  `${block(`<h2>Build. Edit. Launch.</h2>`, `<h2>One</h2>`)}\n${block(`<h2>Build. Edit. Launch.</h2>`, `<h2>Two</h2>`)}`,
);
has(
  fighting.applied === 1 && fighting.html.includes("<h2>One</h2>") && !fighting.html.includes("<h2>Two</h2>"),
  "two blocks over one region: the first lands, the second is refused",
  JSON.stringify(fighting.failures),
);

/* Nothing outside the matched region is disturbed — the property the whole
   patch approach exists for. */
const untouched = applyPatches(PAGE, block(`<h2>Build. Edit. Launch.</h2>`, `<h2>Ship it.</h2>`));
has(
  untouched.html.replace("<h2>Ship it.</h2>", "<h2>Build. Edit. Launch.</h2>") === PAGE,
  "everything the block did not name is byte-identical",
);

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
