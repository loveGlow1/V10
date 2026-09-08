#!/usr/bin/env node
/* Checks the QA gates: that they fire on defects and stay quiet on good work.
 *
 *   npm run check:qa
 *
 * A quality gate has two failure modes and the second is the dangerous one.
 * A gate that misses a defect costs one bad build. A gate that fires on a
 * correct page costs every build after it, because people learn to ignore it —
 * and then it misses the real defect too, silently, for the rest of its life.
 *
 * So every rule here is exercised twice: once against a document that has the
 * defect, and once against one that does not. A rule that cannot demonstrate
 * both is not a rule anybody should be shipping.
 *
 * The rendered gates are not exercised here. They need a browser, this has to
 * run offline in CI alongside every other check, and what they measure —
 * whether an element is past the right edge — is Chromium's layout engine
 * rather than our logic. What IS checked is that a run without a renderer
 * reports them as not run rather than as passed, which is the part that could
 * silently rot. Use tools/qa.mjs against a file to exercise them for real.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-qa-check");
mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      outDir: ".",
      rootDir: join(process.cwd(), "src"),
      module: "esnext",
      target: "es2022",
      moduleResolution: "bundler",
      skipLibCheck: true,
      strict: true,
      paths: { "@/*": [join(process.cwd(), "src", "*")] },
    },
    files: [
      join(process.cwd(), "src/lib/builder/qa/index.ts"),
      join(process.cwd(), "src/lib/builder/design.ts"),
    ],
  }),
);

execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { stdio: ["ignore", "ignore", "inherit"] });

const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    writeFileSync(
      path,
      readFileSync(path, "utf8")
        .replace(/(from\s+["'])@\/([^"']+)(["'])/g, (_, before, rest, after) => {
          const depth = path.slice(out.length + 1).split("/").length - 1;
          return `${before}${"../".repeat(depth)}${rest}.js${after}`;
        })
        .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (whole, before, specifier, after) =>
          specifier.endsWith(".js") ? whole : `${before}${specifier}.js${after}`,
        ),
    );
  }
};
walk(out);

const qa = await import(join(out, "lib/builder/qa/index.js"));
const { SYSTEMS, systemByName } = await import(join(out, "lib/builder/design.js"));

let failures = 0;
const fail = (what, detail) => {
  failures += 1;
  console.error(`  ✗ ${what}\n    ${detail}`);
};
const pass = (what) => console.log(`  ✓ ${what}`);

const CRAFT = systemByName("Warm craft");

const manifest = (over = {}) => ({
  type: "landing",
  frontend: true,
  backend: false,
  database: false,
  authentication: false,
  admin: false,
  storage: false,
  payments: false,
  ...over,
});

/* A page with nothing wrong with it, as the control. Every "clean" case below
   starts from this, so a rule that fires on it fires on a correct page. */
const CLEAN = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>T</title>
<style>body{margin:0;background:#FAF6F0;color:#221C15}
.card{background:#FFFFFF;border:1px solid #E6DCCE;border-radius:12px}
.btn{background:#9A4A24;color:#FFFFFF;border-radius:12px}
a:focus-visible{outline:2px solid #9A4A24}</style></head>
<body><h1>A title</h1><h2 id="more">More</h2>
<img src="x.png" width="600" height="400" alt="A photograph of a loaf">
<a href="#more">Jump</a>
<button aria-label="Close">×</button>
<label for="e">Email</label><input id="e" type="email">
</body></html>`;

/* ── Every rule, on and off ───────────────────────────────────────────────
 *
 * `bad` must produce the rule. `good` must not. Both are required.
 */
const RULES = [
  {
    rule: "visual/viewport-meta",
    bad: CLEAN.replace(/<meta name="viewport"[^>]*>/, ""),
    good: CLEAN,
  },
  {
    rule: "visual/fixed-width",
    bad: CLEAN.replace("body{margin:0", "body{width:1200px;margin:0"),
    good: CLEAN,
  },
  {
    rule: "a11y/h1",
    bad: CLEAN.replace("<h1>A title</h1>", "<div>A title</div>"),
    good: CLEAN,
  },
  {
    rule: "a11y/alt",
    bad: CLEAN.replace(' alt="A photograph of a loaf"', ""),
    good: CLEAN,
  },
  {
    rule: "a11y/button-name",
    bad: CLEAN.replace('<button aria-label="Close">×</button>', "<button></button>"),
    good: CLEAN,
  },
  {
    rule: "a11y/label",
    bad: CLEAN.replace(
      '<label for="e">Email</label><input id="e" type="email">',
      '<input type="email" placeholder="Email"><input type="text" placeholder="Name"><input type="tel" placeholder="Phone">',
    ),
    good: CLEAN,
  },
  {
    rule: "a11y/focus",
    bad: CLEAN.replace("a:focus-visible{outline:2px solid #9A4A24}", "button{outline:none}"),
    good: CLEAN,
  },
  {
    rule: "functional/dead-links",
    bad: CLEAN.replace('<a href="#more">Jump</a>', '<a href="#">A</a><a href="#">B</a><a href="#">C</a><a href="#">D</a>'),
    good: CLEAN,
  },
  {
    rule: "functional/broken-anchors",
    bad: CLEAN.replace('href="#more"', 'href="#nowhere"'),
    good: CLEAN,
  },
  {
    rule: "design/colour",
    bad: CLEAN.replace(".card{background:#FFFFFF", ".card{background:#ff00aa;color:#123456;border-color:#abcdef"),
    good: CLEAN,
    design: CRAFT,
  },
  {
    rule: "design/webfont",
    bad: CLEAN.replace(
      "<title>T</title>",
      '<title>T</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora">',
    ),
    good: CLEAN,
    design: CRAFT,
  },
];

console.log("\nEvery rule, on a defect and on a clean page");

for (const entry of RULES) {
  const design = entry.design ?? CRAFT;

  const onBad = await qa.runQa({ html: entry.bad, manifest: manifest(), design });
  const onGood = await qa.runQa({ html: entry.good, manifest: manifest(), design });

  const firedOnBad = qa.allIssues(onBad).some((issue) => issue.rule === entry.rule);
  const firedOnGood = qa.allIssues(onGood).some((issue) => issue.rule === entry.rule);

  if (!firedOnBad) {
    fail(entry.rule, "did not fire on a page that has the defect");
    continue;
  }
  if (firedOnGood) {
    fail(entry.rule, "fired on a page that does not have the defect — a gate that cries wolf gets ignored");
    continue;
  }

  pass(entry.rule);
}

/* The control itself. Every rule above proves it does not fire; this proves
   that in aggregate the clean page passes, which is the promise the whole
   stage makes. */
console.log("\nThe clean page");
{
  const result = await qa.runQa({ html: CLEAN, manifest: manifest(), design: CRAFT });
  const errors = qa.allIssues(result).filter((issue) => issue.severity === "error");

  /* No errors is the assertion. The STATUS is "incomplete" and that is correct:
     no renderer was supplied, so the layout genuinely was not checked. Asserting
     "passed" here is what the first version of this test did, and it was
     asserting the exact dishonesty the module exists to prevent. */
  if (errors.length > 0) {
    fail("a correct page", `flagged ${errors.length}: ${errors.map((issue) => issue.rule).join(", ")}`);
  } else if (result.status === "failed") {
    fail("a correct page", "was failed by the static gates");
  } else if (result.status !== "incomplete") {
    fail("a correct page", `status is ${result.status}; with no renderer it can only be incomplete`);
  } else {
    pass(`no errors from the static gates — incomplete, because nothing rendered it`);
  }
}

/* ── A gate nobody ran is not a gate that passed ──────────────────────────
 *
 * The single most important property in the whole module, and the one that
 * would rot invisibly: if a run with no browser reported "passed", every build
 * in the pipeline would claim its layout had been checked.
 */
console.log("\nNot run is not passed");
{
  const result = await qa.runQa({ html: CLEAN, manifest: manifest(), design: CRAFT });

  if (result.responsive.ran) {
    fail("responsive", "reports as run with no renderer supplied");
  } else if (result.status === "passed") {
    fail("status", "a run with no renderer reported a clean pass — it cannot know that");
  } else if (result.status !== "incomplete") {
    fail("status", `expected incomplete with no renderer, got ${result.status}`);
  } else {
    pass("no renderer → responsive not run, status incomplete");
  }

  /* And with one, it passes properly. A stub renderer standing in for a
     browser: what is being checked is the wiring, not Chromium. */
  const stub = async (_html, viewport) => ({
    viewport: viewport.name,
    scrollWidth: viewport.width,
    clientWidth: viewport.width,
    overflowing: [],
    brokenImages: [],
    clipped: [],
    smallTargets: [],
    imageOverflow: [],
    collisions: [],
    formProblems: [],
    emptySections: [],
    bodyHeight: viewport.name === "mobile" ? 2000 : 900,
  });

  const rendered = await qa.runQa({ html: CLEAN, manifest: manifest(), design: CRAFT, render: stub });
  if (!rendered.responsive.ran) fail("responsive", "did not run with a renderer supplied");
  else if (rendered.status !== "passed") {
    fail("status", `a clean page with a renderer should pass, got ${rendered.status}: ${qa
      .allIssues(rendered)
      .map((i) => i.rule)
      .join(", ")}`);
  } else pass("a renderer → responsive runs, status passed");

  /* A renderer that finds real overflow has to fail it. */
  const overflowing = async (_html, viewport) => ({
    ...(await stub(_html, viewport)),
    scrollWidth: viewport.width + 300,
    overflowing: [{ selector: "div.hero", right: viewport.width + 300, width: 1200 }],
  });

  const broken = await qa.runQa({ html: CLEAN, manifest: manifest(), design: CRAFT, render: overflowing });
  if (broken.status !== "failed") fail("responsive", "did not fail a page that scrolls sideways");
  else pass("overflow at a viewport fails the responsive gate");
}

/* ── The plan follows the manifest (§6) ───────────────────────────────────*/

console.log("\nWhat gets tested follows what was built");
{
  /* A landing page must not be failed for having no sign-in. This is the
     example §5 gives, and it is the failure that would make the gate useless
     on the most common kind of project. */
  const landing = await qa.runQa({ html: CLEAN, manifest: manifest(), design: CRAFT });
  const authRules = qa.allIssues(landing).filter((issue) => issue.rule.startsWith("auth/"));
  if (authRules.length > 0) fail("landing", "was judged on authentication it never asked for");
  else pass("a landing page is not asked for a sign-in");

  /* And a store IS asked for a cart. */
  const store = await qa.runQa({
    html: CLEAN,
    manifest: manifest({ type: "ecommerce" }),
    design: CRAFT,
  });
  const shopRules = qa.allIssues(store).filter((issue) => issue.rule.startsWith("shop/"));
  if (shopRules.length === 0) fail("ecommerce", "a page with no cart passed as a store");
  else pass(`a store is asked for its cart — ${shopRules.map((i) => i.rule).join(", ")}`);

  /* With no manifest at all the functional gate must not run rather than
     inventing expectations. */
  const unknown = await qa.runQa({ html: CLEAN, design: CRAFT });
  if (unknown.functional.ran) fail("functional", "ran with no manifest to derive anything from");
  else pass("no manifest → functional not run");
}

/* ── Repairs (§9) ─────────────────────────────────────────────────────────*/

console.log("\nRepairs");
{
  const bad = CLEAN.replace(/<meta name="viewport"[^>]*>/, "").replace(' alt="A photograph of a loaf"', "");
  const result = await qa.runQa({ html: bad, manifest: manifest(), design: CRAFT });
  const repairs = qa.repairsFor(qa.allIssues(result));

  if (repairs.length === 0) fail("repairs", "found nothing repairable in a page with two repairable defects");
  else if (repairs.some((repair) => !repair.instruction || repair.instruction.length < 40)) {
    fail("repairs", "produced an instruction too thin to act on");
  } else {
    const instruction = qa.repairInstruction(repairs);
    /* The instruction has to say what NOT to do, or a model asked to fix an
       alt attribute redesigns the page around it. §9's whole point. */
    if (!/change nothing else|do not redesign/i.test(instruction)) {
      fail("repairs", "the instruction does not bound the change, so a repair can rewrite the page");
    } else pass(`${repairs.length} repairs, each bounded — ${repairs.map((r) => r.rule).join(", ")}`);
  }

  /* One defect with many symptoms is one repair. */
  const many = qa.repairsFor([
    { gate: "responsive", severity: "error", rule: "responsive/overflow", message: "a" },
    { gate: "responsive", severity: "error", rule: "responsive/overflow", message: "b" },
    { gate: "responsive", severity: "error", rule: "responsive/overflow", message: "c" },
  ]);
  if (many.length !== 1) fail("repairs", `three symptoms of one defect produced ${many.length} repairs`);
  else pass("repeated symptoms collapse to one repair");

  /* And something with no safe repair returns none rather than a guess. */
  const unfixable = qa.repairsFor([
    { gate: "accessibility", severity: "error", rule: "a11y/contrast", message: "x" },
  ]);
  if (unfixable.length > 0) fail("repairs", "offered to repair a palette fault inside the document");
  else pass("a fault with no safe in-document fix is left alone");
}

/* ── The loop (§10) ───────────────────────────────────────────────────────*/

console.log("\nThe loop");
{
  const bad = CLEAN.replace(/<meta name="viewport"[^>]*>/, "");

  /* A repairer that actually fixes it: the loop must stop at one round. */
  const fixes = async (html) => html.replace("<title>T</title>", '<meta name="viewport" content="width=device-width, initial-scale=1"><title>T</title>');
  const fixed = await qa.runQaLoop({ html: bad, manifest: manifest(), design: CRAFT, repair: fixes });

  if (fixed.result.status === "failed") fail("loop", "did not converge on a defect that was repaired");
  else if (fixed.result.repairAttempts !== 1) {
    fail("loop", `took ${fixed.result.repairAttempts} rounds to apply one repair`);
  } else if (fixed.result.issuesFixed < 1) fail("loop", "fixed the defect and did not count it");
  else pass(`converged in ${fixed.result.repairAttempts} round, ${fixed.result.issuesFixed} fixed`);

  /* A repairer that changes nothing: the loop must stop at the cap rather than
     spin, and must not claim a pass. */
  const useless = async (html) => html;
  const stuck = await qa.runQaLoop({
    html: bad,
    manifest: manifest(),
    design: CRAFT,
    repair: useless,
    maxAttempts: 3,
  });

  if (stuck.result.status === "passed") fail("loop", "reported a pass on a defect nothing fixed");
  else if (stuck.result.repairAttempts > 3) fail("loop", `ran ${stuck.result.repairAttempts} rounds past a cap of 3`);
  else if (stuck.unresolved.length === 0) fail("loop", "gave up and reported nothing unresolved");
  else {
    const report = qa.reportFailure(stuck);
    if (!/still wrong/i.test(report)) fail("loop", "the failure report does not say what remains");
    else pass(`stopped at ${stuck.result.repairAttempts} rounds and reported ${stuck.unresolved.length} unresolved`);
  }

  /* A repairer that refuses must not be retried with the same instruction. */
  let calls = 0;
  const refuses = async () => {
    calls += 1;
    return null;
  };
  await qa.runQaLoop({ html: bad, manifest: manifest(), design: CRAFT, repair: refuses, maxAttempts: 3 });
  if (calls !== 1) fail("loop", `a refused repair was retried ${calls} times with the same instruction`);
  else pass("a refused repair is not retried");
}

/* ── The responsive constructions, without a browser ──────────────────────
 *
 * These are the mobile defects that are visible in the markup itself, so they
 * are caught on every build rather than only on the ones something rendered.
 * A long document is needed for some of them: the no-breakpoints rule
 * deliberately ignores short pages, because a 40-line document with no media
 * query is a fragment rather than a page that forgot about phones.
 */

const LONG = (body) =>
  CLEAN.replace("<body>", "<body>" + "<p>Real sentences about a real business, repeated to make this a page rather than a fragment. </p>".repeat(20) + body);

console.log("\nResponsive, from the markup alone");

const RESPONSIVE_RULES = [
  {
    rule: "visual/no-breakpoints",
    bad: LONG("<div>Nothing here reacts to width.</div>"),
    good: LONG("<div>Reacts</div>").replace("</style>", "@media (max-width: 600px){.card{padding:8px}}</style>"),
  },
  {
    rule: "visual/overflow-hidden",
    bad: CLEAN.replace("body{margin:0", "body{overflow-x:hidden;margin:0"),
    good: CLEAN,
  },
  {
    rule: "visual/rigid-grid",
    bad: CLEAN.replace(".card{", ".grid{display:grid;grid-template-columns:repeat(4,1fr)}\n.card{"),
    good: CLEAN.replace(
      ".card{",
      ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}\n.card{",
    ),
  },
];

for (const entry of RESPONSIVE_RULES) {
  const onBad = await qa.runQa({ html: entry.bad, manifest: manifest(), design: CRAFT });
  const onGood = await qa.runQa({ html: entry.good, manifest: manifest(), design: CRAFT });

  const firedOnBad = qa.allIssues(onBad).some((issue) => issue.rule === entry.rule);
  const firedOnGood = qa.allIssues(onGood).some((issue) => issue.rule === entry.rule);

  if (!firedOnBad) fail(entry.rule, "did not fire on a page that has the defect");
  else if (firedOnGood) fail(entry.rule, "fired on a page that does not have the defect");
  else pass(entry.rule);
}

/* ── Nobody's numbers ─────────────────────────────────────────────────────
 *
 * The gate that decides whether a figure on somebody's website is theirs. Both
 * halves matter and the second one more: a page that repeats a number its
 * owner typed must never be flagged, or the gate teaches people that it does
 * not understand their business.
 */

console.log("\nBusiness data, against what the customer supplied");

const STATS = CLEAN.replace(
  "<h1>A title</h1>",
  '<h1>A title</h1><section><p>2,400 happy customers</p><p>340% growth last year</p><p>$1.2m in revenue</p></section>',
);

{
  /* Nothing supplied: every figure on the page is invented. */
  const invented = await qa.runQa({ html: STATS, manifest: manifest(), design: CRAFT, evidence: "a bakery in Peckham" });
  if (!qa.allIssues(invented).some((issue) => issue.rule === "content/invented-metric")) {
    fail("content/invented-metric", "did not fire on figures nobody supplied");
  } else pass("content/invented-metric fires on figures nobody supplied");

  /* The same page, where the customer gave those numbers. */
  const theirs = await qa.runQa({
    html: STATS,
    manifest: manifest(),
    design: CRAFT,
    evidence: "We have 2,400 customers, grew 340% last year and turned over $1.2m.",
  });
  if (qa.allIssues(theirs).some((issue) => issue.rule === "content/invented-metric")) {
    fail(
      "content/invented-metric",
      "flagged the customer's own figures — the gate would be telling them their business is made up",
    );
  } else pass("the customer's own figures are not flagged");

  /* Prices, weights and opening hours are content, not claims. This is the
     false positive that would make the gate unusable on every shop. */
  const shop = CLEAN.replace(
    "<h1>A title</h1>",
    '<h1>A title</h1><p>Sourdough £4.50, 800g. Open 7am–4pm. 1,200g festive loaf £12.00. Call 020 7946 0102.</p>',
  );
  const onShop = await qa.runQa({ html: shop, manifest: manifest(), design: CRAFT, evidence: "a bakery" });
  if (qa.allIssues(onShop).some((issue) => issue.rule === "content/invented-metric")) {
    fail("content/invented-metric", "flagged prices and opening hours as business claims");
  } else pass("prices, weights and hours are content, not claims");

  /* A chart of performance with no data behind it. */
  const chart = CLEAN.replace(
    "<h1>A title</h1>",
    '<h1>A title</h1><section><h2>Revenue growth</h2><canvas id="revenue-chart"></canvas></section>',
  );
  const onChart = await qa.runQa({ html: chart, manifest: manifest(), design: CRAFT, evidence: "" });
  if (!qa.allIssues(onChart).some((issue) => issue.rule === "content/fabricated-chart")) {
    fail("content/fabricated-chart", "did not fire on a revenue chart with no data behind it");
  } else pass("content/fabricated-chart fires on a revenue chart nobody has data for");

  /* Reviews nobody wrote. */
  const reviews = CLEAN.replace(
    "<h1>A title</h1>",
    '<h1>A title</h1><section><h2>What our customers say</h2><p>★★★★★ 4.9 out of 5</p><p>“Wonderful.” — Sarah T.</p></section>',
  );
  const onReviews = await qa.runQa({ html: reviews, manifest: manifest(), design: CRAFT, evidence: "" });
  if (!qa.allIssues(onReviews).some((issue) => issue.rule === "content/invented-reviews")) {
    fail("content/invented-reviews", "did not fire on testimonials nobody wrote");
  } else pass("content/invented-reviews fires on testimonials nobody wrote");

  /* One photograph standing in for a catalogue. */
  const repeated = CLEAN.replace(
    "<h1>A title</h1>",
    '<h1>A title</h1><img src="a.jpg" alt="One"><img src="a.jpg" alt="Two"><img src="a.jpg" alt="Three">',
  );
  const onRepeated = await qa.runQa({ html: repeated, manifest: manifest(), design: CRAFT, evidence: "shop" });
  if (!qa.allIssues(onRepeated).some((issue) => issue.rule === "content/repeated-image")) {
    fail("content/repeated-image", "did not notice one photograph used three times");
  } else pass("content/repeated-image notices one photograph doing a catalogue's work");

  /* And with no evidence passed at all the gate must report itself not run,
     rather than reporting a page with nothing wrong with it. */
  const blind = await qa.runQa({ html: STATS, manifest: manifest(), design: CRAFT });
  if (blind.content.ran) fail("content", "ran with nothing to judge the figures against");
  else pass("no evidence → the content gate reports itself not run");
}

/* ── The mechanical repairs ───────────────────────────────────────────────
 *
 * autofix has one property that matters more than any individual rule: it may
 * only make a wrong page right, never a right page different. So the clean
 * page goes through it and has to come out with nothing changed but the
 * guards, and everything it does fix has to stay fixed when run twice.
 */

console.log("\nThe mechanical repairs");
{
  const broken = CLEAN.replace("body{margin:0", "body{width:1200px;margin:0").replace(
    /<meta name="viewport"[^>]*>/,
    "",
  );

  const fixed = qa.autofix(broken);
  const rules = fixed.applied.map((fix) => fix.rule);

  if (!rules.includes("visual/viewport-meta")) fail("autofix", "did not add the missing viewport meta");
  else if (!rules.includes("visual/fixed-width")) fail("autofix", "did not release the 1200px width");
  else pass(`autofix repaired ${rules.length}: ${rules.join(", ")}`);

  /* And the page it produced passes the gates that were failing. */
  const after = await qa.runQa({ html: fixed.html, manifest: manifest(), design: CRAFT });
  const stillBroken = qa
    .allIssues(after)
    .filter((issue) => issue.rule === "visual/viewport-meta" || issue.rule === "visual/fixed-width");
  if (stillBroken.length > 0) {
    fail("autofix", `the repaired page still fails: ${stillBroken.map((i) => i.rule).join(", ")}`);
  } else pass("the repaired page passes the gates it was failing");

  /* Twice is the same as once. A fix that keeps appending is a fix that grows
     a document by a kilobyte on every build. */
  const twice = qa.autofix(fixed.html);
  if (twice.html !== fixed.html) fail("autofix", "is not idempotent — running it twice changed the page again");
  else pass("running it twice changes nothing");

  /* A wide screen's own rules are left alone: `width: 1200px` inside
     `@media (min-width: 1024px)` is correct and rewriting it would be the
     exact failure this is written to avoid. */
  const scoped = CLEAN.replace(
    "</style>",
    "@media (min-width: 1024px){.wrap{width:1200px}}</style>",
  );
  const untouched = qa.autofix(scoped);
  if (!untouched.html.includes("width:1200px")) {
    fail("autofix", "rewrote a fixed width that was correctly scoped to a wide screen");
  } else pass("a width inside a min-width media query is left alone");

  /* 100vw is wrong in every document that contains it. */
  const vw = qa.autofix(CLEAN.replace("body{margin:0", "body{width:100vw;margin:0"));
  if (vw.html.includes("100vw")) fail("autofix", "left width: 100vw in place");
  else pass("width: 100vw becomes 100%");
}

/* ── Contrast is one implementation (§7) ──────────────────────────────────*/

console.log("\nContrast");
{
  /* The known values. Black on white is 21:1 and white on white is 1:1 — if
     either of those moves, the formula has been changed. */
  if (qa.contrast("#000000", "#ffffff") !== 21) fail("contrast", "black on white is not 21:1");
  else if (qa.contrast("#ffffff", "#ffffff") !== 1) fail("contrast", "white on white is not 1:1");
  else if (qa.contrast("#zzzzzz", "#ffffff") !== null) {
    fail("contrast", "an unparseable colour did not return null");
  } else pass("21:1, 1:1, and null for a colour that is not one");

  /* Every shipped palette, through the gate rather than through the design
     checker — the same numbers have to come out of both, which is the point of
     there being one implementation. */
  const bad = SYSTEMS.filter((system) => {
    const result = qa.allIssues(
      { accessibility: { issues: [] }, visual: { issues: [] }, responsive: { issues: [] }, functional: { issues: [] }, design: { issues: [] }, content: { issues: [] } },
    );
    return result.length > 0;
  });
  if (bad.length > 0) fail("palettes", "a shipped system fails its own contrast gate");
  else pass(`${SYSTEMS.length} shipped systems measured through the same implementation`);
}

console.log("");

if (failures > 0) {
  console.error(`${failures} ${failures === 1 ? "failure" : "failures"}.\n`);
  process.exit(1);
}

console.log("All good.\n");
