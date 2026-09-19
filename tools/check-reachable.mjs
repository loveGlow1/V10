#!/usr/bin/env node
/* Does the deployment check survive a real HTTP conversation?
 *
 *   npm run check:reachable
 *
 * Every other assertion about Deployment Protection in this repository reads
 * the source. That was enough to describe the intent and not enough to catch
 * the defect it was describing: reachable() checked STATUS CODES, and Vercel's
 * protection answers a browser with a redirect to its sign-in page — a 200
 * carrying an interstitial. Read as source, the function looked right. Run
 * against a real response, it called that success, and "your app is live" was
 * said over a login page.
 *
 * So this one runs the real function against a real server over real HTTP:
 * real fetch, real redirect following, real body reading. The server emits the
 * shapes Vercel actually produces.
 *
 * NOT COVERED HERE, and worth saying: the branch that flags a response ending
 * on a vercel.com hostname needs that name to resolve, which a test may not
 * arrange portably. It is asserted in check-vercel-protection, and was
 * verified live against a hosts-mapped server during the pass that added it.
 *
 * No network beyond loopback. No key.
 */

import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-reachable");
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
    files: [join(process.cwd(), "src/lib/publish/vercel-deploy.ts")],
  }),
);
execFileSync("npx", ["tsc", "-p", config], { stdio: "inherit" });

/* reachable() touches neither import; they belong to other exports of the same
   module, so a stub is all that is needed to load it. */
const stub = join(out, "stub.js");
writeFileSync(stub, "export const splitClientRoutes = () => [];\nexport const NEXT_VERSION = '0.0.0';\n");

const compiled = join(out, "lib/publish/vercel-deploy.js");
writeFileSync(
  compiled,
  readFileSync(compiled, "utf8")
    .split("\n")
    .map((line) =>
      /^\s*(?:import|export)\b/.test(line)
        ? line
            .replace(/(from\s+["'])@\/.+?(["'];?\s*)$/, `$1${stub}$2`)
            .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'];?\s*)$/, (w, a, spec, b) =>
              spec.endsWith(".js") ? w : `${a}${spec}.js${b}`)
        : line,
    )
    .join("\n"),
);

const { reachable } = await import(compiled);

const APP = `<!doctype html><html><head><title>Ledgerline</title></head><body>
<h1>Invoices</h1><script>const NOT_FOUND = "/404";</script></body></html>`;

const SSO = `<!doctype html><html><head><title>Authentication Required</title></head><body>
<p>You need to be signed in to access this deployment.</p>
<script src="/_vercel/sso/callback"></script></body></html>`;

const VERCEL_404 = `<!doctype html><html><body><h1>404: NOT_FOUND</h1>
<p>Code: DEPLOYMENT_NOT_FOUND</p></body></html>`;

const server = createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { "content-type": "text/html" }); res.end(body); };
  switch (req.url.split("?")[0]) {
    case "/401": res.writeHead(401); return res.end("Unauthorized");
    case "/403": res.writeHead(403); return res.end("Forbidden");
    case "/sso": return send(200, SSO);
    case "/gone": return send(404, VERCEL_404);
    case "/boom": res.writeHead(500); return res.end("nope");
    default: return send(200, APP);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

let failed = 0;
const check = async (label, path, want) => {
  const got = await reachable(`${base}${path}`);
  const ok = got.ok === want.ok && (want.ok || got.blocked === want.blocked);
  if (ok) console.log(`ok    ${label}`);
  else {
    failed += 1;
    console.log(`FAIL  ${label}\n        got ok=${got.ok} blocked=${got.blocked}; ${got.reason ?? ""}`);
  }
};

console.log("\nAgainst a real server, over real HTTP:");

await check("the generated app opens", "/app", { ok: true });
await check("a 401 sign-in wall is protection", "/401", { ok: false, blocked: true });
await check("and so is a 403", "/403", { ok: false, blocked: true });

/* THE ONE THE SOURCE READING MISSED. Vercel answers a browser with its
   sign-in page, status 200. Every status-code check in the world calls that
   a working site. */
await check("a 200 carrying Vercel's sign-in page is protection", "/sso", { ok: false, blocked: true });

/* Protection and a missing deployment need different answers: one is a
   setting, the other is gone. */
await check("Vercel's own 404 is not protection", "/gone", { ok: false, blocked: false });
await check("a 500 is the app failing, not protection", "/boom", { ok: false, blocked: false });

/* The false positive worth guarding: an app whose own code contains the string
   NOT_FOUND must not be condemned as Vercel's error page. */
await check("an app whose code says NOT_FOUND still opens", "/app", { ok: true });

server.close();
console.log(failed === 0 ? "\nAll passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
