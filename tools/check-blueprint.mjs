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
  const { composeBuildPrompt, BLUEPRINTS } = await import(
    join(out, "lib/builder/blueprints/index.js")
  );

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
     writes, and a blueprint emptied of a field loses one. */
  const FRAME = [
    "WHAT THIS IS:",
    "BUILD THESE, IN THIS ORDER:",
    "REQUIRED ONLY WHEN THE BRIEF CALLS FOR IT",
    "THIS HAS TO WORK, NOT BE DEPICTED:",
    "NOT PART OF THIS BUILD",
    "HOW MUCH",
    "THE STANDARD FOR THIS KIND:",
    "DONE MEANS:",
    "THE BRIEF",
    "THE BAR",
    "THE INTERACTION RULE",
    "THE SECTION DEPTH RULE",
    "CONTENT GOES IN THE HTML",
    "FINISHING",
  ];

  /* The separations that were actually being got wrong, asserted as words that
     must appear in the exclusions. Each pair is one production complaint. */
  const SEPARATION = {
    landing: ["cart", "checkout", "sign-in wall", "blog index", "admin dashboard"],
    ecommerce: ["sign-in wall", "admin dashboard", "inventory back office", "blog"],
    blog: ["pricing table", "pricing tiers", "cart", "checkout", "marketing hero"],
    webapp: ["marketing hero", "storefront", "fake dashboard"],
  };

  /* One brief, used for every kind, so the composed prompts differ only by
     blueprint. It is deliberately a real sentence: a prompt that only holds
     together around a placeholder is not being checked. */
  const BRIEF = "Build something for Harbour & Vine, a small business in Bristol.";

  for (const kind of BUILD_KINDS) {
    const blueprint = BLUEPRINTS[kind];

    /* The contract before the prose. Every field carries a floor, because an
       emptied array still composes a prompt — one with a heading and nothing
       under it, which is exactly the thin output this whole thing exists to
       stop. */
    const empty = [
      ["identity", blueprint.identity.length > 40],
      ["requirements", blueprint.requirements.length >= blueprint.depth.minimumSections],
      ["interactions", blueprint.interactions.length >= 3],
      ["exclusions", blueprint.exclusions.length >= 3],
      ["qualityRules", blueprint.qualityRules.length >= 3],
      ["completionRules", blueprint.completionRules.length >= 2],
      ["depth.floors", blueprint.depth.floors.length >= 3],
      ["conditionalRequirements", blueprint.conditionalRequirements.length >= 3],
      ["kind matches its file", blueprint.kind === kind],
    ]
      .filter(([, ok]) => !ok)
      .map(([field]) => field);

    if (empty.length > 0) {
      fail(`${kind}: the blueprint no longer meets its own contract`, empty.join(", "));
      continue;
    }

    /* Conditional requirements are the field that keeps a calculator from
       being handed a CRM's back end, and they only work if each one states
       what brings it in. */
    const shapeless = blueprint.conditionalRequirements.filter(
      (rule) => !rule.when || !rule.require || rule.when.length < 15 || rule.require.length < 15,
    );
    if (shapeless.length > 0) {
      fail(`${kind}: a conditional requirement has no condition or no requirement`);
      continue;
    }

    const prompt = composeBuildPrompt(kind, BRIEF, { projectName: "Harbour & Vine" });
    const missing = FRAME.filter((heading) => !prompt.includes(heading));
    if (missing.length > 0) {
      fail(`${kind}: the composed prompt lost part of its frame`, missing.join(", "));
      continue;
    }

    if (!prompt.includes(BRIEF)) {
      fail(`${kind}: the brief did not reach the composed prompt`);
      continue;
    }

    /* The prompt's own spelling is an instruction about the output's spelling,
       so a British form left in one is a British form that leaks into the
       page. The locale section is exempt because it names both sides on
       purpose — it is the rule, not a violation of it. */
    const withoutLocale =
      prompt.slice(0, prompt.indexOf("WHERE THIS IS SET")) +
      prompt.slice(prompt.indexOf("THE BAR"));
    const anglicised = ["catalogue", "colour", "licence number", "postcode", "fulfilment", "cheque"].filter(
      (word) => withoutLocale.toLowerCase().includes(word),
    );
    if (anglicised.length > 0) {
      fail(`${kind}: the prompt still spells the output British`, anglicised.join(", "));
      continue;
    }

    if (!prompt.includes("the build is American")) {
      fail(`${kind}: the composed prompt lost its locale default`);
      continue;
    }

    const excludes = prompt.slice(
      prompt.indexOf("NOT PART OF THIS BUILD"),
      prompt.indexOf("HOW MUCH"),
    );
    const unsaid = SEPARATION[kind].filter(
      (word) => !excludes.toLowerCase().includes(word.toLowerCase()),
    );
    if (unsaid.length > 0) {
      fail(`${kind}: stopped excluding another kind's furniture`, unsaid.join(", "));
      continue;
    }

    /* Long enough to be a blueprint rather than a sentence, short enough to
       leave the model room to answer with a whole document.

       The ceiling is 3000 rather than the 2600 it started at. The web app
       blueprint carries eight conditional requirements — the field that keeps
       a calculator from being handed a CRM's back end — and each one costs
       forty words it earns. Three thousand words is around four thousand
       tokens of system prompt against a document of twenty thousand, which is
       not what crowds anything out; the guard is here to catch a blueprint
       that has doubled by accident, not to price the good ones out. */
    const words = prompt.split(/\s+/).length;
    if (words < 500) fail(`${kind}: the prompt is ${words} words, which is too thin to be a blueprint`);
    else if (words > 3000) fail(`${kind}: the prompt is ${words} words, which crowds out the build`);
    else
      console.log(
        `ok   ${kind.padEnd(10)} ${String(words).padStart(4)} words · ${
          blueprint.requirements.length
        } required · ${blueprint.conditionalRequirements.length} conditional · ${
          blueprint.exclusions.length
        } excluded · min ${blueprint.depth.minimumSections}`,
      );
  }

  if (failed > 0) {
    console.log("\nA wrong answer means the rules changed meaning, not just coverage.");
    process.exit(1);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
