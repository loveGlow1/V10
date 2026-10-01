#!/usr/bin/env node
/* Ready-made databases for the kinds of website people build.
 *
 *   npm run check:presets
 *
 * presets.ts hands a project a schema chosen from its brief before any model
 * is asked. These run against somebody's real database, so each one is held
 * to the same validator a model-designed schema must pass, and the matching —
 * which decides whose tables a project gets — is pinned on real briefs,
 * including the ones that must NOT match.
 *
 * When this was written every preset's toSql output was also run twice in a
 * Postgres 16 with Supabase's roles: all installed cleanly, every table had
 * RLS, and an anonymous visitor could read published listings, submit an
 * enquiry, and read neither enquiries nor anybody's favourites. CI has no
 * database, so that is not repeated here.
 *
 * Offline. No model, no network, no key.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-presets");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, strict: true, types: ["node"],
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [join(process.cwd(), "src/lib/builder/presets.ts"), join(process.cwd(), "src/lib/builder/app-schema.ts"), join(process.cwd(), "src/lib/builder/member-area.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

const { PRESETS, presetFor, modulesFor } = await import(join(out, "lib/builder/presets.js"));
const { memberAreaFor } = await import(join(out, "lib/builder/member-area.js"));
const { readProposal } = await import(join(out, "lib/builder/app-schema.js"));

let failed = 0;
let passed = 0;
const has = (cond, t, d) => {
  if (cond) { passed += 1; console.log(`ok    ${t}`); }
  else { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
};

console.log("\nEvery preset is a schema the platform would accept from anybody:");
for (const preset of PRESETS) {
  const tables = preset.tables();
  const verdict = readProposal({ tables, why: preset.label });
  has(verdict.ok, `${preset.id} — ${tables.length} tables`, verdict.reason);
}

console.log("\nAnd every table in it is protected:");
for (const preset of PRESETS) {
  for (const table of preset.tables()) {
    const owned = table.columns.some((column) => column.name === "user_id");
    const readsOwnOnly = table.policies.some((policy) => policy.for === "select" && /user_id = auth\.uid\(\)/.test(policy.using ?? ""));
    const publicRead = table.policies.some((policy) => policy.for === "select" && policy.to.includes("anon"));
    /* A person's own rows are never readable by everybody — the one mistake
       that would publish people's bookings and favourites. Reviews and forum
       posts are public on purpose and say so with an approval or nothing. */
    const meantPublic = ["reviews", "threads", "replies"].includes(table.name);
    if (owned && !meantPublic) {
      has(readsOwnOnly && !publicRead, `${preset.id}.${table.name}: a person's rows are theirs`);
    }
    has(table.policies.some((policy) => /is_admin\(\)/.test(`${policy.using ?? ""} ${policy.check ?? ""}`)), `${preset.id}.${table.name}: the owner can manage it`);
  }
}

console.log("\nWhich site gets which database:");
for (const [brief, kind, want] of [
  ["BUILD A PREMIUM REAL ESTATE PLATFORM for Aurelia Estates", "webapp", "real-estate"],
  ["Aurelia Estates\nAdd a user dashboard", "webapp", "real-estate"],
  ["a boutique hotel with room booking", "webapp", "hospitality"],
  ["a yoga studio with class schedule and member bookings", "webapp", "fitness"],
  ["website for my hair salon where clients book appointments", "landing", "appointments"],
  ["an Italian restaurant with table reservations and our menu", "landing", "restaurant"],
  ["online courses platform with lessons and progress", "webapp", "courses"],
  ["a job board for remote developers", "webapp", "jobs"],
  ["a CRM for tracking leads and deals", "webapp", "crm"],
  ["a kanban project management tool", "webapp", "projects"],
  ["a charity site taking donations", "landing", "nonprofit"],
  ["a used cars dealership site", "webapp", "directory"],
  ["a safari tour operator in Kenya", "landing", "tours"],
  ["a tech conference with ticket sales", "webapp", "events"],
  ["a community forum for gardeners", "webapp", "community"],
  ["a landing page for my consulting agency", "landing", "business"],
  ["an estate planning lawyer", "landing", "appointments"],
  ["a helpdesk with support tickets", "webapp", null],
  ["an AI invoice generator", "webapp", null],
  ["an online store for shoes", "ecommerce", null],
  ["a food blog", "blog", null],
  ["of course it needs a nav bar and a search bar", "landing", "business"],
]) {
  const got = presetFor(brief, kind)?.id ?? null;
  has(got === want, `${String(want).padEnd(12)} ← ${brief.replace(/\n/g, " / ")}`, `got ${got}`);
}

console.log("\nOnly the modules the brief asks for — never more:");
const tablesOf = (brief, kind) => {
  const preset = presetFor(brief, kind);
  return preset ? modulesFor(preset, brief).tables.map((table) => table.name) : [];
};
const same = (got, want) => JSON.stringify([...got].sort()) === JSON.stringify([...want].sort());
for (const [brief, kind, want] of [
  ["a real estate site listing our properties with agents", "webapp", ["agents", "properties", "property_images"]],
  ["a real estate site with a contact form", "webapp", ["agents", "properties", "property_images", "contact_inquiries"]],
  ["a real estate site with login and a customer dashboard", "webapp",
    ["agents", "properties", "property_images", "favorites", "saved_searches", "recently_viewed", "viewing_requests"]],
  ["a real estate platform with login and a customer dashboard", "webapp",
    ["agents", "locations", "properties", "property_images", "favorites", "saved_searches", "recently_viewed", "viewing_requests", "contact_inquiries"]],
  ["real estate listings grouped by neighbourhood, where people can save favourites", "webapp",
    ["agents", "properties", "property_images", "locations", "favorites"]],
  ["a landing page for my consulting agency with a contact form", "landing", ["contact_inquiries"]],
  ["a launch page for my app with a waitlist", "landing", ["waitlist_signups"]],
  ["a landing page with a newsletter signup", "landing", ["newsletter_subscribers"]],
  ["a landing page that stores something", "landing", ["contact_inquiries"]],
  ["a job board for remote developers", "webapp", ["companies", "jobs", "job_applications"]],
]) {
  const got = tablesOf(brief, kind);
  has(same(got, want), `${brief}`, `got ${got.join(", ")}`);
}

/* A link to a module that was left out goes with it, index and all. */
{
  const preset = PRESETS.find((entry) => entry.id === "real-estate");
  const properties = modulesFor(preset, "real estate listings").tables.find((table) => table.name === "properties");
  has(!properties.columns.some((column) => column.name === "location_id"), "properties has no location_id when there are no locations");
  const withLocations = modulesFor(preset, "real estate listings by neighbourhood").tables.find((table) => table.name === "properties");
  has(withLocations.columns.some((column) => column.name === "location_id"), "…and has it when there are");
  /* Every reference in every selection points at a table that is there. */
  for (const brief of ["real estate", "real estate with dashboard", "a full featured real estate platform"]) {
    const { tables } = modulesFor(preset, brief);
    const names = new Set(tables.map((table) => table.name));
    const dangling = tables.flatMap((table) => table.columns.filter((column) => column.references && !column.references.table.includes(".") && !names.has(column.references.table)).map((column) => `${table.name}.${column.name}`));
    has(dangling.length === 0, `no dangling references: ${brief}`, dangling.join(", "));
    const verdict = readProposal({ tables, why: brief });
    has(verdict.ok, `selection is a valid schema: ${brief}`, verdict.reason);
  }
}

console.log("\nPersonal modules make the customer dashboard, even unnamed:");
{
  const area = memberAreaFor("real estate site where people save homes and book viewings", { authentication: true }, "webapp", ["favorites", "viewing_requests"]);
  has(area && area.sections.some((s) => s.slug === "saved") && area.sections.some((s) => s.slug === "bookings" || s.slug === "viewings"), "saved homes and viewings → Saved and Viewings", JSON.stringify(area?.sections.map((s) => s.slug)));
  has(area && !(area.sections.some((s) => s.slug === "bookings") && area.sections.some((s) => s.slug === "viewings")), "viewings appear once");
  has(memberAreaFor("a real estate site", { authentication: true }, "webapp", []) === null, "no personal modules, no dashboard");
  has(memberAreaFor("a real estate site", { authentication: false }, "webapp", ["favorites"]) === null, "no accounts, no dashboard");
}

console.log(failed === 0 ? `\nAll ${passed} passed.` : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
