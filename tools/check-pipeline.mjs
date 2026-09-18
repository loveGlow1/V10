#!/usr/bin/env node
/* Does the code still run the pipeline it says it runs?
 *
 *   npm run check:pipeline
 *
 *   user prompt → understand product → decide capabilities →
 *   provision only what is needed → generate → inspect → repair → deploy
 *
 * Every stage existed in this codebase before this file did. What did not exist
 * was anything that could tell whether a stage was still WIRED, and three of
 * them were not — each invisible in the same way, because an unreachable state
 * reads exactly like a covered one:
 *
 *   `provisioning` — the job was opened after the migration ran, so no build
 *   was ever in it.
 *
 *   `validating` and `repairing` — the save route went assembling → ready, so
 *   no build was ever in either, while QA ran twenty lines above and put its
 *   verdict in a chat message.
 *
 * And the order was wrong in one place: autofix repaired the document and THEN
 * the gates looked at it, so whatever the gates found was never repaired.
 *
 * These are source assertions. They are coarser than executing the pipeline and
 * they catch the thing that actually goes wrong: a stage quietly stopping being
 * called, which no type checker and no unit test can see.
 *
 * Offline. No database, no network, no key.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-pipeline");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, strict: true,
      paths: { "@/*": [join(process.cwd(), "src", "*")] },
    },
    files: [
      join(process.cwd(), "src/lib/builder/pipeline.ts"),
      join(process.cwd(), "src/lib/jobs/state.ts"),
    ],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });

const { PAUSED, PIPELINE, STAGES, describePipeline, pipelineStates, stageFor } =
  await import(join(out, "lib/builder/pipeline.js"));
const { JOB_STATES, TERMINAL, canTransition } = await import(join(out, "lib/jobs/state.js"));

let failed = 0;
let passed = 0;
const ok = (t, d) => { passed += 1; console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`); };
const fail = (t, d) => { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const buildRoute = readFileSync(join(process.cwd(), "src/app/api/build/route.ts"), "utf8");
const saveRoute = readFileSync(join(process.cwd(), "src/app/api/builder/webapp/save/route.ts"), "utf8");
const worker = readFileSync(join(process.cwd(), "src/app/api/cron/deployments/route.ts"), "utf8");
const everywhere = `${buildRoute}\n${saveRoute}\n${worker}`;

console.log(`\n${describePipeline()}\n`);

// ── Every stage has an owner that exists ─────────────────────────────────
console.log("Each stage is owned by a module that is really there:");

for (const spec of PIPELINE) {
  const missing = spec.owners.filter((path) => !existsSync(join(process.cwd(), "src", path)));
  has(
    missing.length === 0,
    `${spec.stage} — ${spec.owners.length} owner${spec.owners.length === 1 ? "" : "s"}`,
    missing.length ? `missing: ${missing.join(", ")}` : undefined,
  );
}

// ── THE ONE. Every state the machine defines must be reachable ───────────
console.log("\nEvery state the machine can be in, the code can reach:");

for (const state of JOB_STATES) {
  if (TERMINAL.includes(state) || state === "queued") continue;
  /* `to: "state"` is how every transition is written — see advance() in
     jobs/store.ts, which is the only door. A state nothing passes to it is a
     state no build can be in, however carefully the machine defines it. */
  const wired = new RegExp(`to:\\s*"${state}"`).test(everywhere);
  has(
    wired,
    `"${state}" is entered somewhere`,
    "defined in the state machine and reached by nothing — an unreachable state reads as coverage",
  );
}

// ── The order the architecture turns on ──────────────────────────────────
console.log("\nThe order, where getting it wrong is the defect:");

has(
  buildRoute.indexOf("decideArchitecture(") < buildRoute.indexOf("await provision("),
  "capabilities are decided before anything is provisioned",
  "provisioning first would mean creating tables and then deciding whether the project has any",
);

has(
  buildRoute.indexOf('to: "provisioning"') < buildRoute.indexOf('to: "generating"'),
  "and the schema exists before the code that queries it is written",
  "a prompt written against tables that do not exist is the fake back end this replaced",
);

has(
  saveRoute.indexOf('to: "validating"') < saveRoute.indexOf('to: "repairing"'),
  "inspection comes before repair",
  "autofix used to run BEFORE the gates, so whatever they found was never repaired",
);

has(
  /runQaLoop\(/.test(saveRoute),
  "and the repair loop is the one that re-checks its own work",
  "runQaLoop had no production caller; a repair nobody re-inspects is a repair nobody can trust",
);

has(
  /html = inspection\.html/.test(saveRoute),
  "the repaired document is the one that gets stored",
  "a loop whose output is discarded is an expensive way to produce a report",
);

// ── Provision only what is NEEDED ────────────────────────────────────────
console.log("\nProvision only what is needed:");

/* The GUARD is what this is about, not which function is behind it. It named
   resolveBackend while that was the only way in; the build path now calls
   ensureBackendFor, which resolves and — for a heavy backend that has said
   nothing — gives the project a database of its own. Either way the question
   is only ever asked when the manifest says there is a database layer, which
   is the thing worth holding: resolving one would name a schema and open a
   connection for a project that has neither, and ensureBackendFor would go
   further and create a Supabase project for it. */
has(
  /architecture\.manifest\.database\s*\r?\n?\s*\?\s*await (?:resolveBackend|ensureBackendFor)/.test(
    buildRoute,
  ),
  "no backend is resolved for a project with no database layer",
  "resolving one would name a schema and open a connection for a project that has neither",
);

/* And the split that decides how much of one. A heavy backend on the shared
   instance is accounts in a pool shared with every other app on it. */
has(
  /weightOf\(architecture\.manifest\)/.test(buildRoute),
  "and how much backend is read from the layers, not from the brief a second time",
  "a second reading of the same words is a second answer to disagree with the first",
);

has(
  /dataModel\.tables\.length > 0/.test(buildRoute),
  "and no migration runs when the model has no tables",
);

const provisionSpec = PIPELINE.find((spec) => spec.stage === "provision");
has(
  typeof provisionSpec.skippedWhen === "string" && /database/.test(provisionSpec.skippedWhen),
  "the stage says out loud when it is skipped",
  "a skip that is not written down is indistinguishable from a stage that broke",
);

// ── The mapping holds together ───────────────────────────────────────────
console.log("\nThe description and the machine agree:");

has(
  PIPELINE.every((spec) => JOB_STATES.includes(spec.state)),
  "every stage names a state the machine has",
  PIPELINE.filter((spec) => !JOB_STATES.includes(spec.state)).map((s) => s.stage).join(", "),
);

has(
  PIPELINE.map((spec) => spec.stage).join() === STAGES.join(),
  "the stages are listed in the declared order",
);

/* Each state must be able to follow the one before it. This is the assertion
   that caught `assembling` belonging to no stage: the pipeline claimed
   generating → validating and the machine had no such transition, because the
   code goes through assembling and the description had skipped it. */
const chain = pipelineStates();
const broken = chain.filter(
  (state, at) => at > 0 && chain[at - 1] !== state && !canTransition(chain[at - 1], state),
);
has(
  broken.length === 0,
  "and each state can actually follow the one before it",
  `${chain.join(" → ")}${broken.length ? `  (cannot reach: ${broken.join(", ")})` : ""}`,
);

/* The pause is reachable too, and resumes into the deciding stage rather than
   into one that has already run. */
has(
  canTransition("queued", PAUSED) && canTransition(PAUSED, "planning"),
  "a build can pause for an answer and resume from it",
);
has(
  !canTransition(PAUSED, "generating"),
  "but not resume into a stage that has already run",
  "the answer travels with the request and planning reads it — see body.architecture",
);

has(stageFor("deploying") === "deploy", "a state maps back to its stage");
has(stageFor("ready") === null, "and a terminal state maps to no stage, rather than to the last one");

console.log(failed ? `\n${failed} failed.` : `\nAll ${passed} passed.`);
process.exit(failed ? 1 : 0);
