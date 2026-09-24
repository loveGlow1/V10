#!/usr/bin/env node
/* What the file-tree generator is actually told.
 *
 *   npm run check:tree-brief
 *
 * blueprints/webapp.ts governs the single-page stack and treeBrief governs the
 * Next.js one, and for a long time only the first of them had learned anything
 * about what separates a product from a demo. A tree build got the right
 * states, the right auth and the right admin writes, and nothing anywhere said
 * its content had to read like an account somebody uses — so three rows of
 * "Item 1" satisfied every rule there was.
 *
 * The two briefs will keep drifting; they are different files written at
 * different times for different stacks. What must not drift is the handful of
 * rules below, each of which is a production complaint rather than a
 * preference.
 *
 * Offline. No model, no network, no key.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-tree-brief");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, strict: true, types: ["node"],
      typeRoots: [join(process.cwd(), "node_modules", "@types")],
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [join(process.cwd(), "src/lib/builder/scaffold.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });

/* tsc keeps the "@/" specifiers and drops extensions; both are put back before
   node loads any of it, the same way check-architecture does. */
const rewrite = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { rewrite(path); continue; }
    if (!path.endsWith(".js")) continue;
    const depth = path.slice(out.length + 1).split("/").length - 1;
    /* Line-based, and only on lines that ARE an import or an export. The
       whole-file regex this started as also matched `from "../../${path}"`
       inside a template literal in next-structure.ts — scaffold.ts pulls that
       module in — and rewrote it into a syntax error. A specifier only ever
       appears at the end of a top-level import or export line. */
    const fixed = readFileSync(path, "utf8")
      .split("\n")
      .map((line) => {
        if (!/^\s*(?:import|export)\b/.test(line)) return line;
        return line
          .replace(/(from\s+["'])@\/(.+?)(["'];?\s*)$/, (_w, a, spec, b) => `${a}${"../".repeat(depth) || "./"}${spec}.js${b}`)
          .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'];?\s*)$/, (w, a, spec, b) => (spec.endsWith(".js") ? w : `${a}${spec}.js${b}`));
      })
      .join("\n");
    writeFileSync(path, fixed);
  }
};
rewrite(join(out, "lib"));

const { treeBrief } = await import(join(out, "lib/builder/scaffold.js"));

let failed = 0;
let passed = 0;
const ok = (t) => { passed += 1; console.log(`ok    ${t}`); };
const fail = (t, d) => { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const manifest = (over = {}) => ({
  type: "webapp", frontend: true, backend: true, database: true,
  authentication: false, admin: false, storage: false, payments: false, ...over,
});
const model = { schema: "app_1", tables: [], buckets: [] };

console.log("\nA web app is shaped like the product, not like a template:");

const app = treeBrief("webapp", manifest(), model);

/* THE ONE. ROUTES.webapp was ["app/dashboard/page.tsx", "app/login/page.tsx"],
   so an invoicing tool — whose own areas are invoices, clients and payments —
   was handed a route called "dashboard" because of the folder it was filed in.
   blueprints/webapp.ts had already worked this out and said "say nothing about
   a dashboard unless it needs one"; the lesson never reached here, and a file
   list beats a principle because it names files. */
/* Asked of the FILE LIST, not of the whole brief. The brief names the path
   once more in a prohibition — "do NOT write app/dashboard/page.tsx unless the
   product genuinely is a dashboard" — and a substring test over the whole text
   cannot tell an instruction from its opposite. A file to write is a line that
   starts with it. */
has(
  !/^- app\/dashboard\/page\.tsx/m.test(app),
  "no dashboard route is forced on a product that never asked for one",
  "an invoicing tool has invoices and clients, not a 'dashboard'",
);
has(
  /do NOT write `app\/dashboard\/page\.tsx`/i.test(app),
  "and the model is told so in as many words",
);
has(
  /named in its own words/i.test(app),
  "and the routes are asked for in the product's own words",
);

/* A login page for an app with no accounts is furniture. */
has(
  !/^- app\/login\/page\.tsx/m.test(app),
  "no login route when the product has no accounts",
  "authentication is what decides this, not the kind",
);

const authed = treeBrief("webapp", manifest({ authentication: true }), model);
has(/^- app\/login\/page\.tsx/m.test(authed), "and a login route the moment it has them");
has(
  (authed.match(/^- app\/login\/page\.tsx/gm) ?? []).length === 1,
  "listed once, not twice",
  "it was in both ROUTES and the authentication branch",
);

console.log("\nAnd the content reads like something in use:");

/* Each of these lived only in blueprints/webapp.ts, which does not govern this
   stack. Their absence is the generic-output look, and none of it was anybody
   disobeying a rule. */
has(
  /own vocabulary/i.test(app) && /never Items, Records/i.test(app),
  "the product's own words for its own objects",
  "'Items' on a generic dashboard is the tell",
);
has(
  /twenty or more rows/i.test(app),
  "a seeded floor with a number in it",
  "'make it realistic' is not followed; a number is",
);
has(
  /computed from the data that is actually there/i.test(app),
  "and every figure derives from the rows on the page",
  "a total that is not computed is the first thing a person checks",
);

console.log("\nA store's routes are its capabilities':");

/* ROUTES.ecommerce listed a cart for every project filed as a store, and
   ADMIN_ROUTES listed an orders screen for every project with an admin. So a
   catalogue — no cart anywhere in its manifest — was handed app/cart/page.tsx
   to write, and a catalogue whose owner wanted to edit it got an admin for
   orders it does not take. The manifest knew and the file list did not ask,
   which is the same defect the hardcoded webapp dashboard had. */
const { decideCommerce } = await import(join(out, "lib/builder/commerce.js"));

const shopManifest = (brief, over = {}) => ({
  ...manifest(),
  type: "ecommerce",
  storage: true,
  commerce: decideCommerce(brief).commerce,
  ...over,
});

const SHOWCASE = "Create a website showcasing our products.";
const showcase = treeBrief("ecommerce", shopManifest(SHOWCASE), model);

has(/^- app\/products\/page\.tsx/m.test(showcase), "a catalogue gets its products");
has(!/^- app\/cart\/page\.tsx/m.test(showcase), "and no cart, because it has none",
  "a cart route is a cart, however plainly the manifest says otherwise");
has(!/^- app\/checkout\/page\.tsx/m.test(showcase), "and no checkout");

const STORE = "Build me an online store where customers can add products to a cart and buy them.";
const store = treeBrief("ecommerce", shopManifest(STORE), model);

has(/^- app\/cart\/page\.tsx/m.test(store), "a store gets its cart");
has(/^- app\/checkout\/page\.tsx/m.test(store), "and somewhere to complete the order",
  "a basket with nowhere to check out can only ever be filled");

const MANAGED = "a store where I can manage products from an admin dashboard";
const managed = treeBrief("ecommerce", shopManifest(MANAGED, { admin: true, authentication: true }), model);

has(/^- app\/admin\/products\/page\.tsx/m.test(managed), "an admin gets its product screens");
has(!/^- app\/admin\/orders\/page\.tsx/m.test(managed), "and no orders screen for orders it does not take");
has(!/^- app\/account\/orders\/page\.tsx/m.test(managed), "nor an order history behind the account");

/* A manifest written before commerce was decomposed is read back on every edit
   of an existing project. Dropping a running store's cart route would be far
   worse than writing one that need not be. */
const legacy = treeBrief("ecommerce", { ...manifest(), type: "ecommerce", commerce: undefined }, model);
has(/^- app\/cart\/page\.tsx/m.test(legacy), "a manifest from before commerce existed keeps the full shop");

console.log("\nThe other kinds keep the routes they really have:");

/* These were never the problem: every store has products and a basket, every
   blog has an index and a post. Removing them would be a different bug. */
has(/app\/products\/page\.tsx/.test(treeBrief("ecommerce", manifest(), model)), "a store still gets products");
has(/app\/cart\/page\.tsx/.test(treeBrief("ecommerce", manifest(), model)), "and a basket");
has(/app\/blog\/page\.tsx/.test(treeBrief("blog", manifest(), model)), "a blog still gets its index");

console.log("\nAn overview screen is a screen:");

/* The complaint: "dashboards should be an actual dashboard with live
   components consistent with the project request". The brief already required
   every figure to be COMPUTED, and that was satisfied by four correct tiles
   and a heading — a page nobody opens twice. These pin the three parts that
   make it a tool rather than a report, and they are pinned because each is a
   floor with something checkable in it: a control that re-queries, the
   product's own words, and a loading state. */
{
  const brief = treeBrief("webapp", manifest({ admin: true, authentication: true }), model);

  has(/re-?quer/i.test(brief), "it must carry a control that re-queries");
  has(
    /overview/i.test(brief) && /recent/i.test(brief),
    "and the recent rows of its main object",
  );
  has(
    /Total Revenue/i.test(brief),
    "the generic tiles are named as the thing to avoid",
    "Naming them is what stops them: 'be specific' is not followed and 'never write Total Revenue on a product that has no revenue' is.",
  );
  has(/empty state/i.test(brief), "and it has a loading and an empty state");
}

console.log("\nPhotographs: the generator is told what it actually has:");

/* The production complaint this guards: a catalogue that shipped as grey
   rounded rectangles with alt text in them, while Unsplash was answering
   normally and the resolved URLs were sitting in the prompt a few lines above.
 *
 * treeBrief was handed `imageUrls.length` — a count of the REFERENCE IMAGES THE
 * CUSTOMER ATTACHED, which is 0 on nearly every build — so it told the model
 * "No pictures were resolved ahead of this build" while manifestForPrompt was
 * telling it "use these exact URLs and no others". The model believed the
 * second instruction and declared slots it then factored into a component,
 * which images.ts cannot match.
 *
 * Nothing about the asset pipeline was wrong, and nothing about it is being
 * tested here. What is pinned is narrower and is the thing that broke: the two
 * branches must stay exactly opposite, so that a count arriving wrong can never
 * again leave the brief agreeing with itself while contradicting the manifest. */

const withPhotos = treeBrief("ecommerce", manifest(), model, undefined, 4);
const noPhotos = treeBrief("ecommerce", manifest(), model, undefined, 0);

has(
  /lib\/images\.ts/.test(withPhotos),
  "with photographs resolved, the brief points at lib/images.ts",
  "A build whose manifest carries real URLs must be told to use them.",
);
has(
  !/DECLARED, NOT DRAWN/.test(withPhotos),
  "and does not also tell it no pictures were resolved",
  "This is the contradiction itself: both instructions in one prompt.",
);

has(
  /DECLARED, NOT DRAWN/.test(noPhotos),
  "with none resolved, the brief asks for fillable slots",
  "Slots are the correct path when the pipeline genuinely found nothing.",
);
has(
  !/lib\/images\.ts/.test(noPhotos),
  "and does not point at a list of URLs that is not there",
);

/* A slot is only fillable if its art direction is a literal on the tag.
   `<img data-shot={shot}>` inside a shared component matches nothing in
   images.ts, and that is how every card in a catalogue stays empty while the
   build reports success. */
has(
  /literal/i.test(noPhotos) && /component/i.test(noPhotos),
  "and says the slot must be a literal tag rather than a component",
  "Without this the model factors the slot into <ProductPhoto shot={p.shot} />.",
);

console.log(failed === 0 ? `\nAll ${passed} passed.` : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
