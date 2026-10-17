#!/usr/bin/env node
/* The review round: after a build, one free edit that fixes what its review
 * found — written by the server from the build's own findings, once.
 *
 *   npm run check:review-round
 *
 * Offline. review-round.ts is run against a fake service client; the build
 * route and the workspace are read as source and held to their guardrails.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-review-round");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  compilerOptions: {
    outDir: ".", rootDir: join(root, "src"), module: "esnext", target: "es2022", moduleResolution: "bundler",
    skipLibCheck: true, strict: true, types: ["node"], typeRoots: [join(root, "node_modules", "@types")],
    baseUrl: root, paths: { "@/*": ["src/*"] },
  },
  files: [join(root, "src/lib/builder/review-round.ts")],
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
const R = await import(join(out, "lib/builder/review-round.js"));

let failed = 0;
const has = (cond, t, d) => {
  if (cond) console.log(`ok    ${t}`);
  else { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${JSON.stringify(d)}` : ""}`); }
};

/* A fake service client: one build row, and a thread whose dedupe index works. */
function fake(build, { claimed = false } = {}) {
  const keys = new Set(claimed ? [`review:${build?.id}`] : []);
  const chain = (table) => {
    const q = {
      select: () => q, eq: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: table === "project_builds" ? build : null, error: null }),
      then: (resolve) => resolve({ count: keys.size, error: null }),
      insert: async (row) => {
        if (keys.has(row.dedupe_key)) return { error: { code: "23505" } };
        keys.add(row.dedupe_key);
        return { error: null };
      },
    };
    return q;
  };
  return { from: chain };
}

const now = Date.parse("2026-10-17T12:00:00Z");
const fresh = { id: "b1", prompt: "build me a gym site", created_at: "2026-10-17T11:50:00Z", qa_issues: [
  { rule: "responsive", message: "The pricing grid overflows on a phone", viewport: "phone" },
  { rule: "responsive", message: "The pricing grid overflows on a phone", viewport: "phone" },
  { rule: "functional", message: "The /login route the nav links to does not exist" },
] };
const input = { projectId: "p1", userId: "u1", buildId: "latest" };

const ok = await R.reviewEligibility(fake(fresh), input, now);
has(ok.ok && ok.findings === 2, "a fresh build with findings gets one round, duplicates merged", ok);
has(ok.ok && ok.prompt.startsWith("[review:b1]") && /pricing grid/.test(ok.prompt) && /\/login/.test(ok.prompt), "the prompt is the build's own findings, marked with its id");
has(ok.ok && /Do not change anything else/.test(ok.prompt), "and asks for nothing beyond them");

const db = fake(fresh);
await R.reviewEligibility(db, input, now);
const again = await R.reviewEligibility(db, input, now);
has(!again.ok, "a second round for the same build is refused", again);
has(!(await R.reviewEligibility(fake(fresh, { claimed: true }), input, now)).ok, "even when the first round never landed");

has(!(await R.reviewEligibility(fake({ ...fresh, qa_issues: [] }), input, now)).ok, "a clean build gets no round");
has(!(await R.reviewEligibility(fake({ ...fresh, prompt: R.reviewPrompt("b0", fresh.qa_issues) }), input, now)).ok, "a round's own build is never reviewed again");
has(!(await R.reviewEligibility(fake({ ...fresh, created_at: "2026-10-17T09:00:00Z" }), input, now)).ok, "an old build is not reviewed");
has(!(await R.reviewEligibility(fake(fresh), { ...input, buildId: "b0" }, now)).ok, "only the newest build");
has(!(await R.reviewEligibility(fake(null), input, now)).ok, "no build, no round");

const lots = Array.from({ length: 20 }, (_, i) => ({ rule: "r", message: `problem ${i}` }));
has(R.reviewPrompt("b1", lots).split("\n").filter((l) => l.startsWith("- ")).length === R.MAX_FINDINGS, `at most ${R.MAX_FINDINGS} findings in a round`);

const route = readFileSync(join(root, "src/app/api/build/route.ts"), "utf8");
has(/prompt = due\.prompt;/.test(route), "the build route takes the prompt from the build row, not the browser");
has(!/await chargeCredits\(service,/.test(route.slice(route.indexOf("const bill: typeof chargeCredits"))), "every charge after it goes through bill, so the round is never billed");
has(/!freeReview && !canAfford/.test(route), "and an empty balance does not stop the round");
const panel = readFileSync(join(root, "src/app/dashboard/components/workspace/ChatPanel.tsx"), "utf8");
has(/reviewNext\.current && !options\.review/.test(panel), "the workspace starts a round after a build, never after a round");

rmSync(out, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed.` : "\nAll review round checks passed.");
process.exit(failed ? 1 : 0);
