#!/usr/bin/env node
/* Connect GitHub — the parts that must not be wrong and need no network.
 *
 *   npm run check:github
 *
 * Tokens round-trip through sealing and fail closed under another key; a
 * project name always becomes a repository name GitHub accepts; and the
 * `?next=` a sign-in returns to can never leave this site.
 *
 * Offline. No GitHub, no database.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-github");
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
    files: [
      join(process.cwd(), "src/lib/sealing.ts"),
      join(process.cwd(), "src/app/api/integrations/github/oauth-cookie.ts"),
      join(process.cwd(), "src/lib/github/push.ts"),
    ],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));

const { sealerFor } = await import(join(out, "lib/sealing.js"));
const { safeNext, withReason, readOAuthCookie, writeOAuthCookie } = await import(
  join(out, "app/api/integrations/github/oauth-cookie.js")
);

/* push.ts imports "./oauth", which imports "@/lib/sealing" — a path alias tsc
   does not rewrite. The two functions under test are pure, so they are read
   from the source with the alias resolved by hand. */
const pushSource = readFileSync(join(out, "lib/github/push.js"), "utf8").replace(/^import .*$/gm, "");
const pushMod = await import(`data:text/javascript,${encodeURIComponent(pushSource + "\nconst GITHUB_API='';")}`);
const { repoNameFor, validRepoName } = pushMod;

let failed = 0;
let passed = 0;
const has = (cond, t, d) => {
  if (cond) { passed += 1; console.log(`ok    ${t}`); }
  else { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
};

console.log("\nSealing:");
const box = sealerFor("quickstark-github-oauth:secret-a");
const sealed = box.seal("gho_example_token");
has(sealed.startsWith("v1.") && !sealed.includes("gho_example_token"), "a sealed token does not contain the token");
has(box.unseal(sealed) === "gho_example_token", "it unseals under the same key");
has(sealerFor("quickstark-github-oauth:secret-b").unseal(sealed) === null, "another key reads it as nothing");
has(box.unseal(sealed.slice(0, -2) + "AA") === null, "a tampered value reads as nothing");

console.log("\nRepository names:");
for (const [input, want] of [
  ["Nova Estates", "nova-estates"],
  ["  Café & Bar!! ", "caf-bar"],
  ["", "quickstark-app"],
  [null, "quickstark-app"],
  ["...", "quickstark-app"],
  ["a".repeat(200), "a".repeat(80)],
]) {
  const got = repoNameFor(input);
  has(got === want && validRepoName(got), `${JSON.stringify(input)} → ${want}`, `got ${got}`);
}
has(!validRepoName("has space") && !validRepoName("..") && !validRepoName("a/b"), "invalid names are refused");

console.log("\nReturning after sign-in stays on this site:");
for (const evil of ["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "evil", null]) {
  has(safeNext(evil) === "/dashboard", `${JSON.stringify(evil)} falls back to /dashboard`);
}
has(safeNext("/dashboard/project/abc?view=integrations") === "/dashboard/project/abc?view=integrations", "a same-site path is kept");
has(
  withReason("/dashboard/project/abc?view=integrations", "connected") === "/dashboard/project/abc?view=integrations&github=connected",
  "the result is added to the return path",
);
const cookie = writeOAuthCookie({ state: "s", verifier: "v", userId: "u", next: "//evil.example" });
has(readOAuthCookie(cookie)?.next === "/dashboard", "a cookie carrying an off-site next is neutralised");
has(readOAuthCookie("not-base64-json") === null, "a garbled cookie reads as nothing");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
