/* Checks that ChatGPT and Gemini answer a request the way Claude does
 * (src/lib/ai/llm.ts), offline, against simulated OpenAI and Gemini
 * streams: the text arrives in pieces, how it stopped is read the same way,
 * tokens are counted, pictures reach Gemini as bytes, errors read the same,
 * and a deadline returns what was written so far.
 *
 *   node tools/check-providers.mjs           offline only
 *   node tools/check-providers.mjs --live    also calls the real APIs with
 *                                            OPENAI_API_KEY / GEMINI_API_KEY:
 *                                            lists their models to confirm
 *                                            every id in the picker exists, and
 *                                            asks each picker model one short
 *                                            question (costs a fraction of a cent) */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-providers");
mkdirSync(out, { recursive: true });
const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  compilerOptions: { outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022", moduleResolution: "bundler", skipLibCheck: true, strict: true, jsx: "preserve", types: ["node"], baseUrl: process.cwd(), paths: { "@/*": ["src/*"] } },
  files: [join(process.cwd(), "src/lib/ai/llm.ts")],
}));
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
for (const entry of readdirSync(out, { recursive: true })) {
  if (!String(entry).endsWith(".js")) continue;
  const path = join(out, String(entry));
  const depth = String(entry).split("/").length - 1;
  writeFileSync(path, readFileSync(path, "utf8")
    .replace(/(from\s+["'])@\/([^"']+?)(["'])/g, (_, a, rest, c) => `${a}${"../".repeat(depth)}${rest}.js${c}`)
    .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (w, a, spec, c) => (spec.endsWith(".js") ? w : `${a}${spec}.js${c}`)));
}
const live = process.argv.includes("--live");
const realFetch = globalThis.fetch;
const realKeys = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY, GOOGLE_API_KEY: process.env.GOOGLE_API_KEY };
const L = await import(join(out, "lib/ai/llm.js"));
const M = await import(join(out, "app/dashboard/models.js"));

let failed = 0, passed = 0;
const has = (cond, t, d) => { if (cond) { passed++; console.log(`ok    ${t}`); } else { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); } };

const stream = (events) => new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`)); c.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); c.close(); } }), { status: 200 });
let seen = [];
const mock = (handler) => { seen = []; globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return handler(String(url), init); }; };

process.env.OPENAI_API_KEY = "sk-test";
process.env.GEMINI_API_KEY = "g-test";

console.log("which provider answers");
has(L.providerFor("gpt-5") === "openai" && L.providerFor("gpt-5-mini") === "openai" && L.providerFor("gemini-2.5-flash") === "google" && L.providerFor("gemini-3-pro") === "google" && L.providerFor("claude-sonnet-5") === "claude", "every picker model goes to its own maker");
has(L.wireId("gemini-3-pro", { MODEL_ID_GEMINI_3_PRO: "gemini-3-pro-preview" }) === "gemini-3-pro-preview" && L.wireId("gemini-3-pro", {}) === "gemini-3-pro", "a provider's renamed model id can be set without a release");
has(L.providerReady("openai", { OPENAI_API_KEY: "x" }) && !L.providerReady("google", {}) && L.providerReady("google", { GOOGLE_API_KEY: "y" }), "a provider is ready when its key is set (Gemini takes either name)");

console.log("\nChatGPT, like Claude");
mock(() => stream([
  { model: "gpt-5-2026", choices: [{ delta: { content: "Hello" } }] },
  { choices: [{ delta: { content: ", world" } }] },
  { choices: [{ delta: {}, finish_reason: "stop" }] },
  { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } },
]));
let pieces = [];
let r = await L.generate({ model: "gpt-5", system: "Be brief.", turns: [{ role: "user", parts: [{ type: "image", url: "https://x/y.png" }, { type: "text", text: "hi" }] }], maxTokens: 100, onText: (d) => pieces.push(d) });
const body = JSON.parse(seen[0].init.body);
has(seen[0].url === "https://api.openai.com/v1/chat/completions" && seen[0].init.headers.Authorization === "Bearer sk-test", "it calls OpenAI with the server's key");
has(body.messages[0].role === "system" && body.messages[0].content === "Be brief." && body.max_completion_tokens === 100 && body.stream === true, "the system prompt, the length limit (max_completion_tokens) and streaming are sent as GPT-5 expects");
has(body.messages[1].content[0].type === "image_url" && body.messages[1].content[1].text === "hi", "pictures and text go together in the turn");
has(r.text === "Hello, world" && pieces.join("|") === "Hello|, world" && r.stop === "end" && r.inputTokens === 12 && r.outputTokens === 4 && r.provider === "openai", "the answer streams in pieces, ends, and is counted");
mock(() => stream([{ choices: [{ delta: { content: "cut" }, finish_reason: "length" }] }]));
r = await L.generate({ model: "gpt-5-mini", system: "s", turns: [{ role: "user", parts: [{ type: "text", text: "x" }] }], maxTokens: 5 });
has(r.stop === "max_tokens", "running out of room reads as max_tokens, as with Claude");
mock(() => new Response(JSON.stringify({ error: { message: "Incorrect API key provided" } }), { status: 401 }));
let err = null;
try { await L.generate({ model: "gpt-5", system: "s", turns: [{ role: "user", parts: [{ type: "text", text: "x" }] }], maxTokens: 5 }); } catch (e) { err = e; }
has(err instanceof L.LlmError && err.kind === "auth" && /OpenAI key|API key this workspace uses was rejected/.test(L.sayLlmError(err)), "a refused key reads the same as Claude's", err && L.sayLlmError(err));
mock(() => new Response("{}", { status: 429 }));
err = null;
try { await L.generate({ model: "gpt-5", system: "s", turns: [{ role: "user", parts: [{ type: "text", text: "x" }] }], maxTokens: 5 }); } catch (e) { err = e; }
has(err?.kind === "rate" && /rate limiting/.test(L.sayLlmError(err)), "rate limits read the same");

console.log("\nGemini, like Claude");
mock((url) => url.startsWith("https://img/") ? new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { "content-type": "image/png" } }) : stream([
  { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: "Bonjour" }] } }] },
  { candidates: [{ content: { parts: [{ text: " le monde" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3, thoughtsTokenCount: 5 } },
]));
pieces = [];
r = await L.generate({ model: "gemini-2-5-flash", system: "Be brief.", turns: [{ role: "user", parts: [{ type: "image", url: "https://img/a.png" }, { type: "text", text: "salut" }] }, { role: "assistant", parts: [{ type: "text", text: "oui" }] }, { role: "user", parts: [{ type: "text", text: "encore" }] }], maxTokens: 50, onText: (d) => pieces.push(d) });
const call = seen.find((s) => s.url.includes("generativelanguage"));
const gbody = JSON.parse(call.init.body);
has(call.url.includes("/models/gemini-2.5-flash:streamGenerateContent?alt=sse") && call.init.headers["x-goog-api-key"] === "g-test", "it calls Gemini's streaming endpoint with the server's key, by the model's real id");
has(gbody.systemInstruction.parts[0].text === "Be brief." && gbody.generationConfig.maxOutputTokens === 50 && gbody.contents[1].role === "model", "system prompt, length limit and earlier turns are sent the Gemini way");
has(gbody.contents[0].parts[0].inlineData?.mimeType === "image/png" && gbody.contents[0].parts[0].inlineData.data === "iVBORw==", "a picture is fetched and sent as bytes (Gemini will not fetch links)");
has(r.text === "Bonjour le monde" && pieces.join("|") === "Bonjour| le monde" && r.outputTokens === 8 && r.stop === "end", "Gemini's own reasoning is left out; the answer streams and is counted with its thinking");
mock(() => stream([{ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] }]));
r = await L.generate({ model: "gemini-3-pro", system: "s", turns: [{ role: "user", parts: [{ type: "text", text: "x" }] }], maxTokens: 5 });
has(r.stop === "refusal", "a safety stop reads as a refusal, as with Claude");
mock(() => new Response(JSON.stringify({ error: { message: "models/gemini-3-pro is not found" } }), { status: 404 }));
err = null;
try { await L.generate({ model: "gemini-3-pro", system: "s", turns: [{ role: "user", parts: [{ type: "text", text: "x" }] }], maxTokens: 5 }); } catch (e) { err = e; }
has(err?.kind === "not_found" && /doesn't recognise/.test(L.sayLlmError(err)), "an unknown model name says so plainly");

console.log("\ntime and keys");
mock((_, init) => new Promise((resolve, reject) => {
  const enc = new TextEncoder();
  resolve(new Response(new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial " } }] })}\n\n`));
      init.signal?.addEventListener("abort", () => c.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
    },
  }), { status: 200 }));
}));
/* AbortSignal.timeout does not keep a script alive on its own; a server is alive anyway. */
const awake = setTimeout(() => {}, 10_000);
r = await L.generate({ model: "gpt-5", system: "s", turns: [{ role: "user", parts: [{ type: "text", text: "x" }] }], maxTokens: 50, deadlineAt: Date.now() + 1200 });
clearTimeout(awake);
has(r.stop === "deadline" && r.text === "partial ", "out of time: what was written comes back, marked as cut short (as Claude's edits do)");
delete process.env.OPENAI_API_KEY;
err = null;
try { await L.generate({ model: "gpt-5", system: "s", turns: [{ role: "user", parts: [{ type: "text", text: "x" }] }], maxTokens: 5 }); } catch (e) { err = e; }
has(err?.kind === "not_configured" && /isn't set up/.test(L.sayLlmError(err)), "with no key it says so, and nothing is sent");

console.log("\nthe picker");
const gpt = M.MODELS.filter((m) => m.provider === "openai" || m.provider === "google");
has(gpt.every((m) => m.creditMultiplier > 0 && m.contextWindow > m.maxOutput && m.apiId), "every GPT and Gemini model has a price, a context window and an id, ready for when its key arrives");
has(gpt.every((m) => !M.isModelAvailable(m)), "without NEXT_PUBLIC_AI_* they stay greyed (as in this check)");
const nc = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");
has(/NEXT_PUBLIC_AI_OPENAI: process\.env\.OPENAI_API_KEY/.test(nc) && /NEXT_PUBLIC_AI_GOOGLE: \(process\.env\.GEMINI_API_KEY/.test(nc), "a key set on the server switches its models on at the next deploy");
const edit = readFileSync(join(process.cwd(), "src/lib/builder/edit.ts"), "utf8");
has(/chosen\.provider === "openai" \|\| chosen\.provider === "google"/.test(edit) && /askAnyProvider/.test(edit), "workspace edits, answers and clarifications route a GPT or Gemini pick through the same path");
for (const f of ["src/lib/video/director.ts", "src/lib/video/editor.ts"]) has(!/new Anthropic\(\)/.test(readFileSync(join(process.cwd(), f), "utf8")), `${f.split("/").pop()} asks whichever model was picked`);
has(!/can't edit videos yet/.test(readFileSync(join(process.cwd(), "src/lib/video/agent.ts"), "utf8")), "the video studio offers GPT and Gemini as agents");

has(gpt.every((m) => !m.minPlan), "no plan lock: every account can pick GPT and Gemini once the key is set");
const cp = readFileSync(join(process.cwd(), "src/app/dashboard/components/workspace/ChatPanel.tsx"), "utf8");
has(/option\.provider === "claude" \|\| isModelAvailable\(option\)/.test(cp), "connected GPT and Gemini sit on the picker's first page, not behind More models");
has(/entry\.provider === requested\.provider && creditMultiplierFor/.test(readFileSync(join(process.cwd(), "src/app/dashboard/credits.ts"), "utf8")), "Auto and a Claude pick step down to a cheaper Claude, never quietly to another maker");
const flags = (env) => execFileSync(process.execPath, ["--input-type=module", "-e", "const c = (await import(process.argv[1])).default; console.log(JSON.stringify(c.env));", join(process.cwd(), "next.config.mjs")], { env: { ...process.env, ...env, OPENAI_API_KEY: env.OPENAI_API_KEY ?? "", GEMINI_API_KEY: env.GEMINI_API_KEY ?? "", GOOGLE_API_KEY: env.GOOGLE_API_KEY ?? "" }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").pop();
const on = JSON.parse(flags({ OPENAI_API_KEY: "sk-x", GEMINI_API_KEY: "g-x" }));
const off = JSON.parse(flags({}));
const google = JSON.parse(flags({ GOOGLE_API_KEY: "g-y" }));
const offByChoice = JSON.parse(flags({ OPENAI_API_KEY: "sk-x", AI_OPENAI: "off" }));
has(on.NEXT_PUBLIC_AI_OPENAI === "on" && on.NEXT_PUBLIC_AI_GOOGLE === "on" && !off.NEXT_PUBLIC_AI_OPENAI && !off.NEXT_PUBLIC_AI_GOOGLE && google.NEXT_PUBLIC_AI_GOOGLE === "on" && !offByChoice.NEXT_PUBLIC_AI_OPENAI, "adding a key is all it takes: the build switches its models on (and AI_OPENAI=off can keep them off)", JSON.stringify({ on, off, google, offByChoice }));
const mr = readFileSync(join(process.cwd(), "src/lib/builder/model-request.ts"), "utf8");
const br = readFileSync(join(process.cwd(), "src/app/api/build/route.ts"), "utf8");
has(/inlineData: \{ mimeType: inline\[1\], data: inline\[2\] \}/.test(mr) && /model\.provider === "google" \? await inlineImages\(imageUrls\)/.test(br), "a full build on Gemini sends attached pictures as bytes");
const wf = readFileSync(join(process.cwd(), "n8n/build-orchestrator.workflow.ts"), "utf8");
has(/newCredential\('OpenAI account'\)/.test(wf) && /newCredential\('Google Gemini account'\)/.test(wf), "the build workflow names the OpenAI and Gemini credentials to attach");

globalThis.fetch = realFetch;
Object.assign(process.env, Object.fromEntries(Object.entries(realKeys).filter(([, v]) => v)));
if (!realKeys.OPENAI_API_KEY) delete process.env.OPENAI_API_KEY;

if (live) {
  console.log("\nlive");
  if (process.env.OPENAI_API_KEY) {
    const list = await realFetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }).then((x) => x.json()).catch(() => null);
    const ids = new Set((list?.data ?? []).map((m) => m.id));
    for (const m of M.MODELS.filter((x) => x.provider === "openai")) {
      has(ids.has(L.wireId(m.id)), `OpenAI has ${L.wireId(m.id)}`, ids.size ? "set MODEL_ID_" + m.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_") + " to its current name" : "the key could not list models");
      try { const a = await L.generate({ model: m.id, system: "Answer in one word.", turns: [{ role: "user", parts: [{ type: "text", text: "Say ok." }] }], maxTokens: 400 }); has(a.text.length > 0, `${m.name} answers: "${a.text.trim().slice(0, 30)}"`); } catch (e) { has(false, `${m.name} answers`, e.message); }
    }
  } else console.log("skip  OpenAI (no OPENAI_API_KEY)");
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const list = await realFetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": key } }).then((x) => x.json()).catch(() => null);
    const ids = new Set((list?.models ?? []).map((m) => String(m.name).replace(/^models\//, "")));
    for (const m of M.MODELS.filter((x) => x.provider === "google")) {
      has(ids.has(L.wireId(m.id)), `Gemini has ${L.wireId(m.id)}`, ids.size ? `close names: ${[...ids].filter((i) => i.startsWith(L.wireId(m.id).split("-").slice(0, 2).join("-"))).slice(0, 6).join(", ")} — set MODEL_ID_${m.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}` : "the key could not list models");
      try { const a = await L.generate({ model: m.id, system: "Answer in one word.", turns: [{ role: "user", parts: [{ type: "text", text: "Say ok." }] }], maxTokens: 400 }); has(a.text.length > 0, `${m.name} answers: "${a.text.trim().slice(0, 30)}"`); } catch (e) { has(false, `${m.name} answers`, e.message); }
    }
  } else console.log("skip  Gemini (no GEMINI_API_KEY)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
