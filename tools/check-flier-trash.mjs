#!/usr/bin/env node
/* Recently deleted fliers: hidden at once, restorable for 15 days, then
 * gone for good — files and rows.
 *
 *   npm run check:flier-trash
 *
 * Offline. trash.ts runs against a fake client; the routes are read as source.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-flier-trash");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  compilerOptions: {
    outDir: ".", rootDir: join(root, "src"), module: "esnext", target: "es2022", moduleResolution: "bundler",
    skipLibCheck: true, strict: true, types: ["node"], typeRoots: [join(root, "node_modules", "@types")],
    baseUrl: root, paths: { "@/*": ["src/*"] },
  },
  files: [join(root, "src/lib/flyers/trash.ts")],
}));
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
(function fix(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { fix(path); continue; }
    if (!entry.endsWith(".js")) continue;
    writeFileSync(path, readFileSync(path, "utf8")
      .replace(/(from\s+["'])@\/([^"']+)(["'])/g, (_, a, spec, b) => {
        let rel = relative(dirname(path), join(out, spec)).replace(/\\/g, "/");
        if (!rel.startsWith(".")) rel = `./${rel}`;
        return `${a}${rel}${b}`;
      })
      .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (whole, a, spec, b) => (spec.endsWith(".js") ? whole : `${a}${spec}.js${b}`)));
  }
})(join(out, "lib"));
const R = await import(join(out, "lib/flyers/trash.js"));

let failed = 0;
const has = (cond, t, d) => {
  if (cond) console.log(`ok    ${t}`);
  else { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${JSON.stringify(d)}` : ""}`); }
};
const DAY = 86400000;
const now = Date.parse("2026-10-17T12:00:00Z");

has(R.TRASH_DAYS === 15, "kept for 15 days");
has(R.daysLeft(new Date(now).toISOString(), now) === 15 && R.daysLeft(new Date(now - 14.5 * DAY).toISOString(), now) === 1, "days left counts down to the day");
has(!R.purgeDue(new Date(now - 14 * DAY).toISOString(), now) && R.purgeDue(new Date(now - 15 * DAY).toISOString(), now), "due at 15 days, not before");
has(!R.purgeDue(null, now), "nothing undeleted is ever due");

const outputs = [{ provider: "p", stage: "preview", path: "u/j/a.png" }, { provider: "p", stage: "preview", path: "u/j/b.png" }];
const marked = R.markOutput(outputs, "u/j/a.png", true, "2026-10-17T00:00:00Z");
has(marked[0].trashed && marked[0].deleted_at && !marked[1].trashed, "one image is marked, the others untouched");
has(R.liveOutputs(marked).length === 1 && R.liveOutputs(marked)[0].path === "u/j/b.png", "a deleted image stops showing");
const back = R.markOutput(marked, "u/j/a.png", false);
has(!("trashed" in back[0]) && !("deleted_at" in back[0]), "restoring takes the mark off completely");

/* The purge, against a fake client that records what it removes. */
const removed = [], deletedRows = [], updates = [];
const jobs = {
  old: { id: "old", outputs: outputs, deleted_at: new Date(now - 16 * DAY).toISOString() },
  kept: { id: "kept", outputs: [{ ...outputs[0], trashed: true, deleted_at: new Date(now - 20 * DAY).toISOString() }, { ...outputs[1], path: "u/k/c.png", trashed: true, deleted_at: new Date(now - 2 * DAY).toISOString() }, { ...outputs[1], path: "u/k/d.png" }], deleted_at: null },
};
let call = 0;
const fake = {
  storage: { from: () => ({ remove: async (paths) => { removed.push(...paths); return { error: null }; } }) },
  from: () => {
    const q = {
      select: () => q, not: () => q, lte: () => q, is: () => q, contains: () => q, eq: () => q,
      limit: async () => ({ data: call++ === 0 ? [jobs.old] : [jobs.kept], error: null }),
      delete: () => ({ in: async (_c, ids) => { deletedRows.push(...ids); return { error: null }; } }),
      update: (row) => ({ eq: async (_c, id) => { updates.push([id, row]); return { error: null }; } }),
    };
    return q;
  },
};
const result = await R.purgeFlyerTrash(fake, now);
has(deletedRows.includes("old") && removed.includes("u/j/a.png") && removed.includes("u/j/b.png"), "a flier past 15 days: its files and its row are removed");
has(removed.filter((p) => p === "u/j/a.png").length === 2 && !removed.includes("u/k/c.png") && !removed.includes("u/k/d.png"), "an image past 15 days is removed; a recent one and a kept one are not");
const kept = updates.find(([id]) => id === "kept")?.[1]?.outputs ?? [];
has(kept.length === 2 && kept.every((o) => o.path !== "u/j/a.png"), "and the flier keeps its other images");
has(result.fliers === 1 && result.images === 1, "the purge reports what it removed", result);

const one = readFileSync(join(root, "src/app/api/flyers/[id]/route.ts"), "utf8");
const list = readFileSync(join(root, "src/app/api/flyers/route.ts"), "utf8");
const cron = readFileSync(join(root, "src/app/api/cron/flyer-trash/route.ts"), "utf8");
const vercel = readFileSync(join(root, "vercel.json"), "utf8");
const studio = readFileSync(join(root, "src/app/dashboard/fliers/[id]/page.tsx"), "utf8");
const gallery = readFileSync(join(root, "src/app/dashboard/fliers/page.tsx"), "utf8");
has(/export async function DELETE/.test(one) && /export async function PATCH/.test(one), "a flier or one image can be deleted and restored");
has(/async function owned[\s\S]{0,700}supabase\.from\('flyer_jobs'\)\.select\('id, outputs, deleted_at'\)\.eq\('id', id\)/.test(one), "only after the caller's own session has proved it is theirs");
has(/if \(job\.deleted_at\) return NextResponse\.json/.test(one) && /liveOutputs\(outputs\)/.test(one), "a deleted flier or image no longer opens");
has(/\.is\('deleted_at', null\)/.test(list) && /trash'\) === '1'/.test(list), "Your fliers hides deleted ones; Recently deleted lists them");
has(/CRON_SECRET/.test(cron) && /purgeFlyerTrash/.test(cron) && /\/api\/cron\/flyer-trash/.test(vercel), "the daily purge is scheduled and gated");
has(/Delete this version/.test(studio) && /Delete this flier/.test(studio), "the studio can delete a version or the whole flier");
has(/Recently deleted/.test(gallery) && /forever=1/.test(gallery) && /restore: true/.test(gallery), "Recently deleted can restore or delete now");

rmSync(out, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed.` : "\nAll flier trash checks passed.");
process.exit(failed ? 1 : 0);
