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
 * It names no cause, and its advice used to be actively wrong for the commonest
 * case. A customer followed that instruction four times in nine minutes —
 * 8:41, 8:47, 8:48 — and each time got the same dead connection.
 *
 * The first fix told them instead to ask for one section at a time. That was
 * accurate about the ceiling and wrong about whose problem it was: it made a
 * limit of ours read as a fault in their request, for a request that was never
 * too large.
 *
 * An edit is now a durable task (src/lib/builder/edit-task.ts), so the answer
 * this file has to give changed with it: the change is saved, sending the same
 * message rejoins it, and NOTHING here may tell a customer to break up what
 * they asked for because our connection has a ceiling. That is the rule these
 * assertions exist to hold.
 *
 * THE OTHER FIELD THAT MATTERS IS `retryable`, and it has to match the world:
 * true when sending it again does something different, false when it cannot.
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

  has(
    /connection/i.test(timeout.cause),
    "a run cut off names the CONNECTION as what ended",
    timeout.cause,
  );
  has(
    !/\b\d+ seconds\b/.test(timeout.cause),
    "and never reports our seconds at somebody who did nothing wrong",
    timeout.cause,
  );
  has(
    /exactly as it was|not been touched|nothing was changed/i.test(timeout.cause),
    "it says the page is untouched",
    timeout.cause,
  );
  has(/charged/i.test(timeout.cause), "and that the attempt cost nothing");
  has(/saved/i.test(timeout.cause), "and that what was worked out is saved", timeout.cause);

  /* ── THE TWO SENTENCES THIS PRODUCT MAY NOT SAY ──────────────────────────
   *
   * Both were shipped, both were read as our limit being the customer's fault,
   * and both are now false as well as unkind: the change is a task, not a
   * socket. */
  has(
    !/one part at a time|one section at a time|a section at a time|smaller/i.test(
      `${timeout.cause} ${timeout.remedy}`,
    ),
    "IT NEVER TELLS THEM TO ASK FOR LESS",
    timeout.remedy,
  );
  has(
    !/cut off/i.test(`${timeout.cause} ${timeout.remedy}`),
    "and never says the request was cut off",
    timeout.cause,
  );

  has(
    timeout.retryable === true,
    "IT IS RETRYABLE — the same message rejoins the saved task",
    "this is the field that used to send somebody round a loop that could not close",
  );
  has(
    /send (the same message |it )?again/i.test(timeout.remedy),
    "so the remedy is to send the same message again",
    timeout.remedy,
  );
  has(
    /rather than starting a second|picks .*back up|saved/i.test(timeout.remedy),
    "and says what that does, rather than asking them to trust it",
    timeout.remedy,
  );
  has(
    /don't (need|have) to change what you asked for|don't have to change anything you asked for/i.test(
      timeout.remedy,
    ),
    "and says in as many words that their request was fine",
    timeout.remedy,
  );
  has(/Prototype/.test(timeout.remedy), "with the faster agent named as an option, not an instruction");
}

/* ── Nothing anywhere may push them to shrink the request ────────────────── */
{
  const everyFailure = [
    { status: 200, answered: false, started: true, elapsedMs: 58_000 },
    { status: 504, answered: false, started: true, elapsedMs: 61_000 },
    { status: 502, answered: false, started: true, elapsedMs: 47_000 },
    { status: 500, answered: false, started: true, elapsedMs: 5_000 },
    { status: 0, answered: false, started: false, elapsedMs: 800 },
  ].map((facts) => sayFailure(describeRunFailure(facts)));

  const pushy = everyFailure.filter((said) =>
    /one part at a time|one section at a time|a section at a time|ask for (a )?smaller/i.test(said),
  );
  has(
    pushy.length === 0,
    "NO failure this file names asks the customer to break up their request",
    pushy[0],
  );
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
    /* Both are the connection's ceiling wearing a status code, and both are
       retryable now for the same reason the branch above is: the change is a
       saved task, so sending it again continues it. */
    [504, /didn't answer/i, true],
    [502, /didn't answer/i, true],
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
