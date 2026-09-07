#!/usr/bin/env node
/* Checks the design systems: that one is always chosen, that each is coherent,
 * and that the colours in them are legible.
 *
 *   npm run check:design
 *
 * The contrast half is the reason this file exists rather than being three
 * assertions inside check-blueprint. These palettes are written by hand, and a
 * hand-written palette is exactly the kind of thing where somebody nudges a
 * grey two steps lighter because it looked nicer in isolation and quietly puts
 * every caption in the product below the legibility floor. Nothing else in this
 * codebase would notice: the page renders, the build passes, and the text is
 * simply hard to read for anyone who does not have perfect eyesight and a good
 * monitor.
 *
 * So the ratios are computed here, against the WCAG formula, on every system.
 *
 * Offline and free. No network, no key.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-design");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
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
      join(process.cwd(), "src/lib/builder/design.ts"),
      join(process.cwd(), "src/lib/builder/qa/contrast.ts"),
    ],
  }),
);

execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });

for (const dir of [join(out, "lib/builder"), join(out, "lib/builder/qa")]) {
 for (const entry of readdirSync(dir)) {
  if (!entry.endsWith(".js")) continue;
  const path = join(dir, entry);
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(
      /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
      (whole, before, specifier, after) =>
        specifier.endsWith(".js") ? whole : `${before}${specifier}.js${after}`,
    ),
  );
 }
}

const { SYSTEMS, decideDesign, designBrief, systemByName, tokensCss, typeScale, isDark } =
  await import(join(out, "lib/builder/design.js"));

let failures = 0;

function fail(what, detail) {
  failures += 1;
  console.error(`  ✗ ${what}\n    ${detail}`);
}

function pass(what) {
  console.log(`  ✓ ${what}`);
}

/* Contrast comes from the app's own implementation rather than a copy of it —
   §7, and the reason there is only one: two implementations of the WCAG formula
   disagree the moment somebody writes the naive version from memory, and then
   nobody knows which one a palette was measured against. */
const { contrast, luminance } = await import(join(out, "lib/builder/qa/contrast.js"));

console.log("\nContrast");

for (const system of SYSTEMS) {
  const { ink, muted, ground, surface, accent, accentInk } = system.color;

  /* Body text carries the whole page, so it is held to AAA rather than to the
     4.5 that merely passes. A generated site is read on laptop screens in
     daylight, not in a lab. */
  const checks = [
    ["ink on ground", contrast(ink, ground), 7],
    ["ink on surface", contrast(ink, surface), 7],
    ["muted on ground", contrast(muted, ground), 4.5],
    ["muted on surface", contrast(muted, surface), 4.5],
    /* A button's label. This is the one people get wrong: a mid-tone accent
       with white on it looks fine to the person who chose it and fails. */
    ["accent-ink on accent", contrast(accentInk, accent), 4.5],
  ];

  const bad = checks.filter(([, ratio, floor]) => ratio < floor);

  if (bad.length > 0) {
    fail(
      system.name,
      bad.map(([what, ratio, floor]) => `${what} is ${ratio}:1, needs ${floor}:1`).join("; "),
    );
    continue;
  }

  pass(
    `${system.name} — ink ${contrast(ink, ground)}:1, muted ${contrast(muted, ground)}:1, button ${contrast(accentInk, accent)}:1`,
  );
}

/* ── Coherence ────────────────────────────────────────────────────────────*/

console.log("\nCoherence");

for (const system of SYSTEMS) {
  const problems = [];

  /* A scale with no rhythm is a scale nobody follows. Two steps that round to
     the same pixel are two names for one size. */
  const scale = typeScale(system.type);
  const sizes = scale.map((step) => step.px);
  if (new Set(sizes.map((size) => Math.round(size))).size !== sizes.length) {
    problems.push("two type steps round to the same pixel");
  }
  if (sizes.some((size, index) => index > 0 && size <= sizes[index - 1])) {
    problems.push("the type scale is not strictly increasing");
  }

  /* The spacing scale is the thing the prompt tells the model it may not
     depart from, so it has to be usable: ascending, and starting small enough
     for the inside of a button. */
  if (system.space.some((value, index) => index > 0 && value <= system.space[index - 1])) {
    problems.push("the spacing scale is not strictly increasing");
  }
  if (system.space[0] > 8) problems.push("the spacing scale starts too coarse for a button's padding");

  /* `color-scheme` has to agree with the ground, or the browser draws its own
     form controls in the wrong theme on top of the page. */
  const dark = isDark(system);
  const groundLuminance = luminance(system.color.ground);
  if (dark !== groundLuminance < 0.2) {
    problems.push(`isDark says ${dark} for a ground of luminance ${groundLuminance.toFixed(2)}`);
  }

  /* Only one webfont, ever, and it has to actually be first in the stack or
     loading it bought nothing. */
  if (system.type.webfont) {
    if (!system.type.display.includes(system.type.webfont.family)) {
      problems.push("a webfont is loaded but is not in the display stack");
    }
    if (!/^https:\/\/fonts\.googleapis\.com\//.test(system.type.webfont.href)) {
      problems.push("the webfont is not from a host the page can reach");
    }
  }

  /* Every stack needs a real generic at the end, or a machine without the
     named faces falls back to the browser default mid-design. */
  for (const [which, stack] of [["display", system.type.display], ["body", system.type.body]]) {
    if (!/(serif|sans-serif|monospace)\s*$/.test(stack)) {
      problems.push(`the ${which} stack has no generic family at the end`);
    }
  }

  if (problems.length > 0) {
    fail(system.name, problems.join("; "));
    continue;
  }

  pass(`${system.name} — ${sizes.length} type steps, ${system.space.length} space steps, stacks fall back`);
}

/* ── The decision ─────────────────────────────────────────────────────────*/

console.log("\nThe decision");

const CASES = [
  { register: "luxury editorial", kind: "ecommerce", brief: "a boutique for silk scarves", expect: "Editorial serif" },
  { register: "warm documentary", kind: "ecommerce", brief: "handmade candles", expect: "Warm craft" },
  { register: "clean clinical", kind: "landing", brief: "a dental practice", expect: "Clinical precision" },
  { register: "technical documentary", kind: "webapp", brief: "an API monitoring tool", expect: "Technical" },
  { register: "press photography — the frame a wire service filed", kind: "news", brief: "a local paper", expect: "Press" },
  { register: "clear commercial", kind: "landing", brief: "a plumbing company", expect: "Modern commercial" },
  /* A brief that names the look beats the register it was inferred from. */
  { register: "clear commercial", kind: "landing", brief: "a dark mode developer tool landing page", expect: "Technical" },
  { register: "catalogue-consistent product photography", kind: "ecommerce", brief: "an elegant editorial jewellery store", expect: "Editorial serif" },
  /* And a register nobody recognises still gets a considered answer. */
  { register: "something nobody wrote a rule for", kind: "blog", brief: "a blog", expect: "Press" },
];

for (const testCase of CASES) {
  const result = decideDesign(testCase.register, testCase.kind, testCase.brief);

  if (result.dna.name !== testCase.expect) {
    fail(testCase.brief, `expected ${testCase.expect}, got ${result.dna.name}`);
    continue;
  }
  if (!result.reason || result.reason.length < 10) {
    fail(testCase.brief, "chose a system and gave no reason for it");
    continue;
  }

  pass(`${testCase.brief} → ${result.dna.name}`);
}

/* The name is what travels between processes, so a round trip has to land on
   the same object — and anything else must land on null rather than on a
   default that would silently restyle a project. */
for (const system of SYSTEMS) {
  if (systemByName(system.name) !== system) {
    fail("systemByName", `${system.name} does not round-trip`);
  }
}
for (const bad of ["", "Editorial", "editorial serif", null, undefined, 42, {}]) {
  if (systemByName(bad) !== null) {
    fail("systemByName", `${JSON.stringify(bad)} resolved to a system instead of null`);
  }
}

/* ── What is emitted ──────────────────────────────────────────────────────*/

console.log("\nEmitted");

for (const system of SYSTEMS) {
  const css = tokensCss(system);
  const brief = designBrief(system);
  const problems = [];

  /* Every token the prompt tells the model to use has to exist in the file it
     is told to use them from. This is the pairing that silently breaks: a
     variable renamed in one and not the other produces a page styled with
     `var(--muted)` resolving to nothing, which renders as black text with no
     error anywhere. */
  const named = [...brief.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((match) => match[1]);
  for (const token of new Set(named)) {
    if (!css.includes(`--${token}:`)) {
      problems.push(`the prompt names var(--${token}) and the stylesheet does not define it`);
    }
  }

  if (!css.includes(":root {")) problems.push("no :root block");
  if (!/color-scheme:\s*(light|dark)/.test(css)) problems.push("no color-scheme");

  /* The spacing scale in the prompt has to be the one in the file. */
  for (const value of system.space) {
    if (!css.includes(`${value}px;`)) problems.push(`space ${value}px is missing from the stylesheet`);
  }

  if (problems.length > 0) {
    fail(system.name, problems.slice(0, 4).join("; "));
    continue;
  }

  pass(`${system.name} — ${new Set(named).size} tokens named in the prompt, all defined`);
}

console.log("");

if (failures > 0) {
  console.error(`${failures} ${failures === 1 ? "failure" : "failures"}.\n`);
  process.exit(1);
}

console.log("All good.\n");
