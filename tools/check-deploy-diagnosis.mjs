#!/usr/bin/env node
/* A build log, turned into something a person can act on.
 *
 *   npm run check:deploy-diagnosis
 *
 * The property being defended is narrow and easy to lose: the SUMMARY is for
 * somebody who typed a sentence about a bakery, and the LOG is for whoever
 * built this platform. Both are kept; they do not get to swap places.
 *
 * So the tests below assert the separation as much as the matching — that a
 * summary never quotes a stack trace, that the log survives verbatim, and that
 * a failure this file does not recognise says so instead of inventing a cause.
 * The last one matters most: a confident wrong diagnosis is worse than the raw
 * text, which at least does not mislead.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-deploy-diagnosis");
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
      include: [join(root, "src/lib/publish/diagnosis.ts")],
    },
    null,
    2,
  ),
);
try {
  execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { stdio: ["ignore", "ignore", "pipe"] });
} catch {}
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));

const require = createRequire(import.meta.url);
const { diagnose, diagnoseFindings } = require(join(out, "lib/publish/diagnosis.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

/* The log from the failure this whole change is about, near enough to the
   byte. */
const REAL_LOG = `Running build in Washington, D.C., USA (East) – iad1
Cloning github.com/quickstark/nova-estates (Branch: main, Commit: 9f21c0e)
Installing dependencies...
added 312 packages in 14s
▲ Next.js 15.5.25
   Creating an optimized production build ...
 ✓ Compiled successfully in 11.3s
   Linting and checking validity of types ...
Failed to compile.

./app/admin/page.tsx:3:18
Type error: Page "app/admin/page.tsx" does not match the required types of a Next.js Page.
  "AdminNav" is not a valid Page export field.

Error: Command "next build" exited with 1`;

{
  const d = diagnose(REAL_LOG);
  has(Boolean(d), "a real failed build produces a diagnosis");
  has(d.headline === "Deployment needs attention", "the heading names the state", d.headline);
  has(
    d.summary.includes("reusable piece of one page"),
    "the specific cause beats the generic type error",
    d.summary,
  );
  has(d.automatic, "and it is one QuickStark can fix by itself");
  has(d.file === "app/admin/page.tsx", "the file is pulled out of the log", String(d.file));

  /* The separation, which is the point of the whole file. */
  has(!/Type error|next build|exited with 1/i.test(d.summary), "the summary quotes no build output", d.summary);
  has(!d.summary.includes("app/admin/page.tsx"), "the summary names no file — that has its own field", d.summary);
  has(d.detail === REAL_LOG.trim(), "the log survives verbatim for the technical panel");
  has(d.detail.includes("Command \"next build\" exited with 1"), "including the last line of it");
}

/* ── Specific before general ────────────────────────────────────────────── */

{
  const d = diagnose('./app/[slug]/page.tsx\nType error: Page "app/[slug]/page.tsx" cannot use both "use client" and export function "generateStaticParams()".');
  has(d.summary.includes("interactive and pre-built"), "the client/static conflict is recognised", d.summary);
  has(d.automatic, "and is automatically fixable");
}

{
  const d = diagnose("Failed to compile.\n./lib/data.ts:2:1\nType error: Type 'string' is not assignable to type 'number'.");
  has(d.summary.includes("does not quite typecheck"), "an ordinary type error falls through to the general case", d.summary);
  has(!d.automatic, "and is not claimed to be automatically fixable");
  has(d.file === "lib/data.ts", "its file is still extracted", String(d.file));
}

{
  const d = diagnose("Module not found: Can't resolve '@/components/Hero'");
  has(d.summary.includes("imports another that is not in the project"), "a missing module is recognised", d.summary);
}

{
  const d = diagnose("npm error ERESOLVE could not resolve\nnpm error Conflicting peer dependency: react@18.3.1");
  has(d.summary.includes("packages could not be installed"), "an install failure is recognised", d.summary);
}

{
  const d = diagnose("<FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory");
  has(d.summary.includes("too large to compile"), "running out of memory is recognised", d.summary);
}

/* ── The build worked and the site is fine ──────────────────────────────── */

{
  const d = diagnose("The address answers with 401 Authentication Required — Deployment Protection is on for this project.");
  has(d.summary.includes("built and is running"), "protection is not reported as a broken build", d.summary);
  has(!d.automatic, "and is not something this platform can switch off itself");
  has(d.next.includes("Vercel dashboard"), "the fix names where it is done", d.next);
}

{
  const d = diagnose("this deployment has no VERCEL_API_TOKEN, so it cannot build projects");
  has(d.summary.includes("not switched on"), "a missing token is a configuration state, not a project fault", d.summary);
  has(d.next.includes("administrator"), "and is addressed to whoever can fix it", d.next);
}

{
  const d = diagnose("the build is taking longer than expected and is still running");
  has(d.headline === "Still publishing", "a build still running is not a failure", d.headline);
}

/* ── Not knowing, honestly ──────────────────────────────────────────────── */

{
  const strange = "Error: the flux capacitor reported code 88\n  at Object.<anonymous> (/vercel/path0/x.js:1:1)";
  const d = diagnose(strange);
  has(Boolean(d), "an unrecognised failure still produces a diagnosis");
  has(d.summary.includes("found a problem"), "it says a problem was found", d.summary);
  has(!d.automatic, "it never claims it can fix what it does not recognise");
  has(d.next.includes("still works in the preview"), "it says the project is still there", d.next);
  has(d.detail === strange, "and hands over the whole log unchanged");
  has(
    !/flux capacitor/i.test(d.summary),
    "it does not parrot the log into the summary and call that an explanation",
    d.summary,
  );
}

has(diagnose(null) === null, "no failure is no diagnosis");
has(diagnose("") === null, "an empty failure is no diagnosis");
has(diagnose("   \n  ") === null, "and neither is whitespace");

/* ── Findings caught before the upload ──────────────────────────────────── */

{
  const d = diagnoseFindings([
    {
      file: "app/admin/page.tsx",
      problem: "AdminNav is a component living inside the page for admin. It belongs in its own file.",
      detail: 'Type error: "AdminNav" is not a valid Page export field.',
      repairable: true,
    },
  ]);
  has(d.headline === "Deployment needs attention", "a pre-flight finding reads as the same state as a failure");
  has(d.summary.startsWith("AdminNav is a component"), "it uses the finding's own sentence", d.summary);
  has(d.automatic, "a repairable finding offers the automatic fix");
  has(d.detail.includes("not a valid Page export field"), "the framework wording is kept in the detail");
}

{
  const d = diagnoseFindings([
    { file: "a/page.tsx", problem: "One.", detail: "d1", repairable: true },
    { file: "b/page.tsx", problem: "Two.", detail: "d2", repairable: false },
  ]);
  has(d.summary.includes("1 other thing"), "more than one finding is counted, not listed", d.summary);
  has(!d.automatic, "and the automatic fix is only offered when every finding is repairable");
  has(d.detail.includes("d1") && d.detail.includes("d2"), "every finding's detail is kept");
}

has(diagnoseFindings([]) === null, "no findings is no diagnosis");

console.log(failed === 0 ? "\nAll deployment diagnosis checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
