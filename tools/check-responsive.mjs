#!/usr/bin/env node
/* Whether a generated project will look right on a phone.
 *
 *   npm run check:responsive
 *
 * The `responsive` gate has existed since QA did and has only ever been
 * answerable by render.ts, which needs a browser — and a browser cannot live in
 * a serverless function. So in production it has never run, on any build: every
 * project this platform has shipped went out with its layout unexamined, and
 * "the page on a mobile screen isn't well aligned" is what that sounds like
 * from the customer's side.
 *
 * A browser is still the only thing that can measure whether a heading
 * overflows its column. But most of what breaks a generated page on a phone is
 * not subtle and is not measured — it is written down in the class list.
 *
 * THE SECOND HALF OF THIS FILE IS THE IMPORTANT ONE. A gate that refuses a
 * working page over a stray attribute is a disease this codebase has caught
 * twice, so the pages that must NOT be flagged are tested as carefully as the
 * ones that must.
 *
 * No keys, no network, no browser.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-responsive");
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
      include: [join(root, "src/lib/builder/qa/responsive.ts")],
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
const { responsiveBrief, staticResponsiveGate } = require(join(out, "lib/builder/qa/responsive.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const page = (body) => [{ path: "app/page.tsx", content: `export default function Page() {\n  return (${body});\n}\n` }];
const rules = (result) => result.issues.map((i) => i.rule);
const errors = (result) => result.issues.filter((i) => i.severity === "error").map((i) => i.rule);

/* ── What must be caught ─────────────────────────────────────────────────── */

{
  const result = staticResponsiveGate("", page(`<div className="w-[1200px] mx-auto">hello</div>`));
  has(errors(result).includes("fixed-width"), "a width wider than a phone is an error", JSON.stringify(rules(result)));
  has(result.passed === false, "and fails the gate, because it is true of every phone");
  has(
    result.issues.some((i) => i.where === "app/page.tsx"),
    "naming the file it is in",
  );
  has(
    result.issues.some((i) => /scrolls sideways/.test(i.message)),
    "and saying what the visitor would see, not which rule fired",
  );
}

{
  const result = staticResponsiveGate("", page(`<div className="grid grid-cols-3 gap-6">cards</div>`));
  has(errors(result).includes("grid-no-mobile-columns"), "a grid with no mobile column count is an error", JSON.stringify(rules(result)));
  has(
    result.issues.some((i) => /110px|side by side/.test(i.message)),
    "and says what three columns on a phone actually means",
  );
}

/* ── The header, which is the one people photograph ──────────────────────
 *
 * Wordmark left, six inline links right. Correct at 1280px and the ugliest
 * thing this platform ships at 390px: the links wrap under the logo, collide
 * with it, or push the page sideways. It is the top of every page, so it is
 * what "it looks ugly on mobile" is usually about. */
{
  const header = page(`<header className="flex items-center justify-between px-4">
      <a href="/" className="font-bold">Brand</a>
      <nav className="flex gap-6">
        <a href="#services">Services</a>
        <a href="#pricing">Pricing</a>
        <a href="#about">About</a>
        <a href="#faq">FAQ</a>
        <a href="#contact">Contact</a>
      </nav>
    </header>`);
  const result = staticResponsiveGate("", header);

  has(
    rules(result).includes("nav-never-collapses"),
    "a header of inline links with nothing hiding them is reported",
    JSON.stringify(rules(result)),
  );
  has(
    !errors(result).includes("nav-never-collapses"),
    "AS A WARNING, because a header with many links is not broken in every document",
    "the first real file this was run against had ten links and was correct — " +
      "an error here would have failed a build that works",
  );
  has(
    result.issues.some((i) => /hidden md:flex/.test(i.message)),
    "and the finding carries the class list that fixes it",
  );
  has(
    result.issues.some((i) => /flex md:hidden/.test(i.message)),
    "including the one on the button, which is the half that needs new markup",
  );
}

/* And the shape that is correct is not reported, which is the harder half:
   a gate that refuses a working page is a disease this codebase has caught
   twice already. */
{
  const done = page(`<header className="flex items-center justify-between px-4">
      <a href="/" className="font-bold">Brand</a>
      <nav className="hidden md:flex gap-6">
        <a href="#services">Services</a>
        <a href="#pricing">Pricing</a>
        <a href="#about">About</a>
        <a href="#faq">FAQ</a>
        <a href="#contact">Contact</a>
      </nav>
      <button className="flex md:hidden" aria-expanded="false" aria-controls="menu">Menu</button>
    </header>`);
  has(
    !rules(staticResponsiveGate("", done)).includes("nav-never-collapses"),
    "a header that collapses below md is left alone",
  );
}

/* ── THE ONE FROM PRODUCTION ─────────────────────────────────────────────
 *
 * components/SiteHeader.tsx, from a real project. Ten anchors, not one
 * Tailwind breakpoint, and completely correct: the link list is hidden with an
 * inline `display: none`, a menu button sits beside it, and a
 * `@media (min-width: 768px)` block in the element's own <style> flips both.
 *
 * The first version of this rule failed it, as an ERROR, which would have
 * blocked that build. Tailwind is not the only way to write a responsive
 * header and this gate does not get to pretend otherwise. */
{
  const real = page("");
  real[0] = {
    path: "components/SiteHeader.tsx",
    content: `export default function SiteHeader() {
      return (
        <header style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="container" style={{ display: "flex", justifyContent: "space-between" }}>
            <Link href="/">NOVA</Link>
            <nav style={{ display: "none" }} className="nav-desktop">
              <Link href="/">Shop</Link><Link href="/">New Arrivals</Link>
              <Link href="/">Collections</Link><Link href="/">About</Link>
            </nav>
            <button className="nav-toggle" aria-label="Menu">menu</button>
          </div>
          <style>{\`
            @media (min-width: 768px) {
              .nav-desktop { display: flex !important; }
              .nav-toggle { display: none !important; }
            }
          \`}</style>
        </header>
      );
    }`,
  };

  const found = staticResponsiveGate("", real);
  has(
    !rules(found).includes("nav-never-collapses"),
    "A HEADER THAT COLLAPSES WITH A MEDIA QUERY IS LEFT ALONE",
    JSON.stringify(rules(found)),
  );
  has(found.passed === true, "and the gate passes it", JSON.stringify(found.issues));
}

/* A footer full of links is correct on a phone and always has been. */
{
  const footer = page(`<footer><nav className="flex flex-col gap-2">
      <a href="/a">Terms</a><a href="/b">Privacy</a><a href="/c">Contact</a>
      <a href="/d">Careers</a><a href="/e">Press</a><a href="/f">Help</a>
    </nav></footer>`);
  has(
    !rules(staticResponsiveGate("", footer)).includes("nav-never-collapses"),
    "and a footer's link list is never mistaken for a header's",
    "flagging it would be the gate refusing a page that is right",
  );
}

/* A single page is read the same way — it is the same defect in one file. */
{
  const html = `<!doctype html><html><body><header class="flex justify-between">
    <a href="/">Brand</a>
    <nav class="flex gap-6"><a href="#a">Services</a><a href="#b">Pricing</a>
    <a href="#c">About</a><a href="#d">FAQ</a><a href="#e">Contact</a></nav>
  </header></body></html>`;
  has(
    rules(staticResponsiveGate(html, [])).includes("nav-never-collapses"),
    "a single-page build is held to it too",
  );
}

{
  const result = staticResponsiveGate("", page(`<section className="h-screen">hero</section>`));
  has(rules(result).includes("fixed-height"), "h-screen is reported");
  has(errors(result).length === 0, "as a warning, because a hero sometimes wants it", JSON.stringify(errors(result)));
}

{
  const result = staticResponsiveGate("", page(`<div className="h-[800px]">tall</div>`));
  has(rules(result).includes("fixed-height"), "so is a fixed pixel height");
}

{
  const result = staticResponsiveGate("", page(`<div className="relative"><span className="absolute top-[120px] left-[200px]">x</span></div>`));
  has(rules(result).includes("absolute-layout"), "a thing placed at a fixed coordinate is reported");
}

{
  const result = staticResponsiveGate("", page(`<div className="flex flex-row gap-4">two cards</div>`));
  has(rules(result).includes("row-never-stacks"), "a row that never stacks is reported");
}

{
  const result = staticResponsiveGate("", page(`<div className="max-w-7xl mx-auto">text</div>`));
  has(rules(result).includes("no-gutter"), "a centred container with no padding is reported");
  has(
    result.issues.some((i) => /edge of the screen/.test(i.message)),
    "in the words somebody would use to describe it",
  );
}

/* ── And what must NOT be ────────────────────────────────────────────────── */

const SOUND = [
  ["the container the brief asks for", `<section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">content</section>`],
  ["a grid that starts at one column", `<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-12">cards</div>`],
  ["a row that stacks first", `<div className="flex flex-col md:flex-row gap-4">two</div>`],
  ["a width capped rather than fixed", `<div className="w-full max-w-md md:max-w-2xl px-4">form</div>`],
  ["a fixed width that only applies from md up", `<div className="w-full md:w-[600px] px-4">panel</div>`],
  ["a small fixed size, which is an icon", `<img className="w-[24px] h-[24px]" alt="" />`],
  ["a full-width button that widens", `<button className="w-full sm:w-auto">Buy</button>`],
  ["responsive type", `<h1 className="text-3xl sm:text-4xl lg:text-6xl text-center md:text-left">Title</h1>`],
  ["min-h-dvh, which is the replacement", `<section className="min-h-dvh py-12">hero</section>`],
  ["a decorative blob near the corner", `<div className="relative"><span className="absolute top-2 left-2" /></div>`],
  ["a capped container that does have padding", `<div className="max-w-5xl mx-auto px-4">text</div>`],
];

for (const [label, body] of SOUND) {
  const result = staticResponsiveGate("", page(body));
  has(errors(result).length === 0, `${label} raises no error`, JSON.stringify(result.issues.map((i) => `${i.severity}:${i.rule}`)));
}

for (const [label, body] of SOUND.slice(0, 9)) {
  const result = staticResponsiveGate("", page(body));
  has(result.issues.length === 0, `${label} is silent altogether`, JSON.stringify(rules(result)));
}

/* ── How it behaves on a whole project ───────────────────────────────────── */

{
  const tree = [
    { path: "app/page.tsx", content: `export default function P() { return <div className="grid grid-cols-4">a</div>; }` },
    { path: "app/about/page.tsx", content: `export default function A() { return <div className="grid grid-cols-4">b</div>; }` },
    { path: "lib/data.ts", content: `export const items = ["grid-cols-4"];` },
    { path: "package.json", content: `{ "name": "x" }` },
  ];
  const result = staticResponsiveGate("", tree);

  has(result.issues.length === 2, "one finding per file, not one per element", `${result.issues.length}`);
  has(
    !result.issues.some((i) => i.where === "lib/data.ts"),
    "a class name inside a string in a .ts file is not markup",
    "grid-cols-4 in a data file is a value, not a layout",
  );
}

{
  const result = staticResponsiveGate("", [{ path: "lib/x.ts", content: "export const a = 1;" }]);
  has(result.ran === false, "a project with nothing to read reports that it did not run");
  has(result.passed === false, "rather than passing, which is the rule the whole gate exists for");
}

/* ── And that it is wired in ─────────────────────────────────────────────── */

const index = readFileSync(join(root, "src/lib/builder/qa/index.ts"), "utf8");
has(
  /gates\.responsive = staticResponsiveGate\(input\.html, tree\)/.test(index),
  "the gate runs on every build, browser or not",
);
has(
  /required: Gate\[\] = \["visual", "accessibility", "responsive", "composition"\]/.test(index),
  "and is still required for a pass to mean anything",
);

const brief = readFileSync(join(root, "src/lib/builder/scaffold.ts"), "utf8");
has(/MOBILE FIRST\./.test(brief), "the brief asks for mobile first in as many words");
has(
  /grid-cols-1 sm:grid-cols-2 lg:grid-cols-3/.test(brief),
  "with the shape to write, not a principle to hold",
  "\\\"be responsive\\\" produces a model's idea of responsive",
);
has(/px-4 sm:px-6 lg:px-8/.test(brief), "and one container rule for every section");

/* ── And the header rule is in the prompt, not only in the gate ──────────
 *
 * Retrofit is expensive here in a way the other responsive rules are not:
 * fixing a grid is editing a class, and fixing a header is adding markup and
 * behaviour. So this one has to be right the first time, which means the model
 * has to be told the two class lists before it writes the file rather than
 * after a gate has found it. */
has(
  /hidden md:flex/.test(brief) && /flex md:hidden/.test(brief),
  "the project brief names both halves of a collapsing header",
);
has(
  /BELOW `md` A HEADER IS TWO THINGS/.test(brief),
  "and says what a header IS below md, rather than asking for a responsive nav",
);

const base = readFileSync(join(root, "src/lib/builder/blueprints/base.ts"), "utf8");
has(
  /hidden md:flex/.test(base) && /flex md:hidden/.test(base),
  "and the single-page prompt carries the same rule",
  "one page and a project are the same header on the same phone",
);

/* ── Telling the model what is wrong, instead of making it look ──────────
 *
 * "Make it fit on mobile" is a perfectly clear request, and it was handed over
 * as the whole of what the model knew. The page is forty kilobytes, the defect
 * is four characters somewhere inside it, and the edit has under a minute — so
 * the minute went on reading, hunting for something this codebase had already
 * measured and could simply have said.
 *
 * That is the difference between understanding a request and being equipped to
 * answer it. The gate above knows the file, the class list and the rule. None
 * of it was reaching the one thing that could act on it. */
{
  const broken = page(`<div className="grid grid-cols-3"><span className="w-[1200px]">x</span></div>`);
  const brief = responsiveBrief("", broken);

  has(brief.length > 0, "a page with findings produces a brief");
  has(/390px/.test(brief), "which says the width it was measured at", brief.split("\n")[0]);
  has(/not guessed/.test(brief), "and that it was measured rather than guessed");
  has(/grid-cols-3/.test(brief) && /w-\[1200px\]/.test(brief), "naming the actual classes at fault");
  has(
    brief.indexOf("w-[1200px]") < brief.indexOf("grid-cols-3") ||
      brief.split("\n").findIndex((l) => /w-\[1200px\]/.test(l)) <= 2,
    "errors before warnings, because a model acts on the top of a list",
  );
  has(
    /anything else you change is a change nobody asked for/.test(brief),
    "and it is bounded, so a layout fix does not become a redesign",
  );
}

{
  /* Nothing to say, nothing said. A page with no findings must not get a
     paragraph telling it so — that is several hundred tokens of noise on a
     prompt that has under a minute to be answered in. */
  const sound = page(`<section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">ok</section>`);
  has(responsiveBrief("", sound) === "", "a sound page produces no brief at all");

  const unreadable = responsiveBrief("", [{ path: "lib/x.ts", content: "export const a = 1;" }]);
  has(unreadable === "", "and neither does one this cannot read");
}

{
  /* Wired for the request it is about, and not for every request. */
  const route = readFileSync(join(root, "src/app/api/build/route.ts"), "utf8");
  has(
    /plan\.kind === "responsive" \? responsiveBrief\(/.test(route),
    "the edit path attaches it when the ask is about a phone",
  );
  has(
    /responsiveBrief\(autofix\(currentHtml\)\.html\)/.test(route),
    "measured after the mechanical fixes, so the model is not asked to redo them",
    "autofix runs on the result either way; listing what it already fixed wastes the minute",
  );
  has(
    /: ""/.test(route.slice(route.indexOf("plan.kind === \"responsive\""), route.indexOf("plan.kind === \"responsive\"") + 200)),
    "and attaches nothing when it is not",
    "a brief about phone layout on a message about pricing copy is pure distraction",
  );
}

console.log(failed === 0 ? "\nAll responsive checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
