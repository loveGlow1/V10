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
const { staticResponsiveGate } = require(join(out, "lib/builder/qa/responsive.js"));

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

console.log(failed === 0 ? "\nAll responsive checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
