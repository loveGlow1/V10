#!/usr/bin/env node
/* Checks that an edit is classified against what the project is, and that it
 * knows what to leave alone.
 *
 *   npm run check:edit-plan
 *
 * Two things, and the second is the one worth having.
 *
 * The first is routing: "make the hero darker" is a look and "add product
 * reviews" is a table, and a classifier that confuses them either builds a
 * database for a colour change or answers a feature request with some CSS.
 *
 * The second is the protect list. §15, §21, and the reason the whole file
 * exists: an edit about one section must not be able to reach the database, the
 * auth or the design tokens. That list is what goes into the prompt, and if it
 * silently empties nothing else in the system notices — the edits just start
 * touching more than they were asked to, one build at a time.
 *
 * Offline and free.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-edit-plan");
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
      join(process.cwd(), "src/lib/builder/edit-plan.ts"),
      join(process.cwd(), "src/lib/builder/kinds.ts"),
    ],
  }),
);

execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { stdio: ["ignore", "ignore", "inherit"] });

for (const entry of readdirSync(join(out, "lib/builder"))) {
  if (!entry.endsWith(".js")) continue;
  const path = join(out, "lib/builder", entry);
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(
      /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
      (whole, before, specifier, after) =>
        specifier.endsWith(".js") ? whole : `${before}${specifier}.js${after}`,
    ),
  );
}

const { planEdit, editPlanBrief, describeEdit } = await import(join(out, "lib/builder/edit-plan.js"));

let failures = 0;
const fail = (what, detail) => {
  failures += 1;
  console.error(`  ✗ ${what}\n    ${detail}`);
};
const pass = (what) => console.log(`  ✓ ${what}`);

/* A full store: every layer on. Most cases below run against this, because a
   protect list is only meaningful when there is something to protect. */
const STORE = {
  type: "ecommerce",
  frontend: true,
  backend: true,
  database: true,
  authentication: true,
  admin: true,
  storage: true,
  payments: true,
};

/* And a landing page: nothing but a front end. */
const LANDING = {
  type: "landing",
  frontend: true,
  backend: false,
  database: false,
  authentication: false,
  admin: false,
  storage: false,
  payments: false,
};

/* ── Routing (§3) ─────────────────────────────────────────────────────────*/

console.log("\nWhat kind of change this is");

const CASES = [
  { message: "make the hero darker", kind: "visual" },
  { message: "change the headline to something shorter", kind: "content" },
  { message: "fix the typo in the footer", kind: "content" },
  { message: "the nav overlaps on my phone", kind: "responsive" },
  { message: "change the brand font everywhere", kind: "design_system" },
  { message: "add login", kind: "authentication" },
  { message: "add an admin discount system", kind: "multi_layer" },
  { message: "add product reviews", kind: "multi_layer" },
  { message: "add a wishlist button", kind: "multi_layer" },
];

for (const testCase of CASES) {
  const plan = planEdit(testCase.message, STORE);
  if (plan.kind !== testCase.kind) {
    fail(testCase.message, `read as ${plan.kind}, expected ${testCase.kind}`);
    continue;
  }
  if (plan.why.length === 0) fail(testCase.message, "classified and said nothing about why");
  else pass(`${testCase.message} → ${describeEdit(plan)}`);
}

/* ── A feature reaches the layers nobody named (§4, §12) ──────────────────*/

console.log("\nA feature reaches what it needs");
{
  const reviews = planEdit("add product reviews", STORE);
  for (const layer of ["database", "authentication", "backend", "frontend"]) {
    if (!reviews.touches.includes(layer)) {
      fail("add product reviews", `does not reach ${layer}, so half of it would not get built`);
    }
  }
  if (reviews.touches.includes("payments")) {
    fail("add product reviews", "reaches payments, which has nothing to do with it");
  }
  if (failures === 0) pass(`reviews reach ${reviews.touches.join(", ")}`);

  const wishlist = planEdit("let customers save products for later", STORE);
  if (!wishlist.touches.includes("database") || !wishlist.touches.includes("authentication")) {
    fail("a wishlist", `reaches only ${wishlist.touches.join(", ")} — a saved list is somebody's and outlives the visit`);
  } else pass("a saved list reaches the database and the account it belongs to");

  /* Searching what is already on the page needs nothing new. The mirror of the
     above, and the one that stops every request growing a table. */
  const search = planEdit("add a search box to filter the products", STORE);
  if (search.touches.includes("database")) {
    fail("a search box", "grew a database for filtering markup that is already there");
  } else pass("filtering what is already on the page adds nothing");
}

/* ── The protect list (§15, §21) ──────────────────────────────────────────*/

console.log("\nWhat must be left alone");
{
  const hero = planEdit("make the hero darker", STORE);

  for (const layer of ["database", "authentication", "admin", "payments"]) {
    if (!hero.protect.includes(layer)) {
      fail("make the hero darker", `does not protect ${layer} — nothing stops the edit reaching it`);
    }
  }
  if (hero.protect.length === 0) fail("make the hero darker", "protects nothing at all");
  else if (failures === 0) pass(`a colour change protects ${hero.protect.join(", ")}`);

  /* And the mirror: a change that genuinely reaches a layer must NOT protect
     it, or the prompt tells the model both to change it and not to. */
  const auth = planEdit("add google login", STORE);
  if (auth.protect.includes("authentication")) {
    fail("add google login", "protects the very layer it is about — the prompt would contradict itself");
  } else if (!auth.touches.includes("authentication")) {
    fail("add google login", "does not reach authentication");
  } else pass("a change about signing in does not protect signing in");

  /* Nothing known about the project protects nothing. Asserting otherwise
     would be inventing constraints from an absence. */
  const unknown = planEdit("make the hero darker", null);
  if (unknown.protect.length > 0) {
    fail("no manifest", "protected layers it has no evidence exist");
  } else pass("nothing known → nothing asserted");
}

/* ── Asking for what is not there ─────────────────────────────────────────*/

console.log("\nA request the project cannot satisfy");
{
  const onLanding = planEdit("let people sign in and save their favourites", LANDING);

  if (onLanding.missing.length === 0) {
    fail("a landing page", "was asked for accounts and reported nothing missing");
  } else if (onLanding.certain) {
    fail("a landing page", "reported certain about a change that needs layers it does not have");
  } else {
    const brief = editPlanBrief(onLanding, LANDING, null);
    if (!/does not have/i.test(brief)) {
      fail("a landing page", "the brief does not say the layers are missing, so the model would fake them");
    } else pass(`missing ${onLanding.missing.join(", ")}, and the brief says so`);
  }

  /* The same request on a store is ordinary work. */
  const onStore = planEdit("let people sign in and save their favourites", STORE);
  if (onStore.missing.length > 0) fail("a store", `reported ${onStore.missing.join(", ")} missing when it has them`);
  else if (!onStore.certain) fail("a store", "is uncertain about a change it can obviously make");
  else pass("the same request on a store is ordinary work");
}

/* ── "Just change the wording" is not a feature request ───────────────────*/

console.log("\nAsking about a feature is not asking for one");
{
  const surface = planEdit("just fix the wording on the reviews section", STORE);
  if (surface.touches.includes("database")) {
    fail("fix the wording on the reviews section", "read a copy change as a request to build reviews");
  } else pass("a copy change about a feature stays a copy change");
}

/* ── The brief (§7, §21) ──────────────────────────────────────────────────*/

console.log("\nThe brief the model is given");
{
  const plan = planEdit("make the hero darker", STORE);
  const brief = editPlanBrief(plan, STORE, "Warm craft");

  const required = [
    [/DO NOT TOUCH/i, "does not name what to leave alone"],
    [/Warm craft/i, "does not name the design system"],
    [/smallest thing/i, "does not ask for the smallest change"],
    [/extend it/i, "does not ask for the existing component to be reused"],
    /* The human label, not the internal key. "It is a ecommerce" is the kind of
       sentence that tells a model it is reading machine output. */
    [/an online store/i, "does not say what the project is, in words"],
  ];

  const missing = required.filter(([pattern]) => !pattern.test(brief));
  if (missing.length > 0) fail("the brief", missing.map(([, why]) => why).join("; "));
  else pass(`${brief.split("\n").length} lines: what it is, what this reaches, what not to touch`);

  /* With nothing known, the brief must not assert anything — an empty manifest
     producing confident claims about the project is worse than saying nothing. */
  const blind = editPlanBrief(planEdit("make the hero darker", null), null, null);
  if (/DO NOT TOUCH/i.test(blind)) {
    fail("the brief", "names protected layers for a project it knows nothing about");
  } else pass("nothing known → the brief claims nothing");
}

console.log("");

if (failures > 0) {
  console.error(`${failures} ${failures === 1 ? "failure" : "failures"}.\n`);
  process.exit(1);
}

console.log("All good.\n");
