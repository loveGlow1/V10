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
const ok = (t) => console.log(`ok    ${t}`);
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

console.log(failed ? `\n${failed} failed.` : "\nAll 8 passed.");
process.exit(failed ? 1 : 0);
