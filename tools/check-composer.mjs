#!/usr/bin/env node
/* What the composer's buttons promise, and whether they still do it.
 *
 *   npm run check:composer
 *
 * Source assertions rather than a rendered test, which is coarser than it could
 * be but catches the thing worth catching: a label that stops matching its
 * action. That is not a hypothetical here. "New project" spent months as a
 * composer MODE, and what it armed was a replacement — press it, describe the
 * second thing you wanted to build, and the first one was overwritten. The
 * button said one thing and did close to the opposite, and nothing failed.
 *
 * A rendering test would not have caught it either. The chip rendered fine.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const panel = readFileSync(join(process.cwd(), "src/app/dashboard/components/workspace/ChatPanel.tsx"), "utf8");

console.log("New project starts one, rather than replacing this one:");

has(
  /type ComposerMode = "auto" \| "edit" \| "question";/.test(panel),
  "it is not a composer mode",
  'a mode arms the NEXT MESSAGE. "New project" as a mode meant "the next message replaces this page", which is not what the words say.',
);

has(
  !/id: "new_project" as const/.test(panel),
  "it is not in the mode chip list",
  "the three-chip group sets what a message MEANS; this one does something on the press",
);

has(
  /onClick=\{\(\) => router\.push\("\/dashboard"\)\}/.test(panel),
  "it navigates to Home",
  "Home is the fresh-start surface: empty composer, no project, no thread, and the target chips that choose a blueprint",
);

/* The button and its navigation must be the same element. A label sitting
   above an onClick that goes somewhere else is precisely the bug this file is
   named after. */
const button = panel.slice(panel.indexOf('router.push("/dashboard")') - 400, panel.indexOf('router.push("/dashboard")') + 400);
has(
  button.includes("New project"),
  "the label and the navigation are the same button",
  "found the navigation, but not the words next to it",
);

has(
  !/The next message replaces this page\./.test(panel),
  "nothing still offers to replace the page in advance",
  "the hint under the chip row described a mode that no longer exists",
);

console.log("\nReplacing a page is still possible, just not armed by a chip:");

has(
  /intentOverride: "new_project"/.test(panel),
  "the confirmation flow still sends it",
  'the classifier reading "actually make it a shop instead" and ASKING is the right way for this to happen',
);

has(
  /confirmNewProject: true/.test(panel),
  "and still asks first",
  "a page being replaced without a confirmation is the failure this whole path exists to prevent",
);

console.log(failed ? `\n${failed} failed.` : "\nAll 7 passed.");
process.exit(failed ? 1 : 0);
