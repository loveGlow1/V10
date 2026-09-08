#!/usr/bin/env node
/* The context engine does what it says.
 *
 *   npm run check:context
 *
 * Everything this checks is a rule that is only ever wrong at the worst
 * moment: a window that is not the model's, an input that leaves no room for
 * the reply, a reduction that quietly drops the one sentence that mattered.
 * None of those throw. They produce a slightly worse page, or a 400 in
 * production on the one message that was long enough.
 *
 * No keys, no network, no model calls.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-context");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, types: ["node"],
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [
      join(process.cwd(), "src/lib/context/budget.ts"),
      join(process.cwd(), "src/lib/context/layers.ts"),
      join(process.cwd(), "src/lib/context/compress.ts"),
      join(process.cwd(), "src/lib/context/fit.ts"),
      join(process.cwd(), "src/lib/context/requests.ts"),
    ],
  }),
);

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));
const is = (got, want, t) => (got === want ? ok(t, String(got)) : fail(t, `expected ${want}, got ${got}`));

try {
  execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

  const rewrite = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { rewrite(path); continue; }
      if (!path.endsWith(".js")) continue;
      const depth = path.slice(out.length + 1).split("/").length - 1;
      const prefix = depth === 0 ? "./" : "../".repeat(depth);
      const source = readFileSync(path, "utf8")
        .replace(/(["'])@\/([^"']+)\1/g, (_, q, rest) => {
          const asFile = join(out, `${rest}.js`);
          const target = existsSync(asFile) ? `${rest}.js` : `${rest}/index.js`;
          return `${q}${prefix}${target}${q}`;
        })
        /* tsc emits extensionless relative specifiers and Node's ESM loader
           will not resolve them. Only the sibling imports inside this module
           need it, and they are all "./name". */
        .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (whole, head, spec, tail) =>
          /\.(js|json)$/.test(spec) ? whole : `${head}${spec}.js${tail}`);
      writeFileSync(path, source);
    }
  };
  rewrite(out);

  const budget = await import(join(out, "lib/context/budget.js"));
  const layers = await import(join(out, "lib/context/layers.js"));
  const compress = await import(join(out, "lib/context/compress.js"));
  const fit = await import(join(out, "lib/context/fit.js"));
  const requests = await import(join(out, "lib/context/requests.js"));

  /* ── Every model this app can call knows how much it can hold ───────────
   *
   * The failure this prevents: a model switched on with no window, budgeted at
   * the fallback, and either refusing work it could have done or — if the
   * fallback were ever raised — sending a request it cannot take. */
  for (const model of budget.callableModels()) {
    has(
      typeof model.contextWindow === "number" && model.contextWindow > 0,
      `${model.name} declares a context window`,
      `add contextWindow to ${model.id} in src/app/dashboard/models.ts`,
    );
    has(
      (model.maxOutput ?? 0) < (model.contextWindow ?? 0),
      `${model.name}'s output ceiling fits inside its window`,
      "a model that may write more than it can hold cannot answer its own prompt",
    );
  }

  // ── Nothing ever gets the whole window ──────────────────────────────────
  for (const id of ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"]) {
    for (const kind of ["build", "edit", "answer", "classify"]) {
      const plan = budget.budgetFor({ modelId: id, kind });
      has(
        plan.usableInput < plan.window,
        `${id}/${kind} leaves room for the reply`,
        `usable input ${plan.usableInput} against a window of ${plan.window}`,
      );
      has(
        plan.reservedOutput >= 1_000,
        `${id}/${kind} reserves a usable amount of output`,
        `${plan.reservedOutput}`,
      );
    }
  }

  /* A build reserves more than an edit, because a build's output IS the page.
     If this ever inverts, a full build starts arriving without its closing tag
     again — the failure that set maxOutput in the first place. */
  has(
    budget.budgetFor({ modelId: "claude-sonnet-5", kind: "build" }).reservedOutput >
      budget.budgetFor({ modelId: "claude-sonnet-5", kind: "edit" }).reservedOutput,
    "a build reserves more output than an edit",
  );

  /* An unknown model is budgeted as the smallest real window, never as the
     largest. Wrong in the cautious direction is a wasted window; wrong the
     other way is a rejected request. */
  is(budget.contextWindowFor("something-nobody-added"), 200_000, "an unknown model gets the cautious window");
  is(budget.contextWindowFor(null), 200_000, "and so does no model at all");

  // ── Images are never free ───────────────────────────────────────────────
  has(budget.imageTokens(1) > 1_000, "one image costs more than a thousand tokens", `${budget.imageTokens(1)}`);
  has(budget.imageTokens(4) === budget.imageTokens(1) * 4, "four images cost four times one");
  has(
    budget.budgetFor({ modelId: "claude-haiku-4-5", kind: "edit", images: 4 }).usableInput <
      budget.budgetFor({ modelId: "claude-haiku-4-5", kind: "edit" }).usableInput,
    "attachments come out of the same window as the text",
    "this is the accounting error that made a four-screenshot message look free",
  );

  /* The estimate must never come in UNDER the real count for markup, which is
     the largest thing this app sends. Four characters per token is the prose
     rule of thumb; HTML is denser, so the estimate has to be above that line. */
  const markup = '<div class="mx-auto flex max-w-5xl items-center gap-4">'.repeat(200);
  has(
    budget.estimateTokens(markup) > markup.length / 4,
    "markup is estimated above the prose rate",
    "an estimate under the true count is a 400 in production",
  );

  // ── Pressure rises before anything is refused ───────────────────────────
  const small = budget.budgetFor({ modelId: "claude-sonnet-5", kind: "edit" });
  const at = (share) => budget.pressureOf(Math.round(small.usableInput * share), small);
  is(at(0.1), "green", "a small request is green");
  is(at(0.7), "yellow", "a large one is yellow");
  is(at(0.95), "orange", "a nearly-full one is orange");
  is(at(1.5), "red", "and one that does not fit is red");

  /* ── Reduction is semantic, not positional ──────────────────────────────
   *
   * The property that matters, and the one no character cap has: a constraint
   * buried in the middle of a long brief survives, and the filler around it
   * does not. A head-first cut keeps the opening and loses the rule. */
  const filler = Array.from(
    { length: 60 },
    (_, i) => `We would like the site to feel modern and welcoming, paragraph ${i}, with plenty of whitespace and a friendly tone throughout the whole experience.`,
  );
  const brief = [
    "Build a storefront for a bakery.",
    ...filler.slice(0, 30),
    "Checkout must require sign-in before payment.",
    ...filler.slice(30),
    "The hero image should be a photograph of bread.",
  ].join("\n\n");

  const short = compress.condense(brief, 300);
  has(short.reduced, "a long brief is reduced");
  has(short.tokens <= 320, "to about the room it was given", `${short.tokens}`);
  has(
    short.text.includes("Checkout must require sign-in"),
    "and the constraint in the middle survives",
    "this is exactly what a first-N-words cut loses",
  );
  has(short.text.includes("bakery"), "the opening ask survives too");
  has(
    short.text.includes("omitted"),
    "and the gap says it is a gap",
    "a silently shortened text reads to the model as a complete one",
  );
  has(
    compress.condense(brief, 100_000).reduced === false,
    "something that already fits is returned untouched",
  );

  // ── The requirement ledger keeps the person's own words ─────────────────
  const requirements = compress.extractRequirements(brief);
  has(requirements.length > 0, "requirements are found in a brief", `${requirements.length}`);
  has(
    requirements.some((r) => r.text.includes("Checkout must require sign-in before payment.")),
    "verbatim, not paraphrased",
  );
  has(
    requirements.every((r) => brief.includes(r.text.replace(/\s+/g, " ").trim().slice(0, 30))),
    "every requirement traces back to the source text",
  );

  /* ── Priority, not position ─────────────────────────────────────────────
   *
   * The whole point of the layers. Old-but-critical beats new-but-incidental,
   * whatever order the caller happened to hand them over in. */
  const tiny = { modelId: "claude-haiku-4-5", kind: "edit", window: 200_000, reservedOutput: 24_000, fixed: 0, safety: 4_000, usableInput: 900 };
  const planned = fit.planContext(
    [
      { id: "history", layer: "history", text: "chat ".repeat(600) },
      { id: "page", layer: "target", text: "<main>page</main>", lossless: true },
      { id: "ask", layer: "request", text: "make the header darker" },
      { id: "design", layer: "design", text: "tokens ".repeat(400) },
    ],
    tiny,
    "edit",
  );
  const keptIds = planned.kept.map((item) => item.id);
  has(keptIds.includes("page") && keptIds.includes("ask"), "the request and its target are always sent");
  has(
    !keptIds.includes("history") || keptIds.indexOf("ask") < keptIds.indexOf("history"),
    "and older material is placed after them, or not at all",
  );
  has(planned.omitted.length > 0, "what did not fit is reported rather than vanishing");
  has(
    planned.omitted.every((item) => item.reason),
    "every omission carries a reason",
    "an omission with no reason is a bug report nobody can answer",
  );

  /* A lossless item is never summarised — it is deferred instead, whole, to be
     fetched when it is needed. A summarised schema is not a schema. */
  const withSchema = fit.planContext(
    [
      { id: "ask", layer: "request", text: "add a wishlist" },
      { id: "schema", layer: "architecture", text: "create table ".repeat(500), lossless: true, retrievable: true },
    ],
    tiny,
    "data-edit",
  );
  has(
    !withSchema.kept.some((item) => item.id === "schema" && item.condensed),
    "a lossless item is never condensed",
  );
  is(
    withSchema.omitted.find((item) => item.id === "schema")?.reason,
    "deferred",
    "it is deferred for retrieval instead",
  );

  /* Overflow is a decomposition signal, not a refusal. This is the difference
     between the product doing the work and the product asking the user to. */
  const impossible = fit.planContext(
    [{ id: "page", layer: "target", text: "x".repeat(4_000_000), lossless: true }],
    tiny,
    "edit",
  );
  has(impossible.overflow, "a target too large to hold is reported as overflow");

  // ── Task shape changes what gets the room ───────────────────────────────
  const forVisual = layers.priorityOf("visual", "visual-edit");
  const forData = layers.priorityOf("visual", "data-edit");
  has(forVisual < forData, "a screenshot outranks itself on a visual edit", `${forVisual} vs ${forData}`);
  has(
    layers.priorityOf("architecture", "data-edit") < layers.priorityOf("architecture", "build"),
    "and the schema outranks itself on a database change",
  );
  has(
    layers.priorityOf("request", "data-edit") === layers.priorityOf("request", "visual-edit"),
    "nothing can promote itself above the request",
  );

  /* ── A huge edit is restructured, never refused ─────────────────────────
   *
   * The behaviour the whole exercise is for. A 40,000-word instruction against
   * a real page used to be a sentence telling the person to try again with
   * less; it now arrives as a requirement ledger and fits. */
  /* Big enough to actually overflow Haiku's window once the page and the output
     reservation are taken out — roughly 200,000 tokens of prose wrapped around
     the same constraint. A fixture that merely LOOKS long tests nothing: at
     10,000 tokens the correct behaviour is to pass it through untouched, which
     is what the first version of this check was accidentally asserting. */
  const huge = [
    brief,
    ...Array.from(
      { length: 5_000 },
      (_, i) => `Additional descriptive paragraph number ${i} about tone, feel, and the general mood we are hoping the finished site manages to convey to a first-time visitor.`,
    ),
  ].join("\n\n");
  const fitted = requests.fitEdit({
    prompt: huge,
    pageHtml: "<html>".padEnd(40_000, "x") + "</html>",
    modelId: "claude-haiku-4-5",
  });
  has(!fitted.mustDecompose, "a very long instruction against a real page still runs");
  has(fitted.restructured, "by restructuring the instruction rather than cutting it");
  has(
    fitted.prompt.includes("Checkout must require sign-in before payment."),
    "with its constraints carried word for word",
  );
  has(
    budget.estimateTokens(fitted.prompt) < budget.estimateTokens(huge),
    "and it is genuinely smaller",
    `${budget.estimateTokens(fitted.prompt)} vs ${budget.estimateTokens(huge)}`,
  );

  /* An ordinary edit is untouched — the engine must be invisible in the case
     that was never in trouble, which is nearly every case. */
  const ordinary = requests.fitEdit({
    prompt: "make the header darker",
    pageHtml: "<html>".padEnd(40_000, "x") + "</html>",
    modelId: "claude-haiku-4-5",
  });
  has(!ordinary.restructured && !ordinary.mustDecompose, "an ordinary edit is passed through untouched");
  is(ordinary.prompt, "make the header darker", "exactly as typed");

  /* And the one case that genuinely cannot be done in a call is still caught:
     a page that fills the window on its own. */
  const enormous = requests.fitEdit({
    prompt: "make the header darker",
    pageHtml: "x".repeat(3_000_000),
    modelId: "claude-haiku-4-5",
  });
  has(enormous.mustDecompose, "a page bigger than the window is reported, not attempted");

  /* A build brief gets the same treatment against a much smaller input budget,
     because a build reserves its whole output ceiling. */
  const built = requests.fitBrief({ brief: huge, modelId: "claude-haiku-4-5" });
  has(built.requirements.length > 0, "a build brief keeps its requirements", `${built.requirements.length}`);

  if (failed) {
    console.log(`\n${failed} check${failed === 1 ? "" : "s"} failed.`);
    process.exit(1);
  }
  console.log("\nAll passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
