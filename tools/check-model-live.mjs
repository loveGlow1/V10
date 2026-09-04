#!/usr/bin/env node
/* Whether the models the picker offers can actually be called, right now.
 *
 *   npm run check:live                      every Claude model in the picker
 *   npm run check:live -- claude-fable-5    just one
 *
 * The difference between this and check:models is the network. That one builds
 * a request and inspects it, never sends it — it answers "is the body shaped
 * right". This one sends the smallest real request each model will accept and
 * answers a different question: is the key valid, does this account have this
 * model, and is there credit left to run it.
 *
 * Those fail separately and they fail silently. An account can hold a perfectly
 * good key with no credit on it; a key can be valid for Sonnet and not
 * entitled to Fable; a model id can be right and simply not exist yet on the
 * account. All three surface in the app as "the build did not finish", minutes
 * later, after the person has been told it was underway.
 *
 * The wire ids come from src/app/dashboard/models.ts rather than being written
 * out here, so a model renamed in the picker is a model this follows.
 *
 * COSTS REAL MONEY, though barely: one short call per model, capped at 256
 * output tokens. On Fable's rates that is a few cents at the very most.
 *
 * The key is read from ANTHROPIC_API_KEY, or ANTHROPIC_AUTH_TOKEN for an OAuth
 * token. NOTE that neither is what production uses — the deployed builder's key
 * lives on the `Anthropic account` credential inside n8n, and this cannot see
 * it. Run this with the same key that credential holds, or you have tested a
 * different key than the one your builds use.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
/* Big enough that thinking — always on for Fable, on by default for Opus 5 —
   cannot eat the whole budget before a word of answer is produced. A truncated
   answer would still prove the model is reachable, but "stop_reason:
   max_tokens" reads like a fault when it is not. */
const MAX_TOKENS = 256;

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();

if (!apiKey && !authToken) {
  console.error(
    "No credentials. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN for an OAuth\n" +
      "token) and run again. Use the same key the `Anthropic account` credential in\n" +
      "n8n holds, or this tests a key your builds never use.",
  );
  process.exit(2);
}

/* Same bootstrap as check:models — compile the two TS modules into a cache and
   import them, so the ids under test are the ids the app ships. */
const out = join(process.cwd(), "node_modules", ".cache", "quickstark-live");
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
    files: [join(process.cwd(), "src/app/dashboard/models.ts")],
  }),
);

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

const asked = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const claude = models.callableModels().filter((model) => model.provider === "claude");
const targets = asked.length
  ? asked.map((id) => {
      const found = claude.find((model) => model.id === id || model.apiId === id);
      if (!found) {
        console.error(`"${id}" is not a Claude model in the picker. Known: ${claude.map((m) => m.id).join(", ")}`);
        process.exit(2);
      }
      return found;
    })
  : claude;

const headers = apiKey
  ? { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": apiKey }
  : {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      authorization: `Bearer ${authToken}`,
      "anthropic-beta": "oauth-2025-04-20",
    };

/* What went wrong, in the words of the thing that has to be fixed rather than
   the status code. `description` before `message` for the same reason n8n's
   notes give: the API's own sentence says "credit balance is too low", the
   wrapper says "Bad request". */
function diagnose(status, payload) {
  const said = payload?.error?.message ?? payload?.message ?? "";
  const low = said.toLowerCase();

  if (low.includes("credit balance")) return ["NO CREDIT", "the key is valid; the account has no credit left"];
  if (status === 401) return ["BAD KEY", "the key was rejected"];
  if (status === 403) return ["FORBIDDEN", said || "the key is not permitted to use this"];
  if (status === 404 || low.includes("not_found") || low.includes("does not exist"))
    return ["NOT ON ACCOUNT", said || "this account cannot see that model id"];
  if (status === 429) return ["RATE LIMITED", "the model and key are fine — too many requests"];
  if (status >= 500) return ["PROVIDER DOWN", said || `HTTP ${status}`];
  return [`HTTP ${status}`, said || "no message"];
}

console.log(`Probing ${targets.length} model${targets.length === 1 ? "" : "s"} against ${ENDPOINT}\n`);

let failed = 0;

for (const model of targets) {
  const label = `${model.name} (${model.apiId})`;
  let verdict;
  let detail;

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      /* Deliberately bare. No `thinking`, no `temperature`: thinking is always
         on for Fable 5.1 and configuring it there is a 400, and the sampling
         parameters are removed on every model in this list. A body that is
         valid for all four is a body that tests the account, not the payload. */
      body: JSON.stringify({
        model: model.apiId,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: "Reply with the single word: live" }],
      }),
    });

    const payload = await response.json().catch(() => null);

    if (response.ok) {
      const text = (payload?.content ?? [])
        .filter((block) => block?.type === "text")
        .map((block) => block.text ?? "")
        .join("")
        .trim();
      verdict = "LIVE";
      /* `payload.model` rather than what was asked for: the served model can
         differ from the requested one, and a probe that echoes its own input
         has confirmed nothing. */
      detail = `served by ${payload?.model ?? "?"}, ${payload?.usage?.output_tokens ?? "?"} output tokens, stop_reason ${payload?.stop_reason}${text ? `, said "${text.slice(0, 40)}"` : ""}`;
    } else {
      [verdict, detail] = diagnose(response.status, payload);
      failed++;
    }
  } catch (error) {
    verdict = "UNREACHABLE";
    detail = error instanceof Error ? error.message : String(error);
    failed++;
  }

  console.log(`${verdict === "LIVE" ? "ok  " : "FAIL"}  ${label.padEnd(38)} ${verdict}`);
  console.log(`        ${detail}\n`);
}

if (failed) {
  console.log(`${failed} of ${targets.length} could not be called.`);
  process.exit(1);
}
console.log(`All ${targets.length} reachable.`);
