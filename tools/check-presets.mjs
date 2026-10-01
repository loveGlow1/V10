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
    files: [join(process.cwd(), "src/lib/builder/presets.ts"), join(process.cwd(), "src/lib/builder/app-schema.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

const { PRESETS, presetFor } = await import(join(out, "lib/builder/presets.js"));
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

console.log(failed === 0 ? `\nAll ${passed} passed.` : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
