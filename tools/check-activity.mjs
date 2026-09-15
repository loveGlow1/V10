#!/usr/bin/env node
/* What the person watching is told is happening.
 *
 *   npm run check:activity
 *
 * The step recorder records what the SERVER did, and it is right to: "Read the
 * message as an edit to the page", "Changing several parts at once — database,
 * authentication, backend", "Stage 2 of 7", "reading app/dashboard/page.tsx…".
 * True, useful when something has gone wrong, and exactly the wrong thing to
 * put in front of somebody who asked for a real-estate platform. Reported from
 * use more than once: the pipeline was narrating itself and the person could
 * not tell whether anything was going well.
 *
 * So the ids stay and the words are mapped. What is checked here is the part
 * that could quietly stop being true:
 *
 *   NOTHING IS INVENTED. Every ✓ traces to a step the pipeline reported. A
 *   checklist that ticks itself off on a timer says a build is doing things
 *   nobody can see it doing, which is worse than saying nothing.
 *
 *   NOTHING HANGS. A step that never runs is dropped, not left at ○ forever.
 *   Not every build has a database, and a row that will never tick reads as
 *   stuck.
 *
 *   NOTHING TECHNICAL SURFACES. No file paths, no model ids, no framework
 *   names in anything a person reads by default.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-activity");
mkdirSync(out, { recursive: true });

execFileSync(
  "npx",
  ["tsc", "src/lib/builder/activity.ts", "src/lib/builder/steps.ts",
   "--outDir", out, "--rootDir", "src", "--module", "esnext", "--target", "es2022",
   "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

const { activityFor, flowFor, headlineFor, phraseFor } =
  await import(join(out, "lib/builder/activity.js"));

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const done = (id, detail) => ({ id, label: `server words for ${id}`, detail, ms: 120, state: "done" });
const running = (id, detail) => ({ id, label: `server words for ${id}`, detail, state: "running" });

const rows = (phases) => phases.flatMap((phase) => phase.items);
const at = (phases, id) => rows(phases).find((item) => item.id === id);

// ── Nothing is invented ───────────────────────────────────────────────────

const early = activityFor([done("open"), running("intent")]);
has(at(early, "open")?.state === "done", "a step that reported done reads as done");
has(at(early, "intent")?.state === "running", "and the one running reads as running");
has(
  rows(early).filter((item) => item.state === "done").length === 1,
  "exactly one thing has finished, because exactly one thing reported finishing",
  `${rows(early).filter((i) => i.state === "done").length} marked done`,
);

/* THE ONE THAT MATTERS MOST. An empty timeline must produce no ✓ at all —
   every row is still to come. A panel that opens with things already ticked is
   the timer-driven checklist this exists to prevent. */
has(
  rows(activityFor([])).every((item) => item.state === "pending"),
  "with nothing reported, nothing is ticked",
);

// ── The words are the person's, not the pipeline's ────────────────────────

has(at(early, "intent")?.label === "Understanding your request",
  "the label is what a person reads, not what the server logged",
  at(early, "intent")?.label);

/* The server's own line survives underneath, for whoever wants it. Carried,
   never shown by default — see the panel. */
has(at(activityFor([done("edit", "claude-sonnet-5 is reading the page…")]), "edit")?.detail
      === "claude-sonnet-5 is reading the page…",
  "the technical line is kept rather than thrown away");

/* Nothing a person reads by default names a file, a framework or a model. */
const VOCABULARY = [
  ...activityFor([], "build"), ...activityFor([], "edit"),
].flatMap((phase) => [phase.heading, ...phase.items.map((item) => item.label)]);

const LEAKS = /\.tsx|\.css|next\.js|react|npm|vercel|supabase|tailwind|claude|sonnet|opus|gpt|gemini|scaffold|page\.tsx|api|schema|token|git|deploy(?:ment)? url|component|route handler/i;
const leaked = VOCABULARY.filter((phrase) => LEAKS.test(phrase));
has(leaked.length === 0, "nothing a person reads names a framework, a file or a model",
  leaked.join(" | "));

// ── Nothing hangs ─────────────────────────────────────────────────────────
/* Not every build has a database. Once something after it has finished, the
   row is dropped rather than left at ○ forever. */

const noDatabase = activityFor([done("design"), done("plan"), running("edit")]);
has(at(noDatabase, "database") === undefined,
  "a step this build never had is dropped once the turn is past it");
has(at(noDatabase, "design")?.state === "done", "and the ones it did have are still there");

/* But ahead of the current point it is still to come, which is the difference
   between "skipped" and "not yet". */
const early2 = activityFor([running("open")]);
has(at(early2, "database")?.state === "pending",
  "before the turn reaches it, the same step is still to come");

/* Read-ahead: the phases after the current one are listed, so the sequence can
   be read rather than merely watched scroll past. */
has(
  activityFor([running("intent")]).length >= 3,
  "the phases still to come are shown, not just the one running",
);

// ── An edit is not a build ────────────────────────────────────────────────
/* "Building your project" over a change is how somebody comes to believe their
   work was thrown away and rewritten. */

const edit = activityFor([done("open"), done("file"), running("edit")], "edit");
has(edit[0].heading === "Updating your project",
  "a change says it is updating, not building", edit[0].heading);
has(at(edit, "file")?.label === "Locating the relevant section",
  "and names finding the place rather than the file", at(edit, "file")?.label);
has(
  !activityFor([], "edit").some((phase) => /building your project/i.test(phase.heading)),
  "nothing in the edit sequence claims to be building the project",
);

// ── One line, when there is no room for a list ────────────────────────────

has(headlineFor([running("intent")]) === "Initializing",
  "the headline is the phase that is running", headlineFor([running("intent")]));
has(headlineFor([done("open"), done("version")]) === "Finalizing",
  "and the last one finished when nothing is",
  headlineFor([done("open"), done("version")]));
has(headlineFor([]) === "Getting started", "and it always says something");

// ── A turn that is its own thing ──────────────────────────────────────────
/* A question answered or a download prepared is a whole turn, not a stage of a
   build, so it is not wedged into a sequence it is not part of. */
const asked = activityFor([done("open"), done("answer")]);
has(at(asked, "answer")?.label === "Looking through your project for the answer",
  "a question gets its own words", at(asked, "answer")?.label);

// ── The phrase, on its own ────────────────────────────────────────────────
has(phraseFor("deploy") === "Putting it online", "a single step can be phrased alone");
has(phraseFor("deploy", "edit") === "Publishing the change",
  "and says the right thing for the flow it is in");
has(phraseFor("nonsense") === null, "an id with no phrase says so rather than inventing one");

// ── Which sequence a stored timeline followed ─────────────────────────────
/* Derived rather than passed: a message reopened next week has its steps and no
   memory of the intent that produced them, and a prop the caller had to guess
   would be a second source of truth sitting next to the evidence. */

has(flowFor([done("open"), done("kind"), done("design")]) === "build",
  "a turn that decided what to build was a build");
has(flowFor([done("open"), done("file"), done("edit")]) === "edit",
  "a turn that went looking for the place to change was an edit");
has(flowFor([done("open"), done("plan"), done("edit"), done("check")]) === "edit",
  "and so was one that patched a page without picking a file");
has(flowFor([]) === "build", "with no evidence either way it reads as a build");

/* THE ONE THAT WOULD BE WRONG THE OTHER WAY. A build also reports `edit` — a
   staged build's later stages are edits — so `edit` alone must not outvote the
   evidence that something was being decided. */
has(flowFor([done("kind"), done("design"), done("edit"), done("check")]) === "build",
  "a staged build that applied its stage as an edit is still a build");

// ── And the panel reads from it ───────────────────────────────────────────
/* The translation is only worth having if the thing on screen uses it. Read
   from source: the component cannot be rendered here without a DOM, and what
   would regress is the wiring rather than the rules above. */
const { readFileSync } = await import("node:fs");
const panel = readFileSync(
  join(process.cwd(), "src/app/dashboard/components/workspace/BuildActivity.tsx"),
  "utf8",
);

has(/activityFor\(steps, flow \?\? flowFor\(steps\)\)/.test(panel),
  "the panel groups the steps into phases rather than listing them flat");
has(/\{phase\.heading\}/.test(panel), "and shows the heading above each one");
has(/headlineFor\(steps/.test(panel),
  "the folded line names the phase that is running");
/* Comments stripped: the file now carries a note explaining what the old line
   said and why it is gone, and a check that cannot tell a tombstone from the
   thing it marks would fail on the very comment recording the fix. */
const panelCode = panel.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
has(!/\{running \? "Working on it…"/.test(panelCode),
  "rather than describing the wait",
  "\"Working on it…\" for a forty-second build is the wait, not the work");

console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
