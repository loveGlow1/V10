#!/usr/bin/env node
/* Every failure names a cause and a remedy.
 *
 *   npm run check:run-failure
 *
 * There was one sentence for every way a run could end without an answer:
 *
 *     "I couldn't send that one. Your message is still in the box — try it
 *      again."
 *
 * It names no cause, and its advice is actively wrong for the commonest case. A
 * request killed by the sixty-second ceiling is killed again at sixty seconds,
 * and again after that. A customer followed that instruction four times in nine
 * minutes — 8:41, 8:47, 8:48 — while the thing they needed to know, that the
 * change was too large to finish in the time and to ask for one section
 * instead, was never said by anything in the product.
 *
 * THE FIELD THAT MATTERS IS `retryable`. Telling somebody to try again when
 * trying again cannot work is worse than saying nothing: it is an instruction
 * to spend their afternoon in a loop that does not close.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-run-failure");
mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify(
    {
      extends: join(root, "tsconfig.json"),
      compilerOptions: {
        noEmit: false, outDir: out, rootDir: join(root, "src"),
        module: "commonjs", moduleResolution: "node",
        declaration: false, incremental: false, plugins: [],
        baseUrl: root, paths: { "@/*": ["src/*"] },
      },
      include: [join(root, "src/lib/builder/run-failure.ts")],
    },
    null,
    2,
  ),
);
execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { stdio: ["ignore", "ignore", "inherit"] });

const require = createRequire(import.meta.url);
const { describeRunFailure, sayFailure } = require(join(out, "lib/builder/run-failure.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

/* ── The real one, from the transcript ───────────────────────────────────── */
{
  const timeout = describeRunFailure({
    status: 200, answered: false, started: true, elapsedMs: 58_000,
  });

  has(/58 seconds/.test(timeout.cause), "a run cut off at 58 seconds says so, in seconds", timeout.cause);
  has(/one minute/.test(timeout.cause), "and names the limit it hit");
  has(/not been touched|nothing was changed/i.test(timeout.cause), "and says the page is untouched");

  has(
    timeout.retryable === false,
    "IT IS NOT RETRYABLE — the same message hits the same ceiling",
    "this is the field that sent somebody round the loop four times",
  );
  has(
    !/try (it )?again/i.test(timeout.remedy),
    "so the remedy never says try again",
    timeout.remedy,
  );
  has(
    /one part at a time|section/i.test(timeout.remedy),
    "it says to ask for one part at a time",
    timeout.remedy,
  );
  has(
    /header|pricing|footer/i.test(timeout.remedy),
    "with the words to use, rather than the instruction to be brief",
  );
  has(/Prototype/.test(timeout.remedy), "and names the faster agent as the other way out");
}

/* ── The opposite failure, which needs the opposite advice ───────────────── */
{
  const dropped = describeRunFailure({
    status: 0, answered: false, started: false, elapsedMs: 900, thrown: "Load failed",
  });

  has(/didn't reach the server/i.test(dropped.cause), "a request that never left says that", dropped.cause);
  has(dropped.retryable === true, "and IS retryable, because sending it again is the fix");
  has(/again/i.test(dropped.remedy), "so here the remedy does say to send it again");
  has(
    !/Load failed/.test(sayFailure(dropped)),
    "the browser's own words never reach the customer",
    "\"Load failed\" names nothing anybody can act on",
  );
}

/* ── A gate that already explained itself ────────────────────────────────── */
{
  const refused = describeRunFailure({
    status: 422, answered: true, started: true, elapsedMs: 4_000,
    said: "I couldn't place that change in the page, so I've left it exactly as it was. Try naming the section.",
  });

  has(refused.cause.startsWith("I couldn't place"), "the gate's own sentence is the cause, verbatim");
  has(
    refused.remedy === "",
    "and nothing is added under a sentence that already says what to do",
    "two instructions in one bubble is how a clear refusal becomes noise",
  );
}

{
  const bare = describeRunFailure({
    status: 500, answered: true, started: true, elapsedMs: 3_000,
    said: "The project's files could not be stored.",
  });
  has(bare.remedy.length > 0, "a sentence with no advice in it gets some");
  has(!/try it again/i.test(bare.remedy), "and it is not a bare retry", bare.remedy);
}

/* ── Stopping is not failing ─────────────────────────────────────────────── */
{
  const stopped = describeRunFailure({
    status: 0, answered: false, started: true, elapsedMs: 3_000, aborted: true,
  });
  has(/^Stopped/.test(stopped.cause), "stopping by hand reads as stopping, not as an error");
  has(!/cut off|didn't reach/i.test(stopped.cause), "and is never dressed as a failure");
}

/* ── The named statuses ──────────────────────────────────────────────────── */
{
  for (const [status, expect, retry] of [
    [504, /too long/i, false],
    [502, /too long/i, false],
    [429, /faster than/i, true],
    [402, /credits/i, true],
    [401, /signed in/i, true],
  ]) {
    const named = describeRunFailure({
      status, answered: false, started: true, elapsedMs: 2_000,
    });
    has(expect.test(named.cause), `${status} is named rather than generic`, named.cause);
    has(named.retryable === retry, `${status} says whether sending it again helps`);
  }
}

/* ── THE INVARIANT ───────────────────────────────────────────────────────── */
{
  const everything = [
    { status: 200, answered: false, started: true, elapsedMs: 58_000 },
    { status: 0, answered: false, started: false, elapsedMs: 800 },
    { status: 500, answered: false, started: true, elapsedMs: 5_000 },
    { status: 504, answered: false, started: true, elapsedMs: 61_000 },
    { status: 429, answered: false, started: false, elapsedMs: 300 },
    { status: 402, answered: true, started: true, elapsedMs: 1_000, said: "Not enough credits." },
    { status: 0, answered: false, started: true, elapsedMs: 100, aborted: true },
  ];

  const silent = everything.filter((facts) => describeRunFailure(facts).cause.trim().length === 0);
  has(silent.length === 0, "every failure has a cause");

  /* A remedy on everything that is not already carrying one, and never the
     empty apology this file replaced. */
  const useless = everything
    .map((facts) => sayFailure(describeRunFailure(facts)))
    .filter((said) => /I couldn't send that one/i.test(said));
  has(useless.length === 0, "and none of them is the sentence this replaced");
}

/* ── And that both paths use it ──────────────────────────────────────────── */
{
  const context = readFileSync(join(root, "src/app/dashboard/ProjectsContext.tsx"), "utf8");
  const chat = readFileSync(
    join(root, "src/app/dashboard/components/workspace/ChatPanel.tsx"), "utf8");

  /* Matched on the FALLBACK rather than on the sentence: the sentence itself
     still appears in that file, quoted in the comment explaining why it went,
     and a check that forbade the words would delete the explanation with it. */
  has(
    /describeRunFailure\(/.test(context) && !/error: payload\?\.error \?\?/.test(context),
    "the streamed path names its failures instead of falling back to one sentence",
  );
  has(
    /describeRunFailure\(/.test(chat) && !/\(error as Error\)\.message \}\)/.test(chat),
    "and the thrown path stopped putting the browser's error in the conversation",
  );
  has(
    /elapsedMs: Date\.now\(\) - requestedAt/.test(context),
    "with the elapsed time measured from when the request went out",
    "without it a timeout cannot be told apart from a dropped connection",
  );
}

console.log(failed === 0 ? "\nAll run failure checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
