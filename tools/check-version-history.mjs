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

/* ── Aurelia Estates: the real history ─────────────────────────────────
   38 versions with their real fingerprints (first six characters) and times.
   Many are copies of an earlier one — failed edits, undos that toggled — and
   the Buy/Rent toggle left the home page at version 33. */
const AURELIA = [
  ["a68f2e", "2026-09-30T18:19:00Z", "BUILD A PREMIUM REAL ESTATE PLATFORM"],
  ["de428e", "2026-09-30T18:21:00Z", "fill the images were the are missing"],
  ["2560cb", "2026-09-30T18:25:00Z", "add images under the featured properties section"],
  ["63224f", "2026-09-30T18:49:00Z", "add the missing photos on landing page"],
  ["2981b5", "2026-09-30T18:56:00Z", "update the dark black cards to brighten up"],
  ["10c85f", "2026-09-30T19:08:00Z", "make the Search Properties button easy to read"],
  ["b8bef4", "2026-09-30T19:10:00Z", "make the rent easy to read too"],
  ["8fc229", "2026-10-01T02:27:00Z", "the search panel behind the Buy / Rent buttons"],
  ["b8bef4", "2026-10-01T02:29:00Z", "Reverted: Undo the last change."],
  ["7244bf", "2026-10-01T02:30:00Z", "change only the Rent button so it looks like Buy"],
  ["84a22e", "2026-10-01T03:59:00Z", "Add a user dashboard and make every feature real"],
  ["09f38b", "2026-10-01T04:24:00Z", "In components/Nav.tsx, change the listener"],
  ["f37c91", "2026-10-01T07:33:00Z", "fix the dashboard settings"],
  ["7bb5dd", "2026-10-01T07:33:30Z", "fix the dashboard settings"],
  ["a2b579", "2026-10-01T07:34:00Z", "fix the dashboard settings"],
  ["513b76", "2026-10-01T17:15:00Z", "Visual edit: <h1> font"],
  ["dd18ac", "2026-10-01T17:21:00Z", "Visual edit: <p> text"],
  ["513b76", "2026-10-01T17:21:30Z", "Reverted: Undo the last change."],
  ["bd3aaf", "2026-10-02T09:11:00Z", "Update the logo with a different logo image"],
  ["513b76", "2026-10-02T09:11:30Z", "Reverted: Undo the last change."],
  ["bd3aaf", "2026-10-02T09:12:00Z", "Reverted: Undo the last change."],
  ["513b76", "2026-10-02T09:12:30Z", "Reverted: Undo the last change."],
  ["d76203", "2026-10-16T07:47:00Z", "Change these exact elements: div"],
  ["e6f2a8", "2026-10-16T07:49:00Z", "Change these exact elements: button"],
  ["6fb390", "2026-10-16T08:24:00Z", "Change these exact elements: h1"],
  ["c87d9c", "2026-10-16T08:25:00Z", "Change these exact elements: p"],
  ["117f6b", "2026-10-16T08:27:00Z", "Change these exact elements: p"],
  ["c87d9c", "2026-10-16T08:28:00Z", "Reverted: update only the specified one"],
  ["99249a", "2026-10-16T08:29:00Z", "Change these exact elements: div"],
  ["560216", "2026-10-16T08:29:30Z", "Change these exact elements: p"],
  ["e68378", "2026-10-16T17:54:00Z", "Add a favicon and a social share image"],
  ["228ad8", "2026-10-16T18:14:00Z", "Make every form on the site actually submit somewhere"],
  ["b69900", "2026-10-16T18:15:00Z", "Make every form on the site actually submit somewhere"],
  ["50cd2c", "2026-10-16T18:15:30Z", "Make every form on the site actually submit somewhere"],
  ["b69900", "2026-10-16T18:17:00Z", "Reverted: revert to the previus version"],
  ["9826a8", "2026-10-16T18:24:00Z", "Reverted: revert to the previus version"],
  ["f5de01", "2026-10-16T18:24:30Z", "Reverted: revert to the previus version"],
  ["228ad8", "2026-10-17T01:35:00Z", "Restored version 32: Make every form on the site actually submit somewhere"],
];
const aureliaAt = (count) => {
  const slice = AURELIA.slice(0, count);
  const rows = slice.map(([, at, prompt], i) => ({ id: `v${i + 1}`, prompt, created_at: at }));
  const digests = new Map(slice.map(([d], i) => [`v${i + 1}`, d]));
  return V.versionsFromRows(rows, digests);
};
const at37 = aureliaAt(37);
const at38 = aureliaAt(38);
const AUR_NOW = new Date("2026-10-17T02:00:00Z");
const pickIn = (list, message, showing = null) => {
  const r = V.resolveTarget(list, V.parseTarget(message, AUR_NOW, TZ), TZ, AUR_NOW, showing);
  return r.ok ? (r.alreadyShowing ? `already: ${r.version.number}` : r.version.number) : `refused: ${r.message}`;
};

is(at37[34].restoredFrom, 33, "an old undo is matched to the version it really copied (35 = 33)");
is(at37[35].restoredFrom, null, "and one that matches nothing stands as its own version (36)");
is(at37[21].restoredFrom, 20, "a chain of old undos follows its fingerprints (22 = 20)");
is(V.contentOf(at37, 22), 16, "and resolves to the first version that looked like that (16)");
is(at38[37].restoredFrom, 32, "the restore made today is read as a copy of version 32");

/* "The very last change before the current state." */
is(pickIn(at37, "undo"), 36, "from 37, undo is 36 — the last version that looks different");
is(pickIn(at38, "undo"), 31, "from 38 (a copy of 32), undo is 31, not a step back into the copies");
is(pickIn(aureliaAt(23), "undo"), 22, "from 23 (an edit), undo is the state just before it: 22");
is(pickIn(aureliaAt(22), "undo"), 15, "from 22 (itself an undo, = 16), undo keeps going back — to 15, not round again to 21");
is(pickIn(at37, "undo the last 3 changes"), 34, "undoing 37, 36 and 35 leaves 34");

/* "When it had the rent and buy" — by what the versions showed. */
const rentBuy37 = new Set(AURELIA.slice(0, 32).map((_, i) => `v${i + 1}`));
is(V.termsOf("the rent and buy"), ["rent", "buy"], "the words a described state names");
is(V.readVersionRequest("restore to when it had the rent and buy")?.kind, "goto", "'restore to when it had…' is a version move");
is(pickIn(at37, "restore to when it had the rent and buy", rentBuy37), 32, "from 37: the most recent version that still had Rent and Buy is 32");
is(pickIn(at37, "go back to when the home page had the rent and buy buttons", rentBuy37), 32, "said another way, the same");
is(
  String(pickIn(at38, "restore to when it had the rent and buy", new Set())).startsWith("refused: No earlier version had"),
  true,
  "from 38 the search finds nothing missing: it says Rent and Buy are already showing, and restores nothing",
);
is(pickIn(at37, "restore to when it had the rent and buy", null), 10, "without the search, it falls back to the newest request naming both (10)");

/* Already showing. */
is(pickIn(at38, "go back to version 32"), "already: 32", "version 32 when 38 is a copy of it: already showing");
is(pickIn(at37, "go back to version 33"), 33, "a different-looking version is restored");

/* The three most recent to choose from. */
is(V.recentDistinct(at38, 3).map((v) => v.number), [37, 36, 35], "the 3 most recent that look different from what's showing, newest first");
is(V.recentDistinct(at37, 3).map((v) => v.number), [36, 35, 34], "from 37");
is(V.readVersionRequest("show me my recent versions")?.recent, true, "'recent versions' asks for the three");
is(/1\. \*\*Version 37\*\*/.test(V.describeRecent(at38, TZ, AUR_NOW)), true, "and lists the newest first");
is(/looks the same as version 33/.test(V.describeVersions(at37, TZ, AUR_NOW)), false, "a recorded restore is labelled as a restore, not as a look-alike");
is(/Version 14\*\* .* · fix the dashboard settings\n/.test(V.describeVersions(aureliaAt(16), TZ, AUR_NOW)), true, "versions that differ get no look-alike note");

/* The Undo button and the version list send these exact words. */
is(pickIn(at38, "Undo the last change"), pickIn(at38, "undo"), "the Undo button's words step back exactly as a typed undo does");
is(pickIn(at37, "Go back to version 33"), 33, "a version picked from the list is that exact version");
{
  const { readFileSync } = await import("node:fs");
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const build = read("src/app/api/build/route.ts");
  const controls = read("src/app/dashboard/components/workspace/VersionControls.tsx");
  const chat = read("src/app/dashboard/components/workspace/ChatPanel.tsx");
  is(/body\.intentOverride !== "revert" && !canAfford\(balance, ENTRY_COST\)/.test(build), true, "undo works on an empty balance: it is never charged");
  is(/intent: "revert"/.test(controls) && /intentOverride: detail\.intent/.test(chat), true, "the buttons go through the chat as an undo, so the thread and preview follow");
  is(/\/api\/projects\/\$\{projectId\}\/versions/.test(controls) && /listVersions\(service, owned\.projectId\)/.test(read("src/app/api/projects/[id]/versions/route.ts")), true, "the list is read from the project's own history");
  is(/<VersionControls/.test(read("src/app/dashboard/components/workspace/PreviewPanel.tsx")) && /<VersionControls/.test(read("src/app/dashboard/components/workspace/PreviewSheet.tsx")), true, "Undo and Versions are on desktop and phone");
}

rmSync(out, { recursive: true, force: true });
console.log(failed ? `\n${failed} check${failed === 1 ? "" : "s"} failed.` : "\nAll version history checks passed.");
process.exit(failed ? 1 : 0);
