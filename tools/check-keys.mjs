/* Plug-and-play keys: every key the code reads is on the Keys page.
 *
 * lib/keys.ts is what the owner reads to know which keys to add in Vercel.
 * A key the code reads that the list does not name is a feature somebody can
 * only switch on by reading the source — so every process.env name in src/
 * must be either on the list or a known tuning knob that has a default. And
 * the list's own rules are pinned: names only, either Google name works,
 * senders default to the site's own domain. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const root = process.cwd();
let failed = 0;
const has = (ok, label, detail = "") => {
  console.log(`${ok ? "ok   " : "FAIL "} ${label}${!ok && detail ? `\n        ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const dir = mkdtempSync(join(tmpdir(), "keys-"));
writeFileSync(join(dir, "keys.mjs"), ts.transpileModule(readFileSync(join(root, "src/lib/keys.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const K = await import(join(dir, "keys.mjs"));

/* Knobs with a working default — read when set, never needed to switch anything on. */
const KNOBS = new Set([
  "NODE_ENV", "VERCEL_ENV", "NEXT_PUBLIC_SHOW_SUPABASE_CONFIG_WARNING", "NEXT_PUBLIC_SUPABASE_SCHEMA", "SUPABASE_HEALTH_INCLUDE_DETAILS",
  "GEMINI_FLASH_IMAGE_MODEL", "GEMINI_PRO_IMAGE_MODEL", "N8N_OPENAI_IMAGE_MODEL", "N8N_CREDIT_PAUSE_HOURS", "VIDEO_QUALITY", "FLIER_ART", "FLIER_ENGINE",
  "ASSET_PROVIDER_ORDER", "CURATED_LIBRARY_ENABLED", "CURATED_ASSETS_BASE_URL", "FLYERS_API_ENABLED", "MCP_WAIT_SECONDS", "BUILDER_PAUSED", "BUILDER_PAUSED_MESSAGE",
  "DEPLOY_ALLOWLIST", "DB_AUTOPILOT", "DB_AGENT_APPROVAL_SECRET", "FORMS_SENDER_SALT", "CRYPTO_RATES_URL", "COINGECKO_API_KEY", "CRYPTO_WALLET_BTC",
  "QUICKSTARK_APP_DOMAIN", "QUICKSTARK_PREVIEW_DOMAIN", "NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID", "TERMINAL_SECRET", "TERMINAL_DEV_BRIDGE_URL", "TERMINAL_DEV_BRIDGE_KEY",
  "MCP_OAUTH_SECRET", "MCP_OAUTH_REDIRECT_URL", "SUPABASE_DB_URL", "OWNER_EMAILS",
]);
const listed = new Set(K.FEATURES.flatMap((f) => [...f.needs.flat(), ...(f.optional ?? [])]));
const read = new Set(
  execFileSync("grep", ["-rhoE", "(process\\.env|env)\\.[A-Z][A-Z0-9_]{3,}", "src"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.replace(/^.*\./, "").trim())
    .filter(Boolean),
);
const unlisted = [...read].filter((name) => !listed.has(name) && !KNOBS.has(name));
has(unlisted.length === 0, "every key the code reads is on the Keys page (or is a knob with a default)", unlisted.join(", "));

const empty = K.keyStatus({});
has(empty.every((f) => !f.ready) && empty.find((f) => f.id === "minimax").missing.join() === "MINIMAX_API_KEY", "with nothing set, nothing claims to be on — and each says the exact name it needs");
const withMinimax = K.keyStatus({ MINIMAX_API_KEY: "x" });
has(withMinimax.find((f) => f.id === "minimax").ready && withMinimax.find((f) => f.id === "minimax").present.join() === "MINIMAX_API_KEY", "one key is enough to switch its feature on");
has(K.keyStatus({ GOOGLE_API_KEY: "x" }).find((f) => f.id === "google-chat").ready && K.googleKey({ GOOGLE_API_KEY: "g" }) === "g" && K.googleKey({ GEMINI_API_KEY: "a", GOOGLE_API_KEY: "g" }) === "a", "Google's key works under either name");
has(!K.keyStatus({ SUPABASE_MANAGEMENT_TOKEN: "t", SUPABASE_ORG_ID: "o" }).find((f) => f.id === "managed-db").ready, "managed databases stay off without MANAGED_DATABASES_ENABLED=true — each is a monthly bill");
has(K.defaultSender("receipts", {}) === "QuickStark.ai <receipts@quickstark.tech>" && K.defaultSender("receipts", { NEXT_PUBLIC_SITE_URL: "https://www.example.com" }) === "QuickStark.ai <receipts@example.com>", "email senders default to the site's own domain");
has(JSON.stringify(K.keyStatus({ STRIPE_SECRET_KEY: "sk_live_secret_value" })).includes("sk_live_secret_value") === false, "the status never carries a value — names only");
has(K.ownerEmails({ OWNER_EMAILS: " A@x.com, b@y.com " }).join() === "a@x.com,b@y.com" && K.ownerEmails({ ALERT_EMAIL: "me@z.com" }).join() === "me@z.com" && K.ownerEmails({}).length === 0, "the Keys page answers only to OWNER_EMAILS, else ALERT_EMAIL");

const route = readFileSync(join(root, "src/app/api/keys/route.ts"), "utf8");
has(/owners\.includes\(\(user\.email \?\? ""\)\.toLowerCase\(\)\)/.test(route) && /auth\.getUser\(\)/.test(route), "the Keys route checks the signed-in owner before answering");
const ai = readFileSync(join(root, "src/lib/builder/assets/providers/ai.ts"), "utf8");
has(/AI_IMAGE_ENABLED === "false"/.test(ai) && !/AI_IMAGE_ENABLED !== "true"/.test(ai), "the custom image endpoint needs no second switch");
const start = readFileSync(join(root, "src/lib/video/start-render.ts"), "utf8");
const frames = readFileSync(join(root, "src/lib/video/frames.ts"), "utf8");
has(/if \(!chain\.length && !frame && scene && writer\) \{\s*frame = await ensureSceneFrame/.test(start) && /if \(process\.env\.MINIMAX_API_KEY\) makers\.push\(\(\) => minimaxDirect/.test(frames), "MINIMAX_API_KEY alone films any shape: a still is made and animated where text-to-video cannot");

console.log(failed ? `\n${failed} failed.` : "\nAll passed.");
process.exit(failed ? 1 : 0);
