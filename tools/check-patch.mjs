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

const { applyLineEdits, applyPatches, numberLines } = await import(join(out, "lib/builder/patch.js"));

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

// ── Editing by line number ────────────────────────────────────────────────
/* The fallback, and why it exists: search-and-replace asks the model to quote
   the page, and the one failure it cannot recover from is a model that
   PARAPHRASES what it is copying. Every check above forgives whitespace and
   none of them can forgive a wrong word — correctly, because a block that
   misquotes is a block about something else.
 *
   So after two failed attempts the job changes. The page goes over numbered and
   the model names a range, which it cannot get wrong by mistyping because there
   is nothing to transcribe. What it gives up is the proof: a search block shows
   it found the right place, a range only claims one. These checks are about
   what is left holding it — bounds and overlap — and about the arithmetic that
   goes wrong silently. */

const lineBlock = (range, body) => `<<<<<<< LINES ${range}\n${body}${body ? "\n" : ""}>>>>>>> END`;

const numbered = numberLines(PAGE);
has(numbered.startsWith(" 1| <main>"), "the page is shown with its line numbers", numbered.split("\n")[0]);
has(
  numbered.split("\n")[3] === " 4|   </section>",
  "and the numbering is one-based, so line 4 is the fourth line",
  numbered.split("\n")[3],
);
/* The width is set by the longest number, so the markup stays aligned on a page
   with a thousand lines as well as on one with eleven. */
has(
  numberLines("a\n".repeat(120)).split("\n")[0] === "  1| a",
  "the margin is padded to the widest line number",
  numberLines("a\n".repeat(120)).split("\n")[0],
);

/* THE ONE. Lines 6-8 are the quote the model kept failing to copy. */
const cut = applyLineEdits(PAGE, lineBlock("6-8", ""));
has(
  cut.applied === 1 && !cut.html.includes("$4,000"),
  "an empty block deletes the lines it names",
  JSON.stringify(cut.failures),
);
/* Deleted, not blanked: three empty lines where a paragraph was is not what
   "delete this part" asked for. */
has(
  cut.html.split("\n").length === PAGE.split("\n").length - 3,
  "and the lines are removed rather than left empty",
  `${cut.html.split("\n").length} vs ${PAGE.split("\n").length}`,
);
has(cut.html.includes('<section class="pricing">') && cut.html.includes("</section>"), "the wrapper around them survives");

const one = applyLineEdits(PAGE, lineBlock("3", `    <h2>Ship it.</h2>`));
has(one.applied === 1 && one.html.includes("<h2>Ship it.</h2>"), "a single line number without a range works", JSON.stringify(one.failures));
has(!one.html.includes("Build. Edit. Launch."), "and it replaced that line rather than adding to it");

/* Everything the range did not name is byte-identical — the same property the
   search blocks are held to, and the reason either is safe to run at all. */
has(
  one.html.replace("    <h2>Ship it.</h2>", "    <h2>Build. Edit. Launch.</h2>") === PAGE,
  "nothing outside the range is touched",
);

/* A replacement can be more lines than it replaces, or fewer. */
const grown = applyLineEdits(PAGE, lineBlock("3", `    <h2>Ship it.</h2>\n    <p>Fast.</p>`));
has(
  grown.html.split("\n").length === PAGE.split("\n").length + 1 && grown.html.includes("<p>Fast.</p>"),
  "a range can be replaced by more lines than it held",
);

/* THE ARITHMETIC THAT GOES WRONG SILENTLY. Two ranges, and the first applied
   would shift every line number below it — so the second must be resolved
   against the page as the model was SHOWN it, not as it has become. Applied
   top-down, this test passes with the wrong lines edited and nothing reported. */
const two = applyLineEdits(
  PAGE,
  `${lineBlock("3", `    <h2>Ship it.</h2>`)}\n${lineBlock("9", `  </section>`)}`,
);
has(two.applied === 2, "two ranges both apply", JSON.stringify(two.failures));
has(
  two.html.includes("<h2>Ship it.</h2>") && two.html.includes("Your code leaves with you, in full"),
  "and each lands on the line it named, not on what moved into it",
  two.html,
);

/* Same, with the earlier range being a DELETION — the case where the shift is
   largest and an off-by-three would be invisible. */
const cutThenEdit = applyLineEdits(
  PAGE,
  `${lineBlock("6-8", "")}\n${lineBlock("11", `  <footer><p>Yours.</p></footer>`)}`,
);
has(
  cutThenEdit.applied === 2 &&
    !cutThenEdit.html.includes("$4,000") &&
    cutThenEdit.html.includes("<footer><p>Yours.</p></footer>") &&
    !cutThenEdit.html.includes("Your code leaves with you, in full"),
  "a deletion above a later range does not shift what that range means",
  cutThenEdit.html,
);

// ── What the line editor must refuse ──────────────────────────────────────
/* A range past the end of the document. The model counted wrong, and splicing
   at a line that does not exist would silently append instead. */
const past = applyLineEdits(PAGE, lineBlock("40-44", `<p>x</p>`));
has(
  past.applied === 0 && past.html === PAGE && past.failures[0]?.reason.includes("runs to line"),
  "a range past the end of the page is refused, and says how long the page is",
  JSON.stringify(past.failures),
);

const backwards = applyLineEdits(PAGE, lineBlock("8-6", `<p>x</p>`));
has(backwards.applied === 0 && backwards.html === PAGE, "a backwards range is refused");

const zero = applyLineEdits(PAGE, lineBlock("0-2", `<p>x</p>`));
has(zero.applied === 0 && zero.html === PAGE, "line 0 is refused — the numbering starts at 1");

/* Two ranges over the same lines is the model contradicting itself. The first
   stands and the second is refused, rather than the two being merged into
   whatever the ordering happens to produce. */
const overlap = applyLineEdits(
  PAGE,
  `${lineBlock("6-8", `      <p>One</p>`)}\n${lineBlock("7-9", `      <p>Two</p>`)}`,
);
has(
  overlap.applied === 1 && overlap.html.includes("<p>One</p>") && !overlap.html.includes("<p>Two</p>"),
  "two ranges over one region: the first lands, the second is refused",
  JSON.stringify(overlap.failures),
);

/* A reply with no blocks in it changes nothing, rather than emptying the page.
   This is the one that matters most: applyLineEdits returns html unconditionally,
   so a parse that finds nothing must return the document it was given. */
const prose = applyLineEdits(PAGE, "I'll remove that section for you.");
has(prose.applied === 0 && prose.html === PAGE, "a reply with no blocks leaves the page exactly as it was");

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
