#!/usr/bin/env node
/* What the builder knows about a project, and what it notices when an edit
 * breaks one.
 *
 *   npm run check:brain
 *
 * Two halves of one reading — see src/lib/builder/brain.ts.
 *
 *   WHAT IT KNOWS. The facts that go in front of the model on every edit:
 *   the palette actually in use, the sections, the ids a script depends on.
 *   Wrong facts are worse than none — a model told the page uses #fff when it
 *   uses #0b0f19 will match the wrong thing confidently.
 *
 *   WHAT IT NOTICES. Regressions: a nav link pointing at a section the edit
 *   deleted, a script reaching for an id that is gone, the viewport tag lost.
 *   These pass every other check in the pipeline. The page renders, the tags
 *   balance, and the menu stopped working.
 *
 * And the half that decides whether this file is an asset or a liability: the
 * edits that must produce NO complaint. Somebody who asks for the pricing
 * section to go has asked for the pricing section to go. A guard that grumbles
 * about it has reinvented the failure this codebase has already had twice.
 *
 * No keys, no network, no browser.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-brain");
mkdirSync(out, { recursive: true });

execFileSync(
  "npx",
  ["tsc", "src/lib/builder/brain.ts", "--outDir", out, "--rootDir", "src",
   "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

const { readPage, describeProject, regressions } = await import(join(out, "lib/builder/brain.js"));

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

/* A page in the shape the builder actually produces: a dark landing page with
   a nav that points at its own sections, a script wired to an id, a form, and
   a viewport tag. Every regression below is this page with one thing done to
   it. */
const PAGE = `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700" rel="stylesheet">
  <style>
    body { background: #0b0f19; color: #e6edf7; font-family: Inter, sans-serif; }
    .card { background: #0b0f19; border: 1px solid #1e2a3e; }
    .cta { background: #3b82f6; }
  </style>
</head>
<body>
  <header><nav id="nav">
    <a href="#hero">Home</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a>
    <button id="menu-toggle">Menu</button>
  </nav></header>
  <main>
    <section id="hero"><h1>Build. Edit. Launch.</h1></section>
    <section id="pricing"><h2>Pricing</h2><div class="card">Free</div></section>
    <section id="faq"><h2>Questions</h2>
      <form id="signup"><input name="email"><button type="submit">Join</button></form>
    </section>
  </main>
  <footer><p>Your code leaves with you</p></footer>
  <script>
    document.getElementById('menu-toggle').addEventListener('click', () => {
      document.querySelector('#nav').classList.toggle('open');
    });
  </script>
</body>
</html>`;

const profile = readPage(PAGE);

// ── What it knows ─────────────────────────────────────────────────────────

has(
  ["hero", "pricing", "faq"].every((id) => profile.sections.includes(id)),
  "the sections are read by the name somebody chose",
  profile.sections.join(", "),
);

/* The palette by USE, so the summary leads with what carries the page. #0b0f19
   appears twice and must outrank the accent that appears once. */
has(profile.colors[0] === "#0b0f19", "the commonest colour leads the palette", profile.colors.join(", "));
has(profile.colors.includes("#3b82f6"), "and the accent is still in the list", profile.colors.join(", "));

has(profile.fonts.includes("Inter"), "the typeface is read from what the page loads", profile.fonts.join(", "));

/* THE WIRING. These three lists are what every regression rule below compares. */
has(profile.anchors.includes("menu-toggle"), "ids the page defines are collected");
has(profile.linkTargets.includes("pricing"), "and the ids its own links point at");
has(profile.scriptTargets.includes("menu-toggle"), "and the ids its scripts reach for by id");
has(profile.scriptTargets.includes("nav"), "including through a querySelector");
has(profile.responsive === true, "the viewport tag is noticed");
has(profile.forms === 1 && profile.inputs === 1, "forms and fields are counted", `${profile.forms}/${profile.inputs}`);

/* A script's contents are code, not markup — a <div> written inside a template
   literal must not be counted as an element on the page. */
const SCRIPTED = PAGE.replace("</script>", "const t = `<form><input></form>`;\n</script>");
has(readPage(SCRIPTED).forms === 1, "markup written inside a script is not counted as markup");

// ── What it says ──────────────────────────────────────────────────────────

const said = describeProject(profile);
has(said.includes("#0b0f19"), "the summary names the palette");
has(said.includes("hero"), "and the sections");
has(/do not rename or remove/.test(said), "and warns off the ids a script depends on", said.split("\n").find((l) => l.includes("Scripts")));
has(describeProject(readPage("")) === "", "a page with nothing to say produces no preamble");

/* It rides in front of the whole document on every edit, so it has to stay
   small enough that it is never the reason a prompt got expensive. */
has(said.length < 1200, `the summary is ${said.length} characters, not a second copy of the page`);

// ── What it notices ───────────────────────────────────────────────────────

const before = readPage(PAGE);
const noticed = (after) => regressions(before, readPage(after));

/* THE ONE. "Delete the pricing section" — a request somebody made, carried out
   correctly, that leaves the nav pointing at nothing. The edit is right. The
   menu is broken. Nothing else in the pipeline can tell. */
const deletedSection = PAGE.replace(
  '<section id="pricing"><h2>Pricing</h2><div class="card">Free</div></section>',
  "",
);
const afterDelete = noticed(deletedSection);
has(afterDelete.length > 0, "deleting a section that the nav points at is noticed", afterDelete.join("; "));
has(/#pricing/.test(afterDelete.join(" ")), "and it names the link that now goes nowhere", afterDelete.join("; "));

/* A script left reaching for an id the edit removed. The button is still
   there, still styled, and does nothing. */
const droppedId = PAGE.replace('<button id="menu-toggle">Menu</button>', "<button>Menu</button>");
const afterDrop = noticed(droppedId);
has(/menu-toggle/.test(afterDrop.join(" ")), "a script left pointing at a removed id is noticed", afterDrop.join("; "));

/* One line, and the page stops working on a phone — on a page whose author is
   looking at a desktop. */
has(
  /viewport/.test(noticed(PAGE.replace(/<meta name="viewport"[^>]*>/, "")).join(" ")),
  "losing the viewport tag is noticed",
);

/* The form gone from a page that had one. */
has(
  noticed(PAGE.replace(/<form id="signup">[\s\S]*?<\/form>/, "")).some((line) => /form/.test(line)),
  "a form that vanished is noticed",
);

/* Scripts stripped out entirely. */
has(
  noticed(PAGE.replace(/<script>[\s\S]*?<\/script>/, "")).some((line) => /interactive/.test(line)),
  "the page's scripts being removed is noticed",
);

// ── What must produce no complaint ────────────────────────────────────────
/* Every one of these is somebody getting exactly what they asked for. A guard
   that grumbles here is worse than no guard: it teaches people to ignore it. */

const quiet = (after, what) => {
  const found = noticed(after);
  has(found.length === 0, what, found.join("; "));
};

quiet(PAGE.replace("#3b82f6", "#22d3ee"), "changing an accent colour says nothing");
quiet(PAGE.replace("Build. Edit. Launch.", "Ship it today."), "rewriting a headline says nothing");
quiet(PAGE.replace("Menu", "Open menu"), "relabelling a button says nothing");
quiet(PAGE.replace('class="card"', 'class="card card--lg"'), "adding a class says nothing");

/* The one that matters most: deleting a section AND the link to it. That is
   the complete, correct edit, and it must pass in silence. */
quiet(
  deletedSection.replace('<a href="#pricing">Pricing</a>', ""),
  "deleting a section and its nav link together says nothing",
);

/* A whole new section added. Growth is not regression. */
quiet(
  PAGE.replace("</main>", '<section id="team"><h2>Team</h2></section></main>'),
  "adding a section says nothing",
);

/* An external link is none of this file's business — it cannot be checked from
   here and must never be reported as broken. */
quiet(
  PAGE.replace('<a href="#hero">Home</a>', '<a href="https://example.com">Home</a>'),
  "an external link is not treated as a broken anchor",
);

/* And a page that was ALREADY broken stays editable forever. The nav here
   points at #missing before the edit and after it; that is not this edit's
   doing and must not be laid at its door. */
const ALREADY = PAGE.replace('<a href="#faq">FAQ</a>', '<a href="#missing">Gone</a>');
const stillBroken = regressions(readPage(ALREADY), readPage(ALREADY.replace("Ship", "Launch")));
has(stillBroken.length === 0, "a page that was already broken is still editable", stillBroken.join("; "));

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
