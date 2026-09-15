#!/usr/bin/env node
/* The one file that can stop this whole platform shipping.
 *
 *   npm run check:vercel-config
 *
 * On 13 September a `vercel.json` asking for a cron every two minutes was
 * merged. This account is on Vercel's Hobby plan, which does not allow a cron
 * to fire more than once a day — and it does not warn, it REFUSES: no
 * deployment is created, nothing appears in the Vercel dashboard, and the only
 * trace is a GitHub commit status reading "Deployment failed." with a
 * vercel.link that has to be opened in a browser to say why.
 *
 * So main stopped deploying, and stayed stopped for three days while work was
 * merged onto it. Every fix in that window was written, reviewed, merged, and
 * never reached a single customer — including the publish route the customer
 * was reporting as broken, which by then was fixed on main and old in
 * production. That is the most expensive class of bug this repository can have:
 * one where the evidence says the code is right.
 *
 * Nothing in the build catches it. `tsc` does not read vercel.json, `next
 * build` does not read the crons in it, and the preview deployment fails the
 * same silent way, so a pull request looks exactly as it does when it is fine.
 * This is the check that reads it.
 *
 * Two rules, both of them ways Vercel refuses a deployment outright:
 *   1. no cron may fire more than once a day  (the Hobby limit)
 *   2. every cron path must be a route that exists
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const path = join(root, "vercel.json");
if (!existsSync(path)) {
  console.log("ok    there is no vercel.json, so there is nothing to refuse");
  process.exit(0);
}

let config;
try {
  config = JSON.parse(readFileSync(path, "utf8"));
  ok("vercel.json parses");
} catch (error) {
  fail("vercel.json parses", String(error));
  process.exit(1);
}

const crons = Array.isArray(config.crons) ? config.crons : [];

/* Hobby allows two. Not enforced as a failure here — moving to Pro makes it
   moot and a third cron is a decision rather than a mistake — but said, because
   the person adding one should know the ceiling exists. */
if (crons.length > 2) {
  console.log(`note  ${crons.length} crons; Hobby allows 2. This needs a Pro plan.`);
}

/**
 * Whether a 5-field cron expression can fire more than once in a day.
 *
 * The rule Vercel applies on Hobby is "at most once per day", which means the
 * minute and the hour must each name exactly one value. Everything else — which
 * days, which months — only makes it rarer. So a list, a range or any step in
 * either of the first two fields is more than once a day, and `*` certainly is.
 */
function firesMoreThanDaily(schedule) {
  const fields = String(schedule).trim().split(/\s+/);
  if (fields.length !== 5) return true;
  const single = (field) => /^\d+$/.test(field);
  return !(single(fields[0]) && single(fields[1]));
}

for (const cron of crons) {
  has(
    !firesMoreThanDaily(cron.schedule),
    `${cron.path} fires at most once a day`,
    `schedule "${cron.schedule}" fires more often, which Hobby refuses — the deployment is never created`,
  );

  /* The path as Vercel resolves it: a cron names a route, and a cron naming a
     route that is not there is the other way a deployment is refused. */
  const segment = String(cron.path ?? "").replace(/^\/+/, "");
  const candidates = ["route.ts", "route.tsx", "route.js"].map((file) =>
    join(root, "src", "app", segment, file),
  );
  has(
    candidates.some((file) => existsSync(file)),
    `${cron.path} is a route that exists`,
    `no route.ts under src/app/${segment}`,
  );
}

/* The check that the schedule above is read correctly, rather than trusted. */
for (const [schedule, tooOften] of [
  ["*/2 * * * *", true],
  ["0 * * * *", true],
  ["0 */4 * * *", true],
  ["0,30 4 * * *", true],
  ["0 4-6 * * *", true],
  ["0 4 * * *", false],
  ["30 2 * * 1", false],
  ["nonsense", true],
]) {
  has(
    firesMoreThanDaily(schedule) === tooOften,
    `"${schedule}" reads as ${tooOften ? "more often than daily" : "daily or rarer"}`,
  );
}

console.log(failed === 0 ? "\nAll vercel config checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
