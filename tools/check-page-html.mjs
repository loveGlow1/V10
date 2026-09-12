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

// ── A project that ran out of room ────────────────────────────────────────
//
// The failure this half exists for. A build of the second stack answers with a
// JSON object of paths to file contents. Execution 698 hit max_tokens at 65%
// thinking and the object arrived with no closing brace, so the orchestrator
// could not parse it, could not route it to `files`, and passed the raw text
// through as `html` — where the only sentence available was "What came back
// was not an HTML document."
//
// It is still a failed build. It must still fail. What it must not do is
// describe itself as the wrong KIND of answer when it was the right one,
// unfinished: that sent the reader looking for a generator returning prose,
// which is not what happened and not where the fix was.

const TREE = (files) =>
  "{" + files.map((p, i) => JSON.stringify(p) + ":" + JSON.stringify(`// ${i}\nexport default 1;`)).join(",");

function refusesWith(input, needle, label) {
  try {
    readGeneratedDocument(input);
    fail(label, "it was accepted");
  } catch (error) {
    has(error instanceof PageHtmlError && error.message.includes(needle), label,
      `got ${JSON.stringify(error?.message?.slice(0, 120))}`);
  }
}

/* Eleven whole files and a twelfth cut mid-write — execution 698's shape. */
const CUT = TREE([
  "app/globals.css", "lib/data.ts", "components/Button.tsx", "components/FormField.tsx",
  "components/StoreProvider.tsx", "components/Modal.tsx", "components/AuthForms.tsx",
  "components/AuthModal.tsx", "components/PreferencesModal.tsx", "components/SearchModal.tsx",
  "components/CartDrawer.tsx",
]) + ',"components/WishlistDrawer.tsx":"export default function W() { return <div classNam';

refusesWith(CUT, "unfinished", "a cut-off project says it is unfinished");
refusesWith(CUT, "11 files", "it says how far it got — THE ONE THIS EXISTS FOR");
refusesWith(CUT, "smaller", "it says what to do about it");

/* The count is of files that ARRIVED, not of files that were opened. The one
   it died inside is the one the reader is being told about. */
refusesWith(TREE(["app/page.tsx"]) + ',"app/layout.tsx":"export default fun',
  "1 file", "one whole file is singular");
refusesWith('{"app/page.tsx":"export default fun', "before the first file",
  "nothing complete is said differently");

/* It must not claim a diagnosis it cannot support. Unfinished JSON with no
   file paths in it is not a project, and calling it one would be inventing a
   cause out of a brace. */
refusesWith('{"status":"partial","detail":"the model was interrup',
  "not an HTML document", "unfinished JSON with no paths is not called a project");

/* And the ordinary failures keep their own sentences. */
refusesWith("<!doctype html>\n<html><body><h1>Half a p", "longer than one build allows",
  "a truncated PAGE still reports as a truncated page");
refusesWith("Here is a description of the site I would build.", "not an HTML document",
  "prose still reports as prose");

/* A complete tree is not this function's problem — the orchestrator routes
   those to `files` before they arrive here — so it must not be claimed as a
   cut-off one. It is still not a page. */
refusesWith(TREE(["app/page.tsx"]) + "}", "not an HTML document",
  "a COMPLETE tree is not reported as unfinished");

/* Fenced as json, which is how a model labels a fence it put round JSON. */
refusesWith("```json\n" + CUT + "\n```", "unfinished", "a fenced cut-off project is seen through its fence");

console.log(failed === 0 ? "\nall good" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
