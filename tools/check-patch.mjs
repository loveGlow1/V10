#!/usr/bin/env node
/* Checks the edit patch format against the failure that made it necessary.
 *
 *   npm run check:patch
 *
 * The symptom this exists for: a published page reading
 *
 *     ======= >>>>>>> REPLACE <<<<<<< SEARCH $0 ======= ₦0
 *
 * in place of its pricing section. The delimiters of the edit format had been
 * written into the document as text, and — this is the part that matters — the
 * page could not be repaired by editing it. Every SEARCH written to find a
 * delimiter contains delimiters, mis-parses, and leaves more behind. On the
 * project where this was found, six attempts to clean it up took the page from
 * one stray `=======` to eighteen.
 *
 * So the cases below are the real ones, and each asserts the property that
 * stops the loop rather than just the happy path:
 *
 *   - well-formed output still applies exactly as before
 *   - malformed output is refused whole, never half-read
 *   - a replacement carrying a delimiter is refused
 *   - a poisoned page is repaired in code, keeping the half the edit intended
 *   - repairing is idempotent, and leaves a clean page byte-identical
 *
 * Run with Node's type stripping so the module under test is the one that
 * ships, not a copy of it that can drift.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const module = resolve(here, "../src/lib/builder/patch.ts");

let failures = 0;
const pass = (text) => console.log(`PASS ${text}`);
function fail(text, detail) {
  failures += 1;
  console.log(`FAIL ${text}${detail ? `\n    ${detail}` : ""}`);
}

function check(text, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) pass(text);
  else fail(text, `expected ${b}\n    got      ${a}`);
}

const { applyPatches, parseBlocks, stripConflictMarkers, hasConflictMarkers } = await import(
  module
);

/* Written out rather than pasted as literals: a file that contains real
   delimiter lines cannot be edited by the tool it is testing, which is the
   whole lesson here. */
const S = "<".repeat(7) + " SEARCH";
const D = "=".repeat(7);
const R = ">".repeat(7) + " REPLACE";

console.log("Edit patch format\n");

// ── 1. The ordinary case still works ────────────────────────────────────────
{
  const page = "<h1>Hello</h1>\n<p>World</p>";
  const out = [S, "<h1>Hello</h1>", D, "<h1>Goodbye</h1>", R].join("\n");
  const result = applyPatches(page, out);
  check("a well-formed block applies", result.applied, 1);
  check("  and rewrites only what it named", result.html, "<h1>Goodbye</h1>\n<p>World</p>");
}

// ── 2. Two blocks in one reply ──────────────────────────────────────────────
{
  const page = "<h1>A</h1>\n<h2>B</h2>";
  const out = [S, "<h1>A</h1>", D, "<h1>X</h1>", R, "", S, "<h2>B</h2>", D, "<h2>Y</h2>", R].join(
    "\n",
  );
  const result = applyPatches(page, out);
  check("two blocks both apply", result.applied, 2);
  check("  in the page they were written against", result.html, "<h1>X</h1>\n<h2>Y</h2>");
}

// ── 3. The mis-parse that started it ────────────────────────────────────────
/* A block missing its divider. The old regex scanned forward for the next
   delimiter it could use, which meant this block borrowed the NEXT block's
   divider and swallowed the markers between them into its replacement — and
   that replacement was then written into the page. */
{
  const page = "<!-- PRICING -->\n<span>$0</span>";
  const out = [S, "<!-- PRICING -->", R, "", S, "<span>$0</span>", D, "<span>₦0</span>", R].join(
    "\n",
  );
  const result = applyPatches(page, out);
  check("a block with no divider is refused", result.applied, 0);
  check("  and the page is untouched", result.html, page);
  check("  with a reason, not a silent no-op", result.failures.length > 0, true);
  check("  and nothing leaked into it", hasConflictMarkers(result.html), false);
}

// ── 4. A replacement that carries a delimiter ───────────────────────────────
{
  const page = "<p>keep</p>";
  const out = [S, "<p>keep</p>", D, "<p>new</p>", D, R].join("\n");
  const result = applyPatches(page, out);
  check("a delimiter inside a block is refused", result.applied, 0);
  check("  and never reaches the page", hasConflictMarkers(result.html), false);
}

// ── 5. An unclosed block ────────────────────────────────────────────────────
{
  const out = [S, "<p>a</p>", D, "<p>b</p>"].join("\n");
  check("an unclosed block does not parse", parseBlocks(out).ok, false);
  check("  and applies nothing", applyPatches("<p>a</p>", out).applied, 0);
}

// ── 6. Repairing the real page ──────────────────────────────────────────────
/* Reduced from the stored build of the project in the screenshot, delimiters
   and all. The `$0` line is the half the edit was replacing; `₦0` is what it
   was replacing it with, and is what a repair has to keep. */
{
  const poisoned = [
    "</section>",
    "",
    "<!-- PRICING -->",
    D,
    "<!-- PRICING -->",
    R,
    "",
    S,
    '<span class="price">$0</span>',
    D,
    '<span class="price">₦0</span>',
    "",
    '<section id="pricing">',
  ].join("\n");

  const { html, removed } = stripConflictMarkers(poisoned);
  check("every marker line is removed", hasConflictMarkers(html), false);
  check("  all four of them", removed, 4);
  check("  the intended half survives", html.includes('<span class="price">₦0</span>'), true);
  check("  the discarded half does not", html.includes("$0"), false);
  check("  and real content is kept", html.includes('<section id="pricing">'), true);
}

// ── 7. Repair is safe to run on every edit ──────────────────────────────────
{
  const clean = "<h1>Fine</h1>\n<p>Nothing wrong here</p>";
  const first = stripConflictMarkers(clean);
  check("a clean page is left byte-identical", first.html, clean);
  check("  and reports no repair", first.removed, 0);

  const once = stripConflictMarkers([S, "a", D, "b", R].join("\n"));
  const twice = stripConflictMarkers(once.html);
  check("repairing twice changes nothing further", twice.html, once.html);
  check("  and the second pass reports zero", twice.removed, 0);
}

// ── 8. Content that merely looks like a marker ──────────────────────────────
/* A page is allowed to contain the word REPLACE, or a row of equals signs
   inside a sentence. Only a line that is nothing but a delimiter counts. */
{
  const page = "<p>Search and replace, then ===== see below =====</p>";
  check("marker-ish prose is not a marker", hasConflictMarkers(page), false);
  check("  and is not stripped", stripConflictMarkers(page).html, page);
}

console.log(
  `\n${failures === 0 ? "All checks passed." : `${failures} check${failures === 1 ? "" : "s"} failed.`}`,
);
process.exit(failures === 0 ? 0 : 1);
