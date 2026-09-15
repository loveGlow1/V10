#!/usr/bin/env node
/* What the composer's buttons promise, and whether they still do it.
 *
 *   npm run check:composer
 *
 * Source assertions rather than a rendering test, which is coarser than it
 * could be but catches the thing worth catching: a label that stops matching
 * its action. That is not hypothetical here, and it has now gone wrong twice
 * in the same chip.
 *
 * First "New project" was a MODE that armed a replacement — press it, describe
 * the second thing you wanted, and the first one was overwritten. That was
 * fixed by making it open a separate project.
 *
 * Then the WORDS were left behind: the chip still promised "you are asked
 * before this page goes" and the hint under the row still read "the next
 * message replaces this page", after neither had been true for some time. A
 * warning about losing work that cannot be lost is its own small harm — it
 * makes people hesitate over something safe.
 *
 * The chip rendered perfectly through both. That is why this file reads strings
 * rather than pixels.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failed = 0;
let passed = 0;
const ok = (t) => { passed++; console.log(`ok    ${t}`); };
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const panel = readFileSync(
  join(process.cwd(), "src/app/dashboard/components/workspace/ChatPanel.tsx"),
  "utf8",
);

console.log("New project starts one, rather than replacing this one:");

has(
  /await startNewProject\(text\);/.test(panel),
  "the send routes to startNewProject",
  "without this the message goes to /api/build as a build against THIS project, which is the replacement bug",
);

has(
  /const created = await create\(nameFromPrompt\(text\)\);/.test(panel),
  "which creates a separate project",
  "a new project needs its own row; reusing this one is what overwrote people's pages",
);

has(
  /router\.push\(`\/dashboard\/project\/\$\{created\.id\}\?prompt=/.test(panel),
  "and opens it carrying the brief",
  "the brief must travel — retyping it is the tax that made people press the wrong chip in the first place",
);

console.log("\nAnd nothing still says otherwise:");

has(
  !/replaces this page/.test(panel),
  "no copy promises to replace the page",
  'the hint under the row said "The next message replaces this page." long after it stopped being true',
);

has(
  !/You are asked before this page goes/.test(panel),
  "no tooltip warns about losing this page",
  "it is not at risk — this opens a separate workspace and leaves this one in the tab strip",
);

has(
  /starts a new app, in its own workspace/.test(panel),
  "the hint says what actually happens",
  "one mode is armed and the line under the row is what explains it",
);

console.log("\nReplacing a page is still possible, and still asks first:");

has(
  /confirmNewProject/.test(panel),
  "the confirmation flow survives",
  'the classifier reading "actually make it a shop instead" and ASKING is the legitimate way a page gets replaced',
);

has(
  /pendingConfirm/.test(panel),
  "and it is still a question, not an action",
  "a page replaced without a confirmation is the failure that whole path exists to prevent",
);


/* ── An answered question must not be asked again ──────────────────────────
 *
 * Source assertions for the same reason as everything above: this failed
 * silently and rendered perfectly.
 *
 * `stack` was in BuildOptions, ChatPanel passed it on every chip press, and
 * the request body in ProjectsContext never included it. So the server got the
 * same brief with no answer attached, read it as uncertain again, and asked
 * again — the chips were a loop with no way out except Cancel. Nothing threw,
 * nothing logged, and the only symptom was a question that would not go away.
 *
 * `architecture` is the same wiring one level up and would fail the same way,
 * so both are asserted end to end: the panel sends it, the context forwards
 * it, and the route reads it.
 */
const context = readFileSync(
  join(process.cwd(), "src/app/dashboard/ProjectsContext.tsx"),
  "utf8",
);
const buildRoute = readFileSync(join(process.cwd(), "src/app/api/build/route.ts"), "utf8");

console.log("\nAn answer reaches the server:");

for (const field of ["stack", "architecture", "buildKind"]) {
  has(
    new RegExp(`${field}:\\s*options\\.${field}\\s*\\?\\?\\s*null`).test(context),
    `the ${field} answer is in the request body`,
    "ChatPanel passes it and the body drops it — the chips become a loop",
  );
}

has(
  /isArchitectureChoice\(body\.architecture\)/.test(buildRoute),
  "and the route reads the architecture answer through its own validator",
);

has(
  /needsArchitecture:\s*true/.test(buildRoute) && /architectureOptions\(/.test(buildRoute),
  "the route offers the architecture question rather than spending the guess",
  "decideArchitecture reports `certain: false` and nothing asked — see architecture.ts",
);

has(
  buildRoute.indexOf("needsArchitecture: true") < buildRoute.indexOf("needsStack: true"),
  "and it is asked before the stack question, which it subsumes",
  "answering 'the front of it' settles the artefact too",
);

has(
  /setPendingArchitecture\(/.test(panel) && /reply\.needsArchitecture/.test(panel),
  "the panel renders it as chips, like the two questions beside it",
);

console.log(failed ? `\n${failed} failed.` : `\nAll ${passed} passed.`);
process.exit(failed ? 1 : 0);
