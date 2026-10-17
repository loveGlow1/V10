#!/usr/bin/env node
/* A project's versions, and which one a message means.
 *
 *   npm run check:version-history
 *
 * Offline: versions.ts is pure apart from one read, so every phrasing is
 * exercised against a fixed history, a fixed "now" and a time zone that is not
 * UTC — "yesterday" is somebody's yesterday, and a check run in UTC would never
 * notice it computing the wrong one.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-version-history");
mkdirSync(out, { recursive: true });
execFileSync(
  "npx",
  ["tsc", "src/lib/builder/versions.ts", "--outDir", out, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: ["ignore", "ignore", "inherit"] },
);
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

const V = await import(join(out, "versions.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => {
  failed += 1;
  console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`);
};
const is = (got, want, t) => (JSON.stringify(got) === JSON.stringify(want) ? ok(t) : fail(t, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

/* Lagos, UTC+1 all year: "now" is 17 Oct 2026, 15:30 local. */
const TZ = "Africa/Lagos";
const NOW = new Date("2026-10-17T14:30:00Z");

const rows = [
  { id: "a", prompt: "Build a landing page for my bakery", created_at: "2026-10-15T09:00:00Z" },
  { id: "b", prompt: "Add a pricing table", created_at: "2026-10-16T10:00:00Z" },
  { id: "c", prompt: "Make the header dark blue", created_at: "2026-10-16T20:00:00Z" },
  { id: "d", prompt: "Add a footer with social links", created_at: "2026-10-17T08:00:00Z" },
  { id: "e", prompt: "Add a testimonials section", created_at: "2026-10-17T12:00:00Z" },
];
const versions = V.versionsFromRows(rows);
const resolveIn = (list, message) => {
  const r = V.resolveTarget(list, V.parseTarget(message, NOW, TZ), TZ, NOW);
  return r.ok ? r.version.number : `refused: ${r.message}`;
};
const resolve = (message) => resolveIn(versions, message);

/* ── Naming a version ─────────────────────────────────────────────────── */
is(resolve("go back to version 3"), 3, "version 3");
is(resolve("revert to v2"), 2, "v2");
is(resolve("restore version #4"), 4, "version #4");
is(resolve("go back to version three"), 3, "version three, in words");
is(resolve("take me back to the first version"), 1, "the first version");
is(resolve("restore the original"), 1, "the original");
is(resolve("I want the second version back"), 2, "the second version");
is(resolve("go back to the 3rd version"), 3, "the 3rd version");
is(String(resolve("go back to version 9")).startsWith("refused: There's no version 9"), true, "a version that does not exist is refused, with how many there are");

/* ── Stepping back ────────────────────────────────────────────────────── */
is(resolve("undo"), 4, "undo is one step back");
is(resolve("go back to the previous version"), 4, "the previous version");
is(resolve("go back to the last version"), 4, "'the last version' means the one before this, as people say it");
is(resolve("undo the last 2 changes"), 3, "undo the last 2 changes");
is(resolve("go back three versions"), 2, "three versions back");
is(resolve("take me back 2 versions"), 3, "back 2 versions");
is(resolve("the one before last"), 3, "the one before last");

/* ── Time, in the person's zone ───────────────────────────────────────── */
is(resolve("restore the version from yesterday"), 3, "yesterday = the last version made yesterday (21:00 Lagos)");
is(resolve("go back to how it was this morning"), 4, "this morning = the last before noon today");
is(resolve("go back to how it was 3 hours ago"), 4, "3 hours ago");
is(resolve("restore the version from last night"), 3, "last night");
is(resolve("go back to how it was at 10am"), 4, "at 10am today (Lagos)");
is(resolve("go back to how it was at 11:30 am yesterday"), 2, "a clock time with yesterday is that time yesterday");
is(resolve("go back to how it was at 11pm"), 3, "a clock time later than now today means yesterday's");
is(String(resolve("go back to how it was 5 days ago")).startsWith("refused: There's no version from"), true, "before the first version is refused, saying when the first was");

/* ── By what the change was ───────────────────────────────────────────── */
is(resolve("go back to before I added the footer"), 3, "before I added the footer");
is(resolve("go back to before the pricing table"), 1, "before the pricing table");
is(resolve("take me back to the version where I added the pricing table"), 2, "the version where I added pricing");
is(resolve("restore the version with the testimonials"), 5, "the version with the testimonials");
is(String(resolve("go back to before I added the newsletter")).startsWith("refused: I couldn't find"), true, "an unknown change is refused and points at the list");

/* ── Undo walks backwards; it does not toggle ─────────────────────────── */
const afterUndo = V.versionsFromRows([
  ...rows,
  { id: "f", prompt: V.restorePrompt(versions[3]), created_at: "2026-10-17T13:00:00Z" },
]);
is(afterUndo[5].restoredFrom, 4, "a restore row records the version it copied");
is(V.contentOf(afterUndo, 6), 4, "and what is showing is that version");
is(resolveIn(afterUndo, "undo"), 3, "a second undo goes to version 3, not back to 5");
is(resolveIn(afterUndo, "undo the last two changes"), 2, "and two steps from there is version 2");
is(resolveIn(afterUndo, "bring back the latest version"), 5, "'the latest version' goes forward again to the newest real change");

const afterEdit = V.versionsFromRows([
  ...afterUndo.map((v) => ({ id: v.id, prompt: v.prompt, created_at: v.createdAt })),
  { id: "g", prompt: "Make the buttons rounder", created_at: "2026-10-17T13:30:00Z" },
]);
is(resolveIn(afterEdit, "undo"), 6, "an edit after a restore is undone back to that restore");

const legacy = V.versionsFromRows([
  ...rows.slice(0, 3),
  { id: "x", prompt: "Reverted: undo that", created_at: "2026-10-16T21:00:00Z" },
]);
is(legacy[3].restoredFrom, 2, "rows from the old undo are read as restores of the version two before");

const onFirst = V.versionsFromRows(rows.slice(0, 1));
is(String(resolveIn(onFirst, "undo")).startsWith("refused: There's nothing to undo"), true, "undo on the first version says so");

/* ── Which messages are version requests at all ───────────────────────── */
const kind = (m) => V.readVersionRequest(m)?.kind ?? null;
is(kind("show me the versions"), "list", "show me the versions");
is(kind("version history"), "list", "version history");
is(kind("what versions are there?"), "list", "what versions are there");
is(kind("how many versions do I have"), "list", "how many versions");
is(kind("go back to version 3"), "goto", "go back to version 3");
is(kind("switch to the original"), "goto", "switch to the original");
is(kind("restore the version from yesterday"), "goto", "restore the version from yesterday");
is(kind("change the version number in the footer to 2.0"), null, "an edit that mentions a version number is not one");
is(kind("switch the header to dark blue"), null, "switching a colour is not a version move");
is(kind("add a version selector to the docs page"), null, "adding a version selector is not one");
is(kind("make it like the original design"), null, "no undo verb: left to the classifier");
is(kind("restore the original spacing on the hero"), null, "the original spacing of one part is not version 1");
is(V.parseTarget("restore the original spacing on the hero", NOW, TZ), null, "and names no version, so it is a one-step undo");
is(resolve("switch back to the original design"), 1, "the original design is version 1");

/* ── Time zones ──────────────────────────────────────────────────────── */
is(V.safeTimeZone("Africa/Lagos"), "Africa/Lagos", "a real time zone is kept");
is(V.safeTimeZone("Mars/Olympus"), "UTC", "a made-up one falls back to UTC");
is(V.formatWhen("2026-10-17T12:00:00Z", TZ, NOW), "today at 1:00 PM", "times are said in the person's zone");
is(V.formatWhen("2026-10-16T20:00:00Z", TZ, NOW), "yesterday at 9:00 PM", "yesterday, likewise");

const listed = V.describeVersions(afterUndo, TZ, NOW);
is(/Version 6\*\* · today at 2:00 PM · Restored version 4 ← showing now/.test(listed), true, "the list marks what is showing and when");
is(/same as version 4/.test(listed), true, "and says which version that is");

rmSync(out, { recursive: true, force: true });
console.log(failed ? `\n${failed} check${failed === 1 ? "" : "s"} failed.` : "\nAll version history checks passed.");
process.exit(failed ? 1 : 0);
