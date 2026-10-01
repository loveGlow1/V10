#!/usr/bin/env node
/* The preview signs in, and reads the project's own database.
 *
 *   npm run check:preview-auth
 *
 * The workspace preview used to replace @supabase/supabase-js with a stub —
 * every query empty, every sign-in "this is a preview" — and handed generated
 * code THIS platform's Supabase address rather than the project's. A login
 * page that sent people on with window.location.href = "/" loaded the
 * workspace's own site into the pane. All three are pinned here.
 *
 * When this was written the same preview document was also driven in
 * Chromium, sandboxed exactly as the pane sandboxes it, against a real
 * project's Supabase: it rendered, a plain link and a location.href change
 * both stayed in the app, sign-in reached Supabase and returned its real
 * "Invalid login credentials", and the dashboard read the project's 8 rows.
 * CI has no browser or database for that, so it is not repeated here.
 *
 * Offline.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-preview-auth");
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
    files: [join(process.cwd(), "src/lib/builder/preview/runtime.ts"), join(process.cwd(), "src/lib/builder/preview/auth-seed.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
const { PREVIEW_RUNTIME } = await import(join(out, "lib/builder/preview/runtime.js"));

let failed = 0;
let passed = 0;
const has = (cond, t, d) => {
  if (cond) { passed += 1; console.log(`ok    ${t}`); }
  else { failed += 1; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
};

console.log("\nThe runtime:");
let parses = true;
try { new Function(PREVIEW_RUNTIME); } catch (error) { parses = false; console.log(error); }
has(parses, "is valid JavaScript (a template string has eaten backslashes before)");
has(/createClient: liveSupabase\(\) \|\| supabaseStub/.test(PREVIEW_RUNTIME), "uses the real Supabase client when the project has a database, the stub only when it does not");
has(/storage: storage, lock: lock/.test(PREVIEW_RUNTIME), "keeps the session in memory and skips the lock a sandbox is refused");

const source = PREVIEW_RUNTIME.match(/function rewriteNavigation\(source\) \{[\s\S]*?\n  \}/);
has(Boolean(source), "rewrites navigation before compiling");
if (source) {
  const rewrite = new Function(`${source[0]}; return rewriteNavigation;`)();
  for (const [input, want] of [
    ['window.location.href = "/";', 'window.__qsNavigate("/");'],
    ["if (ok) window.location.href = next ?? '/dashboard'", "if (ok) window.__qsNavigate(next ?? '/dashboard')"],
    ['location.assign("/login")', 'window.__qsNavigate("/login")'],
    ['window.location.replace(`/x`)', 'window.__qsNavigate(`/x`)'],
    ['const here = window.location.href;', 'const here = window.location.href;'],
    ['if (window.location.href == "/") {}', 'if (window.location.href == "/") {}'],
  ]) has(rewrite(input) === want, `${input}`, rewrite(input));
}
has(/document\.addEventListener\('click'/.test(PREVIEW_RUNTIME), "plain <a href=\"/…\"> links are routed inside the app");

console.log("\nThe document and the route:");
const preview = readFileSync(join(process.cwd(), "src/lib/builder/preview/app-preview.ts"), "utf8");
has(/supabase-js@\d+\.\d+\.\d+\/dist\/umd\/supabase\.js/.test(preview), "supabase-js is loaded pinned to a version");
has(/env\?\.NEXT_PUBLIC_SUPABASE_URL && env\?\.NEXT_PUBLIC_SUPABASE_ANON_KEY \?/.test(preview), "and only for a project with a database");
const route = readFileSync(join(process.cwd(), "src/app/preview/[projectId]/route.ts"), "utf8");
has(/resolveBackend\(previewService, projectId\)/.test(route) && /envFor\(previewBackend\)/.test(route), "the preview gets the PROJECT's database");
has(!/const value = process\.env\[name\]/.test(route), "and never this platform's own Supabase");

console.log("\nStaying signed in across reloads of the preview:");
{
  const { rememberAuthWrite, withAuthSeed } = await import(join(out, "lib/builder/preview/auth-seed.js"));
  const memory = new Map();
  const store = { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
  const key = "sb-fhpnnfpewegelaumhukl-auth-token";
  has(rememberAuthWrite(store, "p1", key, '{"access_token":"t"}'), "a sign-in the frame reports is kept");
  has(!rememberAuthWrite(store, "p1", "anything-else", "x"), "a key that is not supabase auth is refused");
  has(!rememberAuthWrite(store, "p1", key, 42), "and so is a value that is not text");
  const page = "<!doctype html><html><head><title>x</title></head><body><script>boot()</script></body></html>";
  const seeded = withAuthSeed(page, store, "p1");
  has(seeded.indexOf("__qsAuthSeed") > 0 && seeded.indexOf("__qsAuthSeed") < seeded.indexOf("boot()"), "the next frame gets it before any of its scripts run");
  has(withAuthSeed(page, store, "p2") === page, "another project gets nothing");
  rememberAuthWrite(store, "p1", key, "</script><script>alert(1)</script>");
  has(!/<\/script><script>alert/.test(withAuthSeed(page, store, "p1")), "a value cannot close the script it is written into");
  rememberAuthWrite(store, "p1", key, null);
  has(withAuthSeed(page, store, "p1") === page, "signing out forgets it");
  has(withAuthSeed(page, null, "p1") === page, "no storage, no change");
  has(/window\.__qsAuthSeed/.test(PREVIEW_RUNTIME) && /report\('auth-storage'/.test(PREVIEW_RUNTIME), "the runtime reads the seed and reports every change");
  const panel = readFileSync(join(process.cwd(), "src/app/dashboard/components/workspace/PreviewPanel.tsx"), "utf8");
  has(/event\.source !== frameRef\.current\.contentWindow/.test(panel), "the workspace only takes a session from its own frame");
}

console.log(failed === 0 ? `\nAll ${passed} passed.` : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
