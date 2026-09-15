#!/usr/bin/env node
/* Whether the live site can be shown inside the workspace.
 *
 *   npm run check:framable
 *
 * "The site is up" and "the site can be put in an iframe" are different
 * questions, and the pane only ever asked the first. The gap has a signature
 * people report exactly: the address opens cleanly in a tab and breaks in the
 * preview pane. A page that refuses framing gives the browser no visible error
 * — just a blank rectangle — and nothing on the server hears about it, so the
 * customer's reasonable conclusion is that the app this platform built them is
 * broken.
 *
 * Run against a real HTTP server on localhost rather than a mocked fetch,
 * because what is being tested is the reading of real response headers. No
 * keys and no outside network: the server below is started, asked, and stopped.
 *
 * The asymmetry in the last test is the important one. Being wrong by refusing
 * to frame a working site costs a live view the in-builder renderer
 * substitutes for; being wrong by framing a blocked one costs the customer a
 * blank rectangle with no explanation. So anything unrecognised must come back
 * framable.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import http from "node:http";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-framable");
mkdirSync(out, { recursive: true });

writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify(
    {
      extends: join(root, "tsconfig.json"),
      compilerOptions: {
        noEmit: false, outDir: out, rootDir: join(root, "src"),
        module: "commonjs", moduleResolution: "node",
        declaration: false, incremental: false, plugins: [],
        baseUrl: root, paths: { "@/*": ["src/*"] },
      },
      include: [join(root, "src/lib/publish/framable.ts")],
    },
    null,
    2,
  ),
);
try {
  execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { stdio: ["ignore", "ignore", "pipe"] });
} catch {}
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));

const require = createRequire(import.meta.url);
const { canBeFramed } = require(join(out, "lib/publish/framable.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const HTML = "<!doctype html><title>site</title><h1>live site</h1>";

const server = http.createServer((req, res) => {
  const headers = { "content-type": "text/html" };
  switch (req.url) {
    case "/deny": headers["x-frame-options"] = "DENY"; break;
    case "/same": headers["X-Frame-Options"] = "SAMEORIGIN"; break;
    case "/allowall": headers["x-frame-options"] = "ALLOWALL"; break;
    case "/csp-none": headers["content-security-policy"] = "default-src 'self'; frame-ancestors 'none'"; break;
    case "/csp-any": headers["content-security-policy"] = "frame-ancestors *"; break;
    case "/csp-us": headers["content-security-policy"] = "frame-ancestors https://quickstark.tech"; break;
    case "/csp-other": headers["content-security-policy"] = "frame-ancestors https://example.com"; break;
    case "/csp-noframe": headers["content-security-policy"] = "default-src 'self'"; break;
    case "/401": res.writeHead(401, headers); res.end("nope"); return;
    case "/403": res.writeHead(403, headers); res.end("nope"); return;
    case "/404": res.writeHead(404, headers); res.end("gone"); return;
    case "/500": res.writeHead(500, headers); res.end("boom"); return;
    default: break;
  }
  res.writeHead(200, headers);
  res.end(HTML);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const US = "https://quickstark.tech";

const cases = [
  ["/", "an ordinary 200 can be framed", true],
  ["/deny", "X-Frame-Options: DENY cannot", false],
  ["/same", "X-Frame-Options: SAMEORIGIN cannot — we are not its origin", false],
  ["/allowall", "X-Frame-Options: ALLOWALL is not a refusal", true],
  ["/csp-none", "frame-ancestors 'none' cannot", false],
  ["/csp-any", "frame-ancestors * can", true],
  ["/csp-us", "frame-ancestors naming this platform can", true],
  ["/csp-other", "frame-ancestors naming somebody else cannot", false],
  ["/csp-noframe", "a CSP with no frame-ancestors at all is not a refusal", true],
  /* The one that produces the reported symptom. Vercel's Deployment Protection
     answers 401 to a request with no team cookie — which is every cross-site
     frame — while the same URL opens fine in a tab that has one. */
  ["/401", "a 401 cannot be framed", false],
  ["/403", "a 403 cannot be framed", false],
  /* Generous about the rest: a site is allowed to answer oddly at / and still
     be perfectly framable everywhere it matters. */
  ["/404", "a 404 is odd but not a framing refusal", true],
  ["/500", "nor is a server error", true],
];

for (const [path, label, expected] of cases) {
  const result = await canBeFramed(base + path, US);
  has(result.ok === expected, label, `framable=${result.ok}${result.ok ? "" : ` — ${result.reason}`}`);
}

/* The reason has to be worth reading: it is shown to somebody who is not an
   engineer and whose project is, in fact, fine. */
{
  const protectedSite = await canBeFramed(`${base}/401`, US);
  has(
    !protectedSite.ok && /Deployment Protection/.test(protectedSite.reason),
    "a protected deployment is named as such, not reported as a broken build",
    protectedSite.ok ? "" : protectedSite.reason,
  );
  has(
    !protectedSite.ok && /built and is running/.test(protectedSite.reason),
    "and says the project itself is fine",
  );
}

/* Unreachable, timed out, or anything this cannot read: framable. Being wrong
   this way costs a live view; being wrong the other way costs a blank pane
   with no explanation. */
{
  const dead = await canBeFramed("http://127.0.0.1:9/nothing", US);
  has(dead.ok, "a host that cannot be reached defaults to framable");

  const nonsense = await canBeFramed("not-a-url", US);
  has(nonsense.ok, "so does an address that is not one");
}

server.close();

console.log(failed === 0 ? "\nAll framable checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
