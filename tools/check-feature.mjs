#!/usr/bin/env node
/* Adding a feature to a project that already exists.
 *
 *   npm run check:feature
 *
 * "Add a user dashboard" used to have two answers and both were wrong: an edit,
 * which can only patch one file that already exists, or a full rebuild that
 * wrote the whole project again and charged for all of it. A feature is now a
 * build that is handed the project, returns only the files it creates or
 * changes, and is merged over the project. These are the rules that make that
 * safe — chiefly that a merge can never delete anything.
 *
 * Offline. No model, no network, no key.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-feature");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, strict: true, types: ["node"],
      typeRoots: [join(process.cwd(), "node_modules", "@types")],
    },
    files: [join(process.cwd(), "src/lib/builder/feature.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
/* feature.ts imports only a type, which tsc erases, so the output loads as is. */
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

const { featureFor, featureBrief, mergeFeature, appFeatureFor, upgradeOffer, upgradeBrief, restyleFor, restyleBrief } = await import(
  join(out, "lib/builder/feature.js")
);

let failed = 0;
let passed = 0;
const has = (cond, t, d) => {
  if (cond) { passed += 1; console.log(`ok    ${t}`); }
  else { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
};

const full = "x".repeat(2000);
const project = [
  "app/layout.tsx", "app/page.tsx", "app/about/page.tsx", "app/contact/page.tsx", "app/login/page.tsx",
  "app/properties/page.tsx", "components/Nav.tsx", "lib/supabase.ts", "lib/database.types.ts",
].map((path) => ({ path, content: full }));
/* The stub a staged build left behind — a route that exists and a feature that does not. */
project.push({ path: "app/admin/page.tsx", content: "<p>will be built out in a later stage</p>" });
const ask = (message) => featureFor(message, project);

console.log("\nWhat counts as adding something:");
has(ask("add a dashboard for users to see their saved properties")?.areas.includes("a dashboard"), "a dashboard the project does not have");
has(ask("build a user dashboard with login")?.areas.join() === "a dashboard", "only the part that is new — sign-in already exists");
has(ask("create an admin dashboard to manage listings")?.areas.join() === "an admin area", "a stub page is not a built one, and an admin dashboard is not also a member one");
has(ask("make me a booking page for appointments")?.areas.join() === "bookings", "'make me a …' is making something, and is counted once");
has(ask("add a pricing page")?.areas.join() === "a pricing page", "a named page is a route of its own");

console.log("\nAnd what is an ordinary edit:");
has(ask("add a contact page") === null, "a page the project already has");
has(ask("make the dashboard darker") === null, "'make … darker' changes something; it makes nothing");
has(ask("change the hero image") === null, "a change to what is there");
has(ask("add a landing page section") === null, "a section is not a route");
has(featureFor("add a dashboard", []) === null, "a single page goes the edit path, which can hold sections and form data");

console.log("\nWhat the generator is told:");
const brief = featureBrief("BASE RULES", ask("add a dashboard"), "add a dashboard", project);
has(brief.startsWith("BASE RULES"), "every rule of a normal project build still applies");
has(/ADDITION TO AN EXISTING PROJECT — NOT A NEW ONE/.test(brief), "and it is told this is an addition");
has(/Do NOT return any existing file you did not need to change/.test(brief), "what leaving a file out means");
has(/header or nav gets its links/.test(brief), "that the feature is connected to the pages that lead to it");
has(brief.includes("- app/properties/page.tsx") && brief.includes("--- components/Nav.tsx") && brief.includes("--- lib/database.types.ts"),
  "every file is listed, and the header and the database types are shown in full");
has(!brief.includes("--- app/properties/page.tsx"), "but not every file's source");

console.log("\nThe merge never deletes:");
const merged = mergeFeature(project, [
  { path: "app/dashboard/page.tsx", content: "new" },
  { path: "components/Nav.tsx", content: "nav with a dashboard link" },
  { path: "app/page.tsx", content: full },
]);
has(merged.tree.length === project.length + 1, "every existing file is kept and the new one is added");
has(merged.created.join() === "app/dashboard/page.tsx", "created files are told apart");
has(merged.changed.join() === "components/Nav.tsx", "from changed ones — and a file returned unchanged is neither");
has(merged.tree.find((file) => file.path === "components/Nav.tsx").content === "nav with a dashboard link", "a returned file replaces the old one");
has(mergeFeature(project, []).tree.length === project.length, "an empty answer leaves the project exactly as it was");

/* ── Upgrading a single page ──────────────────────────────────────────────
 *
 * A page that is asked for something only an app can hold is offered an
 * upgrade — kept as it is, moved into an app, the feature added — instead of
 * "ask me to rebuild it", which threw the page away. */
console.log("\nA single page is offered an upgrade only for what a page cannot hold:");
has(appFeatureFor("add login and a dashboard")?.areas.join() === "a dashboard,sign-in and accounts", "accounts and a dashboard");
has(appFeatureFor("add a user dashboard")?.areas.join() === "a dashboard", "a dashboard on its own — which reaches no layer in the edit planner");
has(appFeatureFor("add an admin area to manage the menu")?.areas.join() === "an admin area", "an admin");
has(appFeatureFor("add a shopping cart and checkout")?.areas.join() === "a cart and checkout", "a checkout");
has(appFeatureFor("add a booking section") === null, "not bookings — on a page that is a section");
has(appFeatureFor("add a pricing page") === null, "not a named page");
has(appFeatureFor("add a gallery") === null, "not anything else an edit can do");
has(appFeatureFor("add a section with messages from happy customers") === null, "'messages' alone is testimonials, not messaging");
has(appFeatureFor("add direct messages between members")?.areas.includes("messaging"), "while real messaging is");
has(appFeatureFor("make the dashboard image bigger") === null, "not a change to something already there");

const offer = upgradeOffer("a dashboard");
has(/keep your current page exactly as it is/.test(offer) && /Upgrade\?$/.test(offer), "the offer promises to keep the page and asks first");
has(/costs about what a build does/.test(offer), "and says what it costs before anything is spent");

const upgrade = upgradeBrief("BASE RULES", "add a dashboard", ["a dashboard"], '<section><h1>Fresh bread</h1><img src="stashed-image-0" alt="Loaf"></section>');
has(upgrade.startsWith("BASE RULES"), "the upgrade keeps every rule of a project build");
has(/REPRODUCE THE PAGE FAITHFULLY/.test(upgrade) && /word for word/.test(upgrade), "the page is reproduced, copy word for word");
has(/Keep that exact token as the src/.test(upgrade) && upgrade.includes("stashed-image-0"), "and its pictures are kept by their tokens");
has(/Do not invent pages the site did not have/.test(upgrade), "and no pages are invented that the site never had");

console.log("\nA redesign of what is there, rather than an addition:");
const clinic = [
  "app/page.tsx", "app/contact/page.tsx", "app/layout.tsx", "app/tokens.css", "components/Nav.tsx", "components/BookingSection.tsx",
  "components/AppointmentForm.tsx", "components/HeroSection.tsx", "components/Footer.tsx",
].map((path) => ({ path, content: full }));
const redesign = [
  "EDIT EXISTING HEALTHCARE WEBSITE — PREMIUM MODERN REDESIGN",
  "Redesign the existing healthcare landing page. Do not rebuild the project from scratch.",
  "Create an elegant white booking panel against a deep-navy background.",
  "Patients must be able to submit requests without creating an account or logging in.",
  "- Preserve the current framework, routing, API integrations, authentication, and working form handlers.",
].join("\n");
has(restyleFor(redesign, clinic)?.areas.join() === "a redesign of the existing site", "a brief that says edit the existing site is a redesign");
has(featureFor(redesign, clinic) === null, "and not an addition of sign-in or bookings it never asked for");
has(restyleFor("redesign the whole site in navy and mint", clinic) !== null, "a redesign of the whole site is one too");
has(restyleFor("make the header darker", clinic) === null, "an ordinary change is not a redesign");
has(restyleFor("add a dashboard for users", clinic) === null && ask("add a dashboard for users to see their saved properties") !== null, "and adding a dashboard is still a feature");
has(
  featureFor("add a blog for our news. Keep the existing contact form without changes.", project)?.areas.join() === "a blog",
  "a sentence that keeps something does not hide one that asks",
);
has(featureFor("add a pricing page. Patients must be able to book without logging in.", project)?.areas.join() === "a pricing page", "\"without logging in\" is not a request for sign-in");
const restyled = restyleBrief("BASE RULES", redesign, clinic);
has(restyled.startsWith("BASE RULES") && /THIS IS A REDESIGN OF AN EXISTING PROJECT/.test(restyled), "the redesign brief keeps every rule of a project build");
has(/never remove one/.test(restyled) && /never replace them with mock data/.test(restyled), "and keeps every route, form and integration");
has(restyled.includes("--- components/BookingSection.tsx"), "and is shown the files it will change");

console.log(failed === 0 ? `\nAll ${passed} passed.` : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
