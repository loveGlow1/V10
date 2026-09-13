#!/usr/bin/env node
/* The map a screenshot is read against.
 *
 *   npm run check:landmarks
 *
 * "Use this screenshot and change that bit" is the request this builder has
 * always been worst at, and the reason was never the model. It was handed a
 * photograph of a RENDERED page and, separately, the page's SOURCE, and asked
 * to do the visual-to-source mapping with nothing in between — and the two did
 * not even match, because stashImages replaces every photograph with
 * `stashed-image-N` so the document fits, removing the most distinctive thing
 * in the screenshot from the text being matched against it.
 *
 * This is the cheap half of the fix: the document as an ordered list of places.
 * Offline, no browser. The measured half — bounding boxes, re-render, compare —
 * needs Chromium and waits on a worker; see docs/JOBS.md.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-landmarks");
mkdirSync(out, { recursive: true });

execFileSync(
  "npx",
  ["tsc", "src/lib/builder/landmarks.ts",
   "--outDir", out, "--rootDir", "src", "--module", "esnext", "--target", "es2022",
   "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

const { pageLandmarks, landmarkBrief } = await import(join(out, "lib/builder/landmarks.js"));

let failed = 0;
let passed = 0;
const ok = (t, d) => { passed += 1; console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`); };
const fail = (t, d) => { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const PAGE = `<!doctype html><html><body>
<header id="top"><nav>Home About</nav><h1>Sunrise Bakery</h1></header>
<section id="hero">
  <h2>Cakes worth the detour</h2>
  <p>Baked every morning in Peckham.</p>
  <img data-shot="a whole victoria sponge on a marble counter, morning light" data-ratio="16/9" alt="A victoria sponge">
</section>
<section id="cakes">
  <h2>Our Cakes</h2>
  <img data-shot="slice of coffee walnut cake" data-ratio="4/5" alt="Coffee and walnut">
  <img src="stashed-image-0" alt="Lemon drizzle">
</section>
<section>
  <p>Order on WhatsApp and collect the same day.</p>
</section>
<footer id="foot"><p>Open 7am to 4pm</p></footer>
</body></html>`;

const places = pageLandmarks(PAGE);

console.log("The page as places:");

has(places.length === 5, "every block becomes a place", `got ${places.length}`);
has(places[0].tag === "header" && places[0].id === "top", "a block keeps its tag and its id");
has(
  places.map((p) => p.order).join() === "1,2,3,4,5",
  "numbered top to bottom, the way somebody counts them out loud",
);
has(places[1].heading === "Cakes worth the detour", "a section is named by its first heading");
has(
  places[3].heading === null && /WhatsApp/.test(places[3].opening ?? ""),
  "a section with no heading is named by its opening words",
  JSON.stringify(places[3]),
);

/* THE ONE. A screenshot shows a picture; the source does not, because it was
   lifted out to fit. The art direction is what survives, so it is what the
   match has to be made on. */
has(
  places[2].pictures.length === 2,
  "the pictures in a section are listed with it",
  JSON.stringify(places[2].pictures),
);
has(
  places[2].pictures[0].shot === "slice of coffee walnut cake",
  "a picture is described by its art direction, which is what the screenshot shows",
);
has(
  places[2].pictures[1].alt === "Lemon drizzle",
  "and a stashed one by its alt text, since its shot is gone",
);

console.log("\nWhat the model is shown:");

const brief = landmarkBrief(PAGE);
has(/1\. <header id="top">/.test(brief), "the brief is a numbered list of addressable places");
has(/Our Cakes/.test(brief), "with the headings a screenshot can be matched to");
has(/victoria sponge/.test(brief), "and the art direction of the pictures in them");
has(
  /stashed-image-N/.test(brief),
  "it says why the picture is missing from the source",
  "without this the model looks for an image that was deliberately removed",
);
has(
  /positions, not names|Do not write one into the page/.test(brief),
  "and that the numbers are for thinking with, not for writing into the page",
);

has(landmarkBrief("<p>just a paragraph</p>") === "", "a page with no sections gets no section, rather than an empty heading");

/* Bounded. A page with two hundred sections is not more usefully described by
   two hundred lines, and it costs five times as much to send. */
const long = `<body>${"<section><h2>Block</h2></section>".repeat(80)}</body>`;
has(pageLandmarks(long).length <= 40, "a very long page is bounded", `${pageLandmarks(long).length}`);

/* It runs on documents that are already stored, some of them megabytes, and it
   must never be the thing that fails an edit. */
for (const [input, why] of [["", "an empty document"], ["<section>", "an unclosed tag"], ["<<>>", "nonsense"]]) {
  let threw = false;
  try { landmarkBrief(input); } catch { threw = true; }
  has(!threw, `survives ${why}`);
}

console.log(failed ? `\n${failed} failed.` : `\nAll ${passed} passed.`);
process.exit(failed ? 1 : 0);
