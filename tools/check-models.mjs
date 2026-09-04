#!/usr/bin/env node
/* Every model the picker offers can actually be called.
 *
 *   npm run check:models
 *
 * The failure this exists for is the one the app shipped with for weeks: the
 * composer offered nine models across three makers, and every build ran on
 * Opus regardless, because the picker's state was never sent anywhere. Nothing
 * threw. Nothing looked wrong. The chip said "Gemini 3 Pro" and Anthropic was
 * billed.
 *
 * So this checks the two halves that silence can hide. First, that every
 * offered model carries the facts needed to call it — a wire id and a token
 * ceiling — because a model with a label and nothing else is exactly what that
 * bug looked like. Second, that each provider's request body is shaped the way
 * that provider's API actually reads it: all three take a system prompt, a user
 * message and images, and all three spell every one of those differently. Put
 * `max_tokens` in an OpenAI body and it is a 400; put `system` in a Google body
 * and the blueprint is silently dropped and the page comes back generic.
 *
 * No keys, no network. The request is built and inspected, never sent.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-models");
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
      join(process.cwd(), "src/lib/builder/model-request.ts"),
      join(process.cwd(), "src/app/dashboard/models.ts"),
    ],
  }),
);

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const is = (got, want, t) => (got === want ? ok(t, String(got)) : fail(t, `expected ${want}, got ${got}`));
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

try {
  execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

  const rewrite = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { rewrite(path); continue; }
      if (!path.endsWith(".js")) continue;
      const depth = path.slice(out.length + 1).split("/").length - 1;
      const prefix = depth === 0 ? "./" : "../".repeat(depth);
      writeFileSync(path, readFileSync(path, "utf8").replace(
        /(["'])@\/([^"']+)\1/g, (_, q, rest) => {
          const asFile = join(out, `${rest}.js`);
          const target = existsSync(asFile) ? `${rest}.js` : `${rest}/index.js`;
          return `${q}${prefix}${target}${q}`;
        }));
    }
  };
  rewrite(out);

  const models = await import(join(out, "app/dashboard/models.js"));
  const wire = await import(join(out, "lib/builder/model-request.js"));

  const SYSTEM = "SYSTEM-PROMPT-MARKER";
  const USER = "USER-MESSAGE-MARKER";
  const IMAGES = [{ url: "https://example.test/a.png" }];

  // ── Every offered model is callable ─────────────────────────────────────
  const callable = models.callableModels();
  has(callable.length > 0, "the picker offers something to call", "callableModels() is empty");

  for (const model of callable) {
    has(
      Boolean(model.apiId) && Boolean(model.maxOutput),
      `${model.name} carries its API facts`,
      "apiId and maxOutput are what turn a label into a callable model",
    );
    /* 30,704 output tokens is what one real landing page took (n8n execution
       307). A ceiling under that truncates the document mid-page, which is how
       six builds died on 2026-08-30 against 16k. Only the deliberately-small
       models are allowed to sit lower. */
    if (model.maxOutput && model.maxOutput < 32000 && !/nano|lite/i.test(model.id)) {
      fail(`${model.name} can finish a page`, `maxOutput ${model.maxOutput} is under the ~31k a full page needs`);
    }
  }

  // ── Auto ────────────────────────────────────────────────────────────────
  const auto = models.resolveModel("auto");
  has(auto !== null, "Auto resolves to a real model", "resolveModel('auto') returned null");
  is(auto?.id, models.AUTO_MODEL, "Auto resolves to AUTO_MODEL");
  is(models.resolveModel(undefined), null, "no model at all is not silently accepted");
  is(models.resolveModel("gpt-9-ultra"), null, "a model this app does not offer is refused");
  is(models.resolveModel(""), null, "an empty string is refused");

  /* ── Availability ───────────────────────────────────────────────────────
     A model with no working credential is refused by the resolver as well as
     greyed in the picker: the picker is a courtesy, this is the rule. The
     shape tests below deliberately go through modelById instead, because how
     a request is BUILT for a vendor does not stop being worth checking while
     that vendor's key is missing. */
  for (const model of models.MODELS.filter((entry) => entry.provider !== "auto")) {
    const resolved = models.resolveModel(model.id);
    if (models.isModelAvailable(model)) {
      has(resolved !== null, `${model.name} is offered and resolves`, "resolveModel returned null");
    } else {
      is(resolved, null, `${model.name} is unavailable and is refused`);
    }
  }
  has(
    models.MODELS.some((entry) => entry.provider === "claude" && models.isModelAvailable(entry)),
    "at least one model is actually callable",
    "every model is marked unavailable — the picker would be entirely dead",
  );

  /* ── The credit rate ────────────────────────────────────────────────────
     A model somebody switches on without a multiplier is priced as though it
     were the default, which sells the dearest thing at the cheapest price and
     does it silently. Caught here rather than on the bill. */
  for (const model of models.MODELS.filter(
    (entry) => entry.provider !== "auto" && models.isModelAvailable(entry),
  )) {
    has(
      typeof model.creditMultiplier === "number" && model.creditMultiplier > 0,
      `${model.name} carries a credit multiplier`,
      "available with no creditMultiplier — it would be charged at the default rate",
    );
  }
  is(models.creditMultiplierFor(models.AUTO_MODEL), 1, "the default model is the anchor at 1");
  is(models.creditMultiplierFor("auto"), 1, "Auto prices as the model it resolves to");
  is(models.creditMultiplierFor("nonsense"), 1, "an unknown model falls back to the default rate");
  has(
    models.creditMultiplierFor("claude-fable-5") > models.creditMultiplierFor("claude-opus-5"),
    "Fable costs more than Opus",
    "Fable is meant to be the dearest thing on the menu",
  );
  has(
    models.creditMultiplierFor("claude-opus-5") > models.creditMultiplierFor(models.AUTO_MODEL),
    "Opus costs more than the default",
    "picking Opus has to cost more than not picking it",
  );
  /* The whole ladder, in order, rather than a pair at a time: the default has
     moved twice and each move re-anchors every other number. */
  const ladder = ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5", "claude-fable-5"];
  for (let i = 1; i < ladder.length; i += 1) {
    has(
      models.creditMultiplierFor(ladder[i]) > models.creditMultiplierFor(ladder[i - 1]),
      `${ladder[i]} costs more than ${ladder[i - 1]}`,
      "the ladder has to climb: cheapest model, cheapest price",
    );
  }
  is(
    models.creditMultiplierFor(ladder[0]),
    1,
    "the cheapest model is the anchor",
  );

  /* ── Reasoning fields go only to models that take them ──────────────────
     Haiku 4.5 predates adaptive thinking and answers output_config.effort with
     a 400 rather than ignoring it. Sending one body to every model is how the
     default becomes an outage. */
  for (const model of models.MODELS.filter((entry) => entry.provider === "claude")) {
    const body = wire.generationRequest(model, SYSTEM, USER).body;
    const sent = "thinking" in body || "output_config" in body;
    if (model.reasoning === "none") {
      has(!sent, `${model.name} is sent no thinking or effort`, "this model 400s on output_config");
    } else {
      has(sent, `${model.name} is sent adaptive thinking and effort`, "these were dropped");
    }
  }

  // ── Anthropic's shape ───────────────────────────────────────────────────
  const claude = wire.generationRequest(models.resolveModel("claude-opus-5"), SYSTEM, USER, IMAGES);
  is(claude.shape, "anthropic", "Claude uses the anthropic shape");
  is(claude.url, wire.ENDPOINTS.claude, "Claude posts to the messages endpoint");
  is(claude.body.system, SYSTEM, "the system prompt is a top-level field");
  is(claude.body.max_tokens, 32000, "the ceiling is max_tokens");
  is(claude.body.messages[0].content[0].type, "image", "an attached image leads the message");
  is(claude.body.content, undefined, "no stray OpenAI vocabulary");
  is(claude.headers["anthropic-version"], "2023-06-01", "the version header is set");

  // ── OpenAI's shape ──────────────────────────────────────────────────────
  const gpt = wire.generationRequest(models.modelById("gpt-5"), SYSTEM, USER, IMAGES);
  is(gpt.shape, "openai", "GPT uses the openai shape");
  is(gpt.body.messages[0].role, "system", "the system prompt is a message, not a field");
  is(gpt.body.messages[0].content, SYSTEM, "and it carries the whole blueprint");
  is(gpt.body.system, undefined, "the anthropic field is NOT also sent");
  is(gpt.body.max_tokens, undefined, "max_tokens is not used — GPT-5 rejects it");
  is(gpt.body.max_completion_tokens, 32000, "max_completion_tokens is");
  is(gpt.body.messages[1].content[0].type, "image_url", "images use image_url");

  // ── Google's shape ──────────────────────────────────────────────────────
  const gemini = wire.generationRequest(models.modelById("gemini-3-pro"), SYSTEM, USER, IMAGES);
  is(gemini.shape, "google", "Gemini uses the google shape");
  has(gemini.url.includes("gemini-3-pro:generateContent"), "the wire id rides in the path", gemini.url);
  is(gemini.body.systemInstruction.parts[0].text, SYSTEM, "the blueprint goes in systemInstruction");
  is(gemini.body.system, undefined, "not in an anthropic field");
  is(gemini.body.messages, undefined, "and not in an openai one");
  is(gemini.body.contents[0].parts[1].text, USER, "the brief is a part");
  is(gemini.body.generationConfig.maxOutputTokens, 32000, "the ceiling is maxOutputTokens");

  /* The wire id is what Google puts in the URL, so a model id with a slash or a
     space in it would silently address a different endpoint. */
  const flash = wire.generationRequest(models.modelById("gemini-2-5-flash"), SYSTEM, USER);
  has(flash.url.endsWith("gemini-2.5-flash:generateContent"), "the dotted wire id survives the path", flash.url);

  // ── No images is not an empty image ─────────────────────────────────────
  const bare = wire.generationRequest(models.resolveModel("claude-opus-5"), SYSTEM, USER);
  is(bare.body.messages[0].content.length, 1, "with no attachments the message is just the text");

  // ── Reading the answer back ─────────────────────────────────────────────
  const PAGE = "<!doctype html><html></html>";
  is(
    wire.textFromResponse("anthropic", { content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: PAGE }] }),
    PAGE,
    "anthropic: the thinking block is skipped and the page is taken",
  );
  is(
    wire.textFromResponse("openai", { choices: [{ message: { content: PAGE } }] }),
    PAGE,
    "openai: the page comes off the first choice",
  );
  is(
    wire.textFromResponse("google", { candidates: [{ content: { parts: [{ text: PAGE }] } }] }),
    PAGE,
    "google: the page comes off the first candidate",
  );
  is(wire.textFromResponse("anthropic", {}), null, "an empty anthropic answer is null, not ''");
  is(wire.textFromResponse("openai", { choices: [] }), null, "an empty openai answer is null");
  is(wire.textFromResponse("google", { candidates: [] }), null, "an empty google answer is null");

  // ── No key is ever in a shaped request ──────────────────────────────────
  for (const [name, request] of [["claude", claude], ["openai", gpt], ["google", gemini]]) {
    const serialised = JSON.stringify({ url: request.url, headers: request.headers, body: request.body });
    has(
      !/api[-_]?key|authorization|bearer|sk-|AIza/i.test(serialised),
      `${name}: the shaped request carries no credential`,
      "keys belong in the orchestrator's credential store, never in a body built here",
    );
  }

  console.log(failed ? `\n${failed} failed.` : "\nAll passed.");
  process.exit(failed ? 1 : 0);
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(1);
}
