#!/usr/bin/env node
/* Connect WhatsApp — the parts that must not be wrong and need no network.
 *
 *   npm run check:whatsapp
 *
 * Codes are well-formed and unguessable in practice; a code is found in a
 * message however it was typed and nothing else passes for one; numbers are
 * read as digits; the bot secret is compared exactly; and the workspace
 * summary the assistant reads is select-only.
 *
 * Offline. No WhatsApp, no database.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-whatsapp");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".", rootDir: join(process.cwd(), "src"), module: "esnext", target: "es2022",
      moduleResolution: "bundler", skipLibCheck: true, strict: true, types: ["node"],
      typeRoots: [join(process.cwd(), "node_modules", "@types")],
      baseUrl: process.cwd(), paths: { "@/*": ["src/*"] },
    },
    files: [join(process.cwd(), "src/lib/whatsapp/link.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

const { newLinkCode, codeIn, hashCode, phoneDigits, maskPhone, botSecretMatches, whatsappLinkUrl } = await import(
  join(out, "lib/whatsapp/link.js")
);

let passed = 0;
let failed = 0;
function has(ok, label, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
}

console.log("Codes:");
const codes = Array.from({ length: 2000 }, newLinkCode);
has(codes.every((c) => /^QS-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/.test(c)), "every code looks like QS-XXXX-XXXX, without 0/O/1/I/L");
has(new Set(codes).size === codes.length, "2000 codes, no repeats");
has(hashCode("QS-ABCD-EFGH") !== "QS-ABCD-EFGH" && hashCode("QS-ABCD-EFGH").length === 64, "what is stored is a hash, not the code");
has(hashCode("QS-ABCD-EFGH") === hashCode("QS-ABCD-EFGH"), "the hash is stable");

console.log("\nFinding the code in a message:");
for (const [text, want] of [
  ["LINK QS-7KQ2-M9XD", "QS-7KQ2-M9XD"],
  ["link qs-7kq2-m9xd", "QS-7KQ2-M9XD"],
  ["qs 7kq2 m9xd", "QS-7KQ2-M9XD"],
  ["Hi! my code is QS7KQ2M9XD thanks", "QS-7KQ2-M9XD"],
  ["QS-0OIL-1234", null],
  ["hello", null],
  ["QS-ABC-DEFG", null],
  [null, null],
]) {
  has(codeIn(text) === want, `${JSON.stringify(text)} → ${want}`, `got ${codeIn(text)}`);
}

console.log("\nNumbers:");
has(phoneDigits("2349032056805@s.whatsapp.net") === "2349032056805", "a WhatsApp id becomes its digits");
has(phoneDigits("+234 903 205 6805") === "2349032056805", "spaces and + are dropped");
has(phoneDigits("123") === null && phoneDigits("") === null && phoneDigits(undefined) === null, "too short or missing is refused");
has(maskPhone("2349032056805") === "+234 ••• 6805", "shown masked");
has(whatsappLinkUrl("QS-7KQ2-M9XD").endsWith("?text=LINK%20QS-7KQ2-M9XD"), "Open WhatsApp carries the code");

console.log("\nThe bot's secret:");
has(botSecretMatches("s3cret", "s3cret"), "the right secret passes");
has(!botSecretMatches("s3cre", "s3cret") && !botSecretMatches("", "s3cret"), "a wrong or empty one fails");
has(!botSecretMatches("anything", undefined), "no secret configured means nothing passes");

console.log("\nThe assistant can only read:");
const workspace = readFileSync(join(process.cwd(), "src/lib/whatsapp/workspace.ts"), "utf8");
has(!/\.(insert|update|upsert|delete|rpc)\(/.test(workspace), "workspace.ts never writes or calls a function");
const bot = readFileSync(join(process.cwd(), "src/app/api/whatsapp/bot/route.ts"), "utf8");
const writes = [...bot.matchAll(/\.from\("([a-z_]+)"\)[^;]*?\.(insert|update|upsert|delete)\(/gs)].map((m) => m[1]);
has(writes.length > 0 && writes.every((table) => table === "whatsapp_links"), "the bot route writes only whatsapp_links", writes.join(", "));
has(!/credit/i.test(bot.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "the bot route has no code touching credits");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
