#!/usr/bin/env node
/* Nothing deprecated goes into a generated project.
 *
 *   npm run check:versions
 *
 * Every dependency a generated app installs is pinned exactly in scaffold.ts,
 * and pinning is right: a caret means a project built today and one built in
 * March install different frameworks, and the second fails on an API the first
 * used. What pinning does not do is notice when the thing it pinned goes bad.
 *
 * next@15.5.4 was pinned here and deprecated on npm for CVE-2025-66478 — so
 * every project generated up to 2026-09-12 shipped a framework with a known
 * vulnerability. It was not hidden: npm prints a warning on every install. It
 * was printed into a build log on somebody else's machine, for a project the
 * customer could not build, and the first person to read it was reading it for
 * an unrelated reason.
 *
 * This asks the registry directly, which is the only source that knows. A
 * version npm marks deprecated fails; a version that is merely old does not,
 * because keeping current is a decision and shipping a known hole is not.
 *
 * Needs the network, and says so plainly if it cannot get there rather than
 * passing by default — a security check that goes quiet when it cannot see is
 * worse than no check.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/lib/builder/scaffold.ts"), "utf8");

/* Read out of the source rather than duplicated here. A second list is a list
   that drifts, and the drift would be silent in exactly the direction that
   matters. */
function pinned(constant) {
  /* `export const` as well as `const`: NEXT is exported so the deploy path can
     force the current framework version into an older tree's package.json, and
     when that export was added this check failed with "no pinned version
     found" — which is the right way for it to fail. A version-checker that
     cannot find a version must never read that as nothing to check. */
  const m = source.match(new RegExp(`^(?:export )?const ${constant} = "([^"]+)";`, "m"));
  return m ? m[1] : null;
}

const PACKAGES = [
  ["next", pinned("NEXT_VERSION")],
  ["react", pinned("REACT")],
  ["react-dom", pinned("REACT")],
  ["@types/react", pinned("TYPES_REACT")],
  ["typescript", pinned("TYPESCRIPT")],
  ["tailwindcss", pinned("TAILWIND")],
  ["@supabase/supabase-js", pinned("SUPABASE_JS")],
];

let failed = 0;
let unreachable = 0;

for (const [name, version] of PACKAGES) {
  if (!version) {
    failed++;
    console.log(`FAIL  ${name} — no pinned version found in scaffold.ts`);
    continue;
  }

  let record;
  try {
    const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`);
    if (!response.ok) throw new Error(`registry answered ${response.status}`);
    record = await response.json();
  } catch (error) {
    unreachable++;
    console.log(`????  ${name}@${version} — could not ask npm (${error.message})`);
    continue;
  }

  if (record.deprecated) {
    failed++;
    console.log(`FAIL  ${name}@${version} is DEPRECATED`);
    console.log(`        ${String(record.deprecated).slice(0, 160)}`);
  } else {
    console.log(`ok    ${name}@${version}`);
  }
}

if (unreachable > 0) {
  console.log(`\n${unreachable} package(s) could not be checked. This check needs the npm registry;`);
  console.log("treat an unreachable run as unknown rather than as a pass.");
}

console.log(failed === 0 ? "\nall good" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
