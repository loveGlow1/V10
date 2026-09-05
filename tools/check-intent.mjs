#!/usr/bin/env node
/* Checks the message classifier against the labelled corpus.
 *
 *   npm run check:intent
 *
 * Only the free pass is measured. heuristicIntent decides without a network
 * call, so this runs offline, costs nothing and can be run on every change —
 * which is the point, because the rules it covers are regexes, and a regex
 * widened to catch one message quietly catches three others.
 *
 * A wrong answer fails the run. A deferral does not: handing a genuinely
 * ambiguous message to the router is the designed behaviour, not a miss. The
 * deferral rate is printed because it is a latency and cost number — every one
 * of them is a model call someone waits for — but it is not a failure.
 *
 * The model half is deliberately not exercised here. It needs a key, bills a
 * request per message, and is not deterministic; tools/check-builder.mjs is
 * where a real call is made.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { SETS } from "./intent-corpus.mjs";

/* intent.ts imports the Anthropic SDK at the top, so it is compiled rather than
   read: the heuristics are TypeScript and this is a plain node script.
   
   Built under node_modules/.cache rather than in the system temp directory —
   the compiled file still carries that SDK import, and node resolves it by
   walking up from the file, which only finds node_modules from inside the
   project. */
const out = join(process.cwd(), "node_modules", ".cache", "quickstark-intent");
mkdirSync(out, { recursive: true });
try {
  execFileSync(
    "npx",
    [
      "tsc", "src/lib/builder/intent.ts",
      "--outDir", out,
      "--module", "esnext",
      "--target", "es2022",
      "--moduleResolution", "bundler",
      "--skipLibCheck",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );

  const { heuristicIntent, remainderAfterRevert } = await import(join(out, "intent.js"));

  let failed = 0;
  let totalDeferred = 0;
  let totalCases = 0;

  for (const [name, set] of Object.entries(SETS)) {
    let right = 0;
    let wrong = 0;
    let deferred = 0;
    const misses = [];

    for (const [message, hasPage, want] of set) {
      const got = heuristicIntent(message, hasPage);
      if (got === null) {
        deferred++;
        continue;
      }
      if (got.intent === want) right++;
      else {
        wrong++;
        misses.push({ message, hasPage, want, got: got.intent });
      }
    }

    totalCases += set.length;
    totalDeferred += deferred;
    failed += wrong;

    const verdict = wrong === 0 ? "ok  " : "FAIL";
    console.log(
      `${verdict} ${name.padEnd(8)} n=${String(set.length).padStart(3)}  correct ${String(right).padStart(3)}  wrong ${String(wrong).padStart(2)}  to the model ${deferred}`,
    );
    for (const miss of misses) {
      console.log(
        `       want ${miss.want.padEnd(12)} got ${miss.got.padEnd(12)} ${miss.hasPage ? "" : "(no page) "}${miss.message}`,
      );
    }
  }

  const deferralRate = ((totalDeferred / totalCases) * 100).toFixed(0);
  console.log(
    `\n${totalCases} messages · ${failed} wrong · ${totalDeferred} handed to the router (${deferralRate}%)`,
  );

  /* What a revert hands back.
   *
   * An undo carrying a second instruction is classified as a revert, and the
   * second instruction is not performed — the undo has to happen first, and
   * applying an edit to the version being discarded would be exactly wrong. So
   * it is read back out and returned to the person instead of vanishing.
   *
   * Both directions matter and the false positive is the worse one: a missed
   * remainder costs a sentence that would have helped, while an invented one
   * puts words in somebody's mouth and reads as a misunderstanding. */
  const REMAINDERS = [
    ["undo that", null],
    ["undo the last change", null],
    ["revert", null],
    ["put it back", null],
    ["go back to the previous version", null],
    ["undo that and make the header taller", "make the header taller"],
    ["undo the last change and use a lighter blue", "use a lighter blue"],
    ["revert that, then add a contact form", "add a contact form"],
    ["roll back and also can you centre the logo", "centre the logo"],
    /* Too short to act on. Repeating "do it" back would read as a misreading. */
    ["undo that and do it", null],
    /* Not an opening undo, so not this function's business — the classifier
       reads it as an edit with a story attached. */
    ["I undid it earlier, now make the header taller", null],
  ];

  let remainderWrong = 0;
  for (const [message, want] of REMAINDERS) {
    const got = remainderAfterRevert(message) ?? null;
    if (got === want) continue;
    remainderWrong += 1;
    console.log(`FAIL  "${message}"\n        expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }

  console.log(
    remainderWrong === 0
      ? `${REMAINDERS.length} reverts hand back the right leftover instruction`
      : `${remainderWrong} of ${REMAINDERS.length} remainders wrong`,
  );

  if (remainderWrong > 0) failed += remainderWrong;

  if (failed > 0) {
    console.log("\nA wrong answer means the rules changed meaning, not just coverage.");
    process.exit(1);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
