#!/usr/bin/env node
/* Whether the change somebody asked for is actually in the page.
 *
 *   npm run check:verify-edit
 *
 * Every stage of the edit path answers a different question and none of them
 * answered this one. The patch applied. The document balances. The nav still
 * works. All three pass on an edit that did nothing the person asked for — and
 * the page then said "Done." and they looked at their own site to find out.
 *
 * THE SECOND HALF OF THIS FILE IS THE IMPORTANT ONE. A verifier that refuses a
 * good edit because it cannot recognise the shape of the fix would throw away
 * work somebody paid for, which is worse than no verifier at all. So the edits
 * that must NOT be flagged are tested as carefully as the ones that must.
 *
 * No keys, no network, no browser.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-verify-edit");
mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify(
    {
      extends: join(root, "tsconfig.json"),
      compilerOptions: {
        noEmit: false, outDir: out, rootDir: join(root, "src"),
        module: "commonjs", moduleResolution: "node",
        declaration: false, incremental: false, plugins: [],
        baseUrl: root, paths: { "@/*": ["src/*"] },
      },
      include: [join(root, "src/lib/builder/verify-edit.ts")],
    },
    null,
    2,
  ),
);

execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { stdio: ["ignore", "ignore", "inherit"] });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));
const shim = join(out, "node_modules");
mkdirSync(shim, { recursive: true });
try { execFileSync("ln", ["-sfn", out, join(shim, "@")]); } catch { /* already there */ }

const require = createRequire(import.meta.url);
const { verifyEdit, repairBrief, describeVerification } = require(join(out, "lib/builder/verify-edit.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

/* A page with the parts somebody actually points at. */
const PAGE = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
  <header id="top"><a class="logo" style="width:180px">Bakery</a><nav><a href="#pricing">Prices</a></nav></header>
  <section id="hero"><h1>Fresh every morning</h1><p>Baked before you wake.</p></section>
  <section id="pricing"><h2>Pricing</h2><p>Loaves from 3.50.</p></section>
  <section id="testimonials"><h2>Reviews</h2><p>Best sourdough in town.</p></section>
  <footer><h2>Contact</h2><p>Call us on 0161 496 0000.</p></footer>
</body></html>`;

const swap = (from, to) => PAGE.replace(from, to);
const rules = (v) => v.criteria.map((c) => `${c.rule}:${c.met}`);
const unmet = (v) => v.unmet.map((c) => c.rule);

/* ── What must be caught ─────────────────────────────────────────────────── */

{
  /* THE ONE THIS IS FOR. Every other stage of the pipeline passes here: the
     document is valid, nothing regressed, and nothing was done. */
  const v = verifyEdit({ message: "make the logo smaller", before: PAGE, after: PAGE });
  has(!v.complete, "an edit that changed nothing is not complete", rules(v).join(" "));
  has(unmet(v).includes("changed"), "and says so as `changed`", unmet(v).join(","));
}

{
  /* Something changed — in the wrong place. The failure a `changed` check on
     its own cannot see, and the commonest way an edit comes back wrong. */
  const after = swap("Best sourdough in town.", "The best sourdough in town.");
  const v = verifyEdit({ message: "make the logo in the header smaller", before: PAGE, after });
  has(!v.complete, "an edit that changed a different part of the page is not complete", rules(v).join(" "));
  has(unmet(v).includes("target-changed"), "and names the part that did not move", unmet(v).join(","));
}

{
  const after = swap('<section id="pricing"><h2>Pricing</h2><p>Loaves from 3.50.</p></section>', "");
  const v = verifyEdit({ message: "remove the pricing section", before: PAGE, after });
  has(v.complete, "a removal that removed it passes", JSON.stringify(v.unmet));
}

{
  /* Hidden rather than removed, which is what a model reaches for and what
     reads as a clean edit everywhere else. */
  const after = swap('<section id="pricing">', '<section id="pricing" style="display:none">');
  const v = verifyEdit({ message: "remove the pricing section", before: PAGE, after });
  has(!v.complete, "a removal that only hid it is not complete", rules(v).join(" "));
  has(unmet(v).includes("removed"), "and says what is still in the page", v.reason);
}

{
  /* Asked for a phone and given a fixed width wider than one. */
  const after = swap('<section id="hero">', '<section id="hero" class="w-[1200px]">');
  const v = verifyEdit({ message: "make this page fit mobile", before: PAGE, after });
  has(!v.complete, "a mobile request left too wide for a phone is not complete", rules(v).join(" "));
  has(unmet(v).includes("fits-phone"), "and names the width", v.reason);
}

{
  /* The tag without which nothing else about the phone layout matters. */
  const after = PAGE.replace(/<meta name="viewport"[^>]*>/, "");
  const v = verifyEdit({ message: "make it work on mobile", before: PAGE, after });
  has(unmet(v).includes("viewport"), "a mobile request with the viewport tag gone is not complete", v.reason);
}

{
  /* §14. The edit was about something else entirely and cost the phone layout
     on its way past — which no other check in the pipeline would mention. */
  const after = swap('<section id="hero">', '<section id="hero" class="w-[1400px]">');
  const v = verifyEdit({ message: "reword the hero heading", before: PAGE, after });
  has(!v.complete, "an edit that broke the phone layout is not complete", rules(v).join(" "));
  has(unmet(v).includes("no-new-overflow"), "and says the change introduced it", v.reason);
}

/* ── What must NOT be caught ─────────────────────────────────────────────── */

{
  const after = swap('style="width:180px"', 'style="width:120px"');
  const v = verifyEdit({ message: "make the logo smaller", before: PAGE, after });
  has(v.complete, "the edit that was asked for passes", JSON.stringify(v.unmet));
}

{
  const after = swap("Fresh every morning", "Fresh every single morning");
  const v = verifyEdit({ message: "tweak the hero heading", before: PAGE, after });
  has(v.complete, "a reworded hero passes", JSON.stringify(v.unmet));
}

{
  /* A page that ARRIVED with a fixed width and still has one has not
     regressed, and failing an unrelated edit over a defect it did not cause is
     how a gate gets turned off. */
  const wide = swap('<section id="hero">', '<section id="hero" class="w-[1200px]">');
  const after = wide.replace("Baked before you wake.", "Baked before you are awake.");
  const v = verifyEdit({ message: "reword the hero", before: wide, after });
  has(v.complete, "a pre-existing fixed width does not fail an unrelated edit", JSON.stringify(v.unmet));
}

{
  /* The request names nothing this can find. Not a pass it did not earn and
     not a failure either — the criterion had nothing to test against. */
  const after = swap("Baked before you wake.", "Baked fresh before you wake.");
  const v = verifyEdit({ message: "tidy that up a bit", before: PAGE, after });
  has(v.complete, "a request naming no place does not fail", JSON.stringify(v.unmet));
  has(
    v.unchecked.some((c) => c.rule === "target-changed"),
    "and reports the criterion as unchecked rather than met",
    JSON.stringify(v.unchecked.map((c) => c.rule)),
  );
}

{
  /* A removal naming something that was never in the page. Nothing to compare,
     so nothing to fail. */
  const after = swap("Best sourdough in town.", "The best sourdough anywhere.");
  const v = verifyEdit({ message: "remove the newsletter popup", before: PAGE, after });
  has(v.complete, "removing something the page never had does not fail", JSON.stringify(v.unmet));
}

{
  /* Quotation marks used for emphasis rather than as copy. A warning at most,
     and never a reason to refuse an edit. */
  const after = swap('style="width:180px"', 'style="width:220px"');
  const v = verifyEdit({ message: `make the "logo" bigger`, before: PAGE, after });
  has(v.complete, "a quoted word used for emphasis does not fail the edit", JSON.stringify(v.unmet));
}

{
  /* Whitespace is not a change and is also not the absence of one. */
  const after = PAGE.replace(/\n/g, "\n  ");
  const v = verifyEdit({ message: "make the logo smaller", before: PAGE, after });
  has(!v.complete, "a reformat alone does not count as the edit", rules(v).join(" "));
}

{
  const v = verifyEdit({ message: "anything", before: "", after: "" });
  has(Array.isArray(v.criteria), "an empty page does not throw", typeof v.criteria);
}

{
  const v = verifyEdit({ message: "x", before: PAGE, after: null });
  has(v.complete === true && v.criteria.length === 0, "a broken input reports nothing checked rather than failing", JSON.stringify(v));
}

/* ── What the failure is handed on as ────────────────────────────────────── */

{
  const v = verifyEdit({ message: "make the logo smaller", before: PAGE, after: PAGE });
  const brief = repairBrief(v, "make the logo smaller");
  has(brief.length > 0, "a failed verification produces a repair brief");
  has(brief.includes("make the logo smaller"), "which carries the original request", brief.slice(0, 60));
  has(/second pass/i.test(brief), "and says it is a second pass rather than a new request");

  const said = describeVerification(v);
  has(said.length > 0 && !/Done/.test(said), "and something honest to tell the person", said);
}

{
  const after = swap('style="width:180px"', 'style="width:120px"');
  const v = verifyEdit({ message: "make the logo smaller", before: PAGE, after });
  has(repairBrief(v, "make the logo smaller") === "", "a passing verification produces no repair brief");
  has(describeVerification(v) === "", "and nothing to apologise for");
}

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
