#!/usr/bin/env node
/* A build is not thrown away over a sentence.
 *
 *   npm run check:page-html
 *
 * readGeneratedDocument decides whether what a model returned is a page. It has
 * to be strict about one thing and forgiving about another, and for a while it
 * had those the wrong way round.
 *
 * FORGIVING about how the document arrives. Four builds failed in twenty
 * minutes with "What came back was not an HTML document", on prompts that
 * opened `CREATE — index.html`. A model handed that will sometimes echo the
 * filename, or say what it built, before the doctype. The page underneath was
 * fine and was discarded — the same kind of loss the fenced-code-block unwrap
 * already existed to prevent.
 *
 * STRICT about truncation, which is the failure that looks like success. A
 * document cut off at the token ceiling still opens with <!doctype html> and
 * renders as half a page with nothing reporting anything. The closing tag is
 * the only thing separating "finished" from "ran out", and no amount of
 * tolerance about preambles may soften it.
 *
 * The second half of this file matters more than the first. If those ever
 * pass, this function has stopped protecting anybody.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-page-html");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  extends: join(root, "tsconfig.json"),
  compilerOptions: {
    noEmit: false, outDir: out, rootDir: join(root, "src"),
    module: "commonjs", moduleResolution: "node",
    declaration: false, incremental: false, plugins: [],
    baseUrl: root, paths: { "@/*": ["src/*"] },
  },
  include: [join(root, "src/lib/page-html.ts")],
}, null, 2));
execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));

const require = createRequire(import.meta.url);
const { readGeneratedDocument, PageHtmlError } = require(join(out, "lib/page-html.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const PAGE = `<!doctype html>\n<html lang="en">\n<body><h1>Maison Élan</h1></body>\n</html>`;

function accepts(input, label) {
  try {
    const html = readGeneratedDocument(input);
    /* Either opening. A doctype is what a model almost always writes and what
       the pipeline prefers, but `<html>` on its own is a document too and the
       function has always said so — asserting only the doctype here failed a
       case the code handles correctly, which is a bug in the test. */
    const opens = /^<!doctype html/i.test(html) || /^<html[\s>]/i.test(html);
    has(opens && html.trim().endsWith("</html>"), label,
      `got ${JSON.stringify(html.slice(0, 60))}`);
  } catch (error) {
    fail(label, error instanceof PageHtmlError ? error.message : String(error));
  }
}

function refuses(input, label) {
  try {
    readGeneratedDocument(input);
    fail(label, "it was accepted");
  } catch (error) {
    has(error instanceof PageHtmlError, label, `threw ${error?.name}`);
  }
}

// ── What must land ────────────────────────────────────────────────────────

accepts(PAGE, "a bare document");
accepts("```html\n" + PAGE + "\n```", "a fenced document");
accepts("— index.html\n\n" + PAGE, "a filename echoed above it — THE ONE THIS EXISTS FOR");
accepts("Here is your complete single-page store:\n\n" + PAGE, "a sentence above it");
accepts(PAGE + "\n\nLet me know if you'd like changes.", "a sentence below it");
accepts("I built it.\n\n" + PAGE + "\n\nAll mock data.", "a sentence on both sides");
accepts("   \n\n" + PAGE, "leading blank lines");
accepts(`<html><body>x</body></html>`, "a document with no doctype");

// ── What must still be refused ────────────────────────────────────────────
//
// Truncation above all. A page cut off mid-write still opens correctly and
// renders as half a site, and nothing else in the pipeline notices.

refuses("<!doctype html>\n<html><body><h1>Half a p", "a truncated document");
refuses("Here is a description of the site I would build.", "prose with no document at all");
refuses("", "an empty answer");
refuses("   ", "whitespace");
refuses(null, "null");
refuses(undefined, "undefined");
refuses({ html: PAGE }, "an object rather than a string");
refuses("```html\n<!doctype html>\n<html><body>unfinished", "a fenced truncated document");

/* Belt and braces on the one that matters: the tolerance above must not be
   reachable by putting a closing tag in the prose. */
refuses("<!doctype html>\n<html><body>cut off", "no closing tag anywhere");

console.log(failed === 0 ? "\nall good" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
