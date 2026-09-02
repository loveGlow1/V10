#!/usr/bin/env node
/* Checks the build-kind classifier against the labelled corpus, and checks that
 * every kind still composes a prompt that says what it must.
 *
 *   npm run check:blueprint
 *
 * Two things, because two things can quietly break.
 *
 * The first is routing. Only the free pass is measured: heuristicKind decides
 * without a network call, so this runs offline, costs nothing, and can be run on
 * every change — which is the point, because those rules are regexes, and a
 * regex widened to catch one brief quietly catches three others. A wrong answer
 * fails the run; a deferral does not, because handing an ambiguous brief to the
 * model is the designed behaviour. The model half is deliberately not exercised
 * here: it needs a key, bills a request per brief, and is not deterministic.
 *
 * The second is the prompts themselves. A blueprint is prose, and prose has no
 * type checker — a section list can be emptied, an exclusion can be deleted, and
 * nothing anywhere would fail. So each composed prompt is asserted to still
 * carry its structure and, for the pairs that actually got confused in
 * production, to still exclude the other kind's furniture by name.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SETS } from "./blueprint-corpus.mjs";

/* Compiled rather than imported: the heuristics and the blueprints are
   TypeScript and this is a plain node script. Built under node_modules/.cache
   so that node's module resolution still finds the project's packages by
   walking up from the compiled file. */
const out = join(process.cwd(), "node_modules", ".cache", "quickstark-blueprint");
mkdirSync(out, { recursive: true });

/* A tsconfig of its own, written next to the output. `paths` is the reason:
   tsc refuses it on the command line, and the blueprints import each other by
   "@/…" exactly as the app does. Extending the project's config would drag in
   Next's JSX and DOM settings for two files that need neither. */
const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".",
      rootDir: join(process.cwd(), "src"),
      module: "esnext",
      target: "es2022",
      moduleResolution: "bundler",
      skipLibCheck: true,
      baseUrl: process.cwd(),
      paths: { "@/*": ["src/*"] },
    },
    files: [
      join(process.cwd(), "src/lib/builder/kinds.ts"),
      join(process.cwd(), "src/lib/builder/blueprints/index.ts"),
    ],
  }),
);

let failed = 0;

function fail(text, detail) {
  failed++;
  console.log(`FAIL ${text}${detail ? `\n       ${detail}` : ""}`);
}

try {
  execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

  /* tsc leaves the "@/" specifiers in the emitted JavaScript, so they are
     rewritten to relative paths before node is asked to load any of it. */
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
        readFileSync(path, "utf8").replace(/(["'])@\/([^"']+)\1/g, (_, quote, rest) =>
          `${quote}${prefix}${rest}.js${quote}`,
        ),
      );
    }
  };
  rewrite(out);

  const { heuristicKind, BUILD_KINDS } = await import(join(out, "lib/builder/kinds.js"));
  const { composeBuildPrompt } = await import(join(out, "lib/builder/blueprints/index.js"));

  /* ── Routing ─────────────────────────────────────────────────────────── */
  let totalCases = 0;
  let totalDeferred = 0;

  for (const [name, set] of Object.entries(SETS)) {
    let right = 0;
    let wrong = 0;
    let deferred = 0;
    const misses = [];

    for (const [brief, want] of set) {
      const got = heuristicKind(brief);
      if (got === null) {
        deferred++;
        continue;
      }
      if (got.kind === want) right++;
      else {
        wrong++;
        misses.push({ brief, want, got: got.kind });
      }
    }

    totalCases += set.length;
    totalDeferred += deferred;
    failed += wrong;

    const verdict = wrong === 0 ? "ok  " : "FAIL";
    console.log(
      `${verdict} ${name.padEnd(7)} n=${String(set.length).padStart(3)}  correct ${String(right).padStart(3)}  wrong ${String(wrong).padStart(2)}  to the model ${deferred}`,
    );
    for (const miss of misses) {
      console.log(`       want ${miss.want.padEnd(10)} got ${miss.got.padEnd(10)} ${miss.brief}`);
    }
  }

  const deferralRate = ((totalDeferred / totalCases) * 100).toFixed(0);
  console.log(
    `\n${totalCases} briefs · ${totalDeferred} handed to the model (${deferralRate}%)`,
  );

  /* ── The prompts ─────────────────────────────────────────────────────── */
  console.log("");

  /* Every prompt has to keep its frame. These are the headings composition
     writes, and a blueprint emptied of sections or exclusions loses one. */
  const FRAME = [
    "WHAT THIS IS:",
    "BUILD THESE, IN THIS ORDER:",
    "THIS HAS TO WORK, NOT BE DEPICTED:",
    "NOT PART OF THIS BUILD",
    "HOW MUCH:",
    "THE BAR",
    "OUTPUT FORMAT",
    "CONTENT GOES IN THE HTML",
  ];

  /* The separations that were actually being got wrong, asserted as words that
     must appear in the exclusions. Each pair is one production complaint. */
  const SEPARATION = {
    landing: ["cart", "checkout", "sign-in", "blog index", "admin"],
    ecommerce: ["dashboard", "blog"],
    blog: ["cart", "checkout", "pricing tiers", "dashboard"],
    webapp: ["hero", "cart", "blog"],
  };

  for (const kind of BUILD_KINDS) {
    const prompt = composeBuildPrompt(kind);
    const missing = FRAME.filter((heading) => !prompt.includes(heading));
    if (missing.length > 0) {
      fail(`${kind}: the composed prompt lost part of its frame`, missing.join(", "));
      continue;
    }

    const excludes = prompt.slice(
      prompt.indexOf("NOT PART OF THIS BUILD"),
      prompt.indexOf("HOW MUCH:"),
    );
    const unsaid = SEPARATION[kind].filter(
      (word) => !excludes.toLowerCase().includes(word.toLowerCase()),
    );
    if (unsaid.length > 0) {
      fail(`${kind}: stopped excluding another kind's furniture`, unsaid.join(", "));
      continue;
    }

    /* Long enough to be a blueprint rather than a sentence, short enough to
       leave the model room to answer with a whole document. */
    const words = prompt.split(/\s+/).length;
    if (words < 400) fail(`${kind}: the prompt is ${words} words, which is too thin to be a blueprint`);
    else if (words > 2200) fail(`${kind}: the prompt is ${words} words, which crowds out the page`);
    else console.log(`ok   ${kind.padEnd(10)} ${words} words, frame intact, exclusions in place`);
  }

  if (failed > 0) {
    console.log("\nA wrong answer means the rules changed meaning, not just coverage.");
    process.exit(1);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
