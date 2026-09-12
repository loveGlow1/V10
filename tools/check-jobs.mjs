#!/usr/bin/env node
/* The build state machine, and the rules that make it one.
 *
 *   npm run check:jobs
 *
 * `projects.status` held this before: one free-text column, no CHECK
 * constraint, five writers, and six values describing three different kinds of
 * thing. Nothing could say whether a transition made sense because there was
 * nothing to compare it against, and the two failures that came out of that are
 * the same failure twice.
 *
 * A function killed mid-flight wrote nothing, so the row stayed "Building" and
 * the workspace polled it for twenty-five minutes. And n8n's Save Page node
 * gave up at 120 seconds and wrote "Failed" while the save route was still
 * storing the page, which then wrote "Built" — so the truth depended on which
 * writer finished last, and the shipped mitigation was a twenty-second grace
 * period in the browser.
 *
 * The assertions below are those two cases stated as properties, plus the ones
 * that stop the machine from being a different shape than the database. Offline
 * and free: no database, no network, no key.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-jobs");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      target: "es2022",
      module: "es2022",
      moduleResolution: "bundler",
      outDir: out,
      rootDir: join(process.cwd(), "src"),
      baseUrl: join(process.cwd(), "src"),
      paths: { "@/*": ["*"] },
      skipLibCheck: true,
      strict: false,
    },
    files: [join(process.cwd(), "src/lib/jobs/state.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });

const state = await import(join(out, "lib/jobs/state.js"));

let failed = 0;
let passed = 0;
const ok = (t) => { passed += 1; console.log(`ok    ${t}`); };
const fail = (t, d) => { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const { JOB_STATES, TERMINAL, canTransition, canRetry, isTerminal, nextStates, MAX_ATTEMPTS } = state;

console.log("\nTerminal means terminal:");

for (const terminal of TERMINAL) {
  has(
    nextStates(terminal).length === 0,
    `nothing follows "${terminal}"`,
    "a finished build that can be moved again is the Failed-then-Built race",
  );
}

/* THE ONE. n8n writes Failed at its own timeout; the save route writes Built a
   few seconds later. Both used to land. */
has(
  !canTransition("failed", "ready"),
  "a build that failed cannot later be called ready",
  "this is the race the browser's 20-second grace period was papering over",
);
has(
  !canTransition("ready", "failed"),
  "and one that is ready cannot later be called failed",
);

console.log("\nEvery live state has a way out:");

for (const s of JOB_STATES) {
  if (isTerminal(s)) continue;
  const next = nextStates(s);
  has(
    next.includes("failed") || s === "needs_input",
    `"${s}" can fail`,
    "a state with no exit is a build that hangs, which is what this replaces",
  );
  has(next.includes("cancelled"), `"${s}" can be cancelled`);
}

console.log("\nThe shape of the work:");

has(
  canTransition("planning", "generating"),
  "a project with nothing to provision skips provisioning",
  "a landing page has no database; inventing an empty stage to keep the sequence tidy is worse",
);
has(
  canTransition("repairing", "validating"),
  "a repair goes back to be re-checked",
  "a repair that cannot be re-checked is a repair nobody can trust",
);
has(
  canTransition("validating", "ready") && canTransition("assembling", "ready"),
  "a single-page build reaches ready without deploying",
);
has(
  canTransition("needs_input", "planning"),
  "answering a question resumes the build",
);
has(
  !canTransition("needs_input", "generating"),
  "but not into a stage that has already run",
  "the answer travels with the request and planning reads it — see body.architecture",
);
has(
  canTransition("queued", "queued") && canTransition("deploying", "deploying"),
  "re-entering the state it is already in is a no-op, not an error",
  "a re-claimed job and a webhook delivered twice must both be harmless",
);

console.log("\nRetries, where a second attempt is a different attempt:");

has(canRetry("generating", 0), "generation retries — it is somebody else's API over a network");
has(canRetry("deploying", 1), "so does deployment");
has(canRetry("provisioning", 0), "so does provisioning — it opens a database connection");
has(
  !canRetry("validating", 0) && !canRetry("assembling", 0),
  "the deterministic stages do not",
  "re-running the gates over a stored document reaches the same answer a minute later; what that needs is repairing",
);
has(!canRetry("generating", MAX_ATTEMPTS), `and nothing retries past ${MAX_ATTEMPTS}`);

console.log("\nThe machine and the database agree:");

const sql = readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8");
const constraint = sql.slice(sql.indexOf("create table if not exists public.build_jobs"));
const declared = [...constraint.slice(0, constraint.indexOf(")),")).matchAll(/'([a-z_]+)'/g)].map(
  (m) => m[1],
);

for (const s of JOB_STATES) {
  has(
    declared.includes(s),
    `"${s}" is in the CHECK constraint`,
    "a state the code can set and the database refuses is a write that fails in production",
  );
}
has(
  declared.every((s) => JOB_STATES.includes(s)),
  "and the constraint admits nothing the code does not know",
  `constraint has: ${declared.join(", ")}`,
);

/* The index that stops two generations racing to write the same project. */
has(
  /build_jobs_one_live_per_project[\s\S]*?where state not in \('ready', 'failed', 'cancelled'\)/.test(sql),
  "one live job per project, enforced by an index rather than by a read",
  "checking first and then inserting is two answers to one question with a gap between them",
);

has(
  /create policy "Owners read their build jobs"[\s\S]*?for select/.test(sql) &&
    !/create policy[^;]*on public\.build_jobs for (insert|update|delete)/.test(sql),
  "a browser can read a job and cannot write one",
  "a client that could move a job's state could mark its own build ready",
);

console.log(failed ? `\n${failed} failed.` : `\nAll ${passed} passed.`);
process.exit(failed ? 1 : 0);
