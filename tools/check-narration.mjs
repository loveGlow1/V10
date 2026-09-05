#!/usr/bin/env node
/* Checks the line the tracker shows while Claude is thinking.
 *
 *   npm run check:narration
 *
 * The reasoning arrives as a stream of deltas, so at any instant the text in
 * hand ends mid-word about as often as it ends on a full stop. lastSentence is
 * what decides which part of that is fit to put on screen, and it has one rule
 * worth protecting: never show the fragment being written. A half-sentence
 * growing a word at a time is a typing effect, and a typing effect is exactly
 * the theatre this narration replaced.
 *
 * Offline and free — it is string handling, not a model call. tools/check-
 * builder.mjs is where a real request is made.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/* edit.ts imports the Anthropic SDK at the top, so it is compiled rather than
   read. Built under node_modules/.cache for the same reason check-intent.mjs
   is: the compiled file keeps that import, and node resolves it by walking up
   from the file. */
const out = join(process.cwd(), "node_modules", ".cache", "quickstark-narration");
mkdirSync(out, { recursive: true });

/* A tsconfig rather than command-line flags, which is what broke this.
 *
 * edit.ts imports @/app/dashboard/models, and `tsc file.ts` with flags cannot
 * see that: --paths is not a command-line option, so the alias resolves against
 * nothing and the compile fails on an import that has nothing to do with the
 * one function being checked. The same shape as check-credits.mjs and
 * check-reconcile.mjs, which reach across the same boundary. */
const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".",
      rootDir: join(process.cwd(), "src"),
      /* CommonJS, unlike check-intent.mjs: edit.ts imports its neighbours by
         relative path, and tsc emits those without the ".js" an ESM loader
         insists on. require() resolves them the way tsc wrote them. */
      module: "commonjs",
      target: "es2022",
      moduleResolution: "node",
      skipLibCheck: true,
      /* The imports pulled in along the way are typed for the DOM and for
         React; none of that is exercised here, and asking a bare tsc to prove
         it would fail on JSX rather than on anything this checks. */
      noEmitOnError: false,
      jsx: "react-jsx",
      types: ["node"],
      baseUrl: process.cwd(),
      paths: { "@/*": ["src/*"] },
    },
    files: [join(process.cwd(), "src/lib/builder/edit.ts")],
  }),
);

/* Errors are reported and the emit is used anyway. The @/ import resolves for
   TYPES here but the emitted require() still says "@/app/dashboard/models",
   which node cannot resolve — the rewrite below is what fixes that, and it can
   only run on files that exist. A type error somewhere in the graph must not
   stop a pure string function from being checked. */
try {
  execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });
} catch {
  /* Reported above by tsc itself. */
}

/* @/x → the relative path to x, in whatever the emit put on disk. tsc rewrites
   nothing about a specifier it resolved through paths, so this is the step that
   makes the compiled output actually runnable. */
const rewrite = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      rewrite(path);
      continue;
    }
    if (!path.endsWith(".js")) continue;

    const depth = path.slice(out.length + 1).split("/").length - 1;
    const prefix = depth === 0 ? "./" : "../".repeat(depth);

    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(/(["'])@\/([^"']+)\1/g, (_, quote, rest) => {
        const asFile = join(out, `${rest}.js`);
        const target = existsSync(asFile) ? rest : `${rest}/index`;
        return `${quote}${prefix}${target}${quote}`;
      }),
    );
  }
};
rewrite(out);

const { lastSentence } = createRequire(import.meta.url)(join(out, "lib/builder/edit.js"));

const CASES = [
  ["", null, "nothing yet"],
  ["The user wants the header", null, "one unfinished sentence is not shown"],
  ["The user wants the header darker.", "The user wants the header darker.", "one finished sentence"],
  [
    "The user wants the header darker. I need to find the",
    "The user wants the header darker.",
    "the fragment being written is dropped",
  ],
  [
    "The user wants the header darker. I'll look for the nav element.",
    "I'll look for the nav element.",
    "the newest finished sentence wins",
  ],
  [
    "Found it. Now I'll write the replacement!",
    "Now I'll write the replacement!",
    "an exclamation ends a sentence too",
  ],
  [
    "Is the hero the right target? Probably not",
    "Is the hero the right target?",
    "a question ends a sentence too",
  ],
  [
    "Line one.\n\n  Line two.",
    "Line two.",
    "newlines and runs of spaces collapse",
  ],
  [
    `${"x".repeat(400)}.`,
    `${"x".repeat(157)}…`,
    "a long sentence is cut to one line",
  ],
];

let failed = 0;
for (const [input, want, why] of CASES) {
  const got = lastSentence(input);
  if (got === want) {
    console.log(`  ok   ${why}`);
  } else {
    failed++;
    console.log(`  FAIL ${why}`);
    console.log(`         want: ${JSON.stringify(want)}`);
    console.log(`         got:  ${JSON.stringify(got)}`);
  }
}

console.log("");
if (failed > 0) {
  console.log(`${failed} of ${CASES.length} failed.`);
  process.exit(1);
}
console.log(`All ${CASES.length} passed.`);
