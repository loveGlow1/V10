#!/usr/bin/env node
/* The QA gates, run against a file, with a real browser.
 *
 *   node tools/qa.mjs <file.html> [--kind ecommerce] [--json]
 *
 * This is the half the pipeline cannot do. src/lib/builder/qa runs its static
 * gates inside the save route on every build, because they need nothing but the
 * document — but layout is what a browser computes, and there is no browser in
 * a serverless function. So the rendered gates live here, where there is one.
 *
 * Same library, same gates, same result shape. The only difference is that this
 * supplies a Renderer and the pipeline does not, which is exactly the
 * distinction the `ran` flag on every gate exists to carry: a run without a
 * browser reports the rendered gates as not exercised rather than as passed.
 *
 * Chromium is found rather than installed. Playwright's browsers are already on
 * the machines this runs on (CI, and the container this was written in) and a
 * QA tool that downloads fifty megabytes on first use is a QA tool nobody runs
 * twice. With none available it still runs the static gates and says which half
 * it did.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const asJson = args.includes("--json");
const kind = args[args.indexOf("--kind") + 1] ?? "landing";

if (!file) {
  console.error(
    "usage: node tools/qa.mjs <file.html> [--kind ecommerce] [--design 'Warm craft'] [--brief 'what the customer said'] [--json]",
  );
  process.exit(2);
}

/* ── The library, compiled ────────────────────────────────────────────────*/

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-qa");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify({
    compilerOptions: {
      outDir: ".",
      rootDir: join(process.cwd(), "src"),
      module: "esnext",
      target: "es2022",
      moduleResolution: "bundler",
      skipLibCheck: true,
      strict: true,
      paths: { "@/*": [join(process.cwd(), "src", "*")] },
    },
    files: [join(process.cwd(), "src/lib/builder/qa/index.ts")],
  }),
);

execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "inherit"] });

/* tsc leaves specifiers as written; node's ESM loader needs the extension. The
   same rewrite every check-*.mjs in this directory does, for the same reason. */
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    writeFileSync(
      path,
      readFileSync(path, "utf8")
        .replace(/(from\s+["'])@\/([^"']+)(["'])/g, (_, before, rest, after) => {
          const depth = path.slice(out.length + 1).split("/").length - 1;
          return `${before}${"../".repeat(depth)}${rest}.js${after}`;
        })
        .replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (whole, before, specifier, after) =>
          specifier.endsWith(".js") ? whole : `${before}${specifier}.js${after}`,
        ),
    );
  }
};
walk(out);

const qa = await import(join(out, "lib/builder/qa/index.js"));
const design = await import(join(out, "lib/builder/design.js")).catch(() => null);

/* ── A browser, if there is one ───────────────────────────────────────────*/

function chromiumPath() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers"].filter(Boolean);

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith("chromium")) continue;
      for (const candidate of [
        join(root, entry, "chrome-linux", "chrome"),
        join(root, entry, "chrome-linux", "headless_shell"),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  for (const candidate of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/* Chromium driven over its DevTools protocol directly, rather than through
   playwright.
 *
 * Playwright would be the obvious choice and is a dependency this repository
 * does not have — adding one so a QA tool can measure four numbers is a lot of
 * weight for the job. The protocol is a websocket and three commands, and using
 * it keeps this runnable anywhere a Chromium binary exists. */
async function makeRenderer(binary) {
  const { spawn } = await import("node:child_process");
  const { setTimeout: sleep } = await import("node:timers/promises");

  return async function render(html, viewport) {
    const child = spawn(binary, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--remote-debugging-port=0",
      `--window-size=${viewport.width},${viewport.height}`,
      "about:blank",
    ]);

    try {
      /* The port is written to stderr on startup. Waiting for the line is the
         only reliable way to learn it when the port was chosen for us. */
      const endpoint = await new Promise((resolve, reject) => {
        let buffer = "";
        const timer = setTimeout(() => reject(new Error("chromium did not start")), 15000);
        child.stderr.on("data", (chunk) => {
          buffer += chunk.toString();
          const match = buffer.match(/ws:\/\/[^\s]+/);
          if (match) {
            clearTimeout(timer);
            resolve(match[0]);
          }
        });
        child.on("exit", () => {
          clearTimeout(timer);
          reject(new Error("chromium exited"));
        });
      });

      /* Node's own WebSocket, not the `ws` package. It has been global and
         stable since Node 22, which is what this repository runs, and adding a
         dependency so a QA tool can open one socket is weight for nothing. Note
         the API is the browser's — addEventListener and event.data — rather
         than the EventEmitter one `ws` exposes. */
      if (typeof WebSocket !== "function") {
        throw new Error("this Node has no WebSocket; the rendered gates need one");
      }

      const socket = new WebSocket(endpoint);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });

      let id = 0;
      const pending = new Map();
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(typeof event.data === "string" ? event.data : "");
        const resolver = pending.get(message.id);
        if (resolver) {
          pending.delete(message.id);
          resolver(message);
        }
      });

      const send = (method, params = {}, sessionId) =>
        new Promise((resolve) => {
          const messageId = ++id;
          pending.set(messageId, resolve);
          socket.send(JSON.stringify({ id: messageId, method, params, sessionId }));
        });

      const { result: targets } = await send("Target.getTargets");
      const page = targets.targetInfos.find((target) => target.type === "page");
      const { result: attached } = await send("Target.attachToTarget", {
        targetId: page.targetId,
        flatten: true,
      });
      const session = attached.sessionId;

      await send("Page.enable", {}, session);
      await send("Runtime.enable", {}, session);
      await send(
        "Emulation.setDeviceMetricsOverride",
        { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 500 },
        session,
      );

      await send(
        "Page.navigate",
        { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` },
        session,
      );
      /* Long enough for layout, fonts and any inline script that builds the
         page. Measuring before that reports an empty document as a broken one. */
      await sleep(1200);

      const { result } = await send(
        "Runtime.evaluate",
        { expression: qa.MEASURE_SCRIPT, returnByValue: true, awaitPromise: false },
        session,
      );

      socket.close();

      if (!result?.result?.value) throw new Error("the page returned no measurement");
      return { viewport: viewport.name, ...result.result.value };
    } finally {
      child.kill("SIGKILL");
    }
  };
}

/* ── Run ──────────────────────────────────────────────────────────────────*/

let html = readFileSync(file, "utf8");
const binary = chromiumPath();

let render;
if (binary) {
  try {
    render = await makeRenderer(binary);
  } catch {
    render = undefined;
  }
}

/* The design system is looked up rather than inferred: a file on disk carries
   no record of which one it was built to, so this only judges design adherence
   when told. Without it the design gate reports as not run, which is honest. */
const systemName = args[args.indexOf("--design") + 1];
const dna = systemName && design ? design.systemByName(systemName) : null;

const manifest = {
  type: kind,
  frontend: true,
  backend: false,
  database: false,
  authentication: false,
  admin: false,
  storage: false,
  payments: false,
};

/* What the customer supplied, for the content gate.
 *
 * Given on the command line because a file on disk carries no record of the
 * brief it was built from. Without it the gate reports itself not run, which is
 * the honest answer: with nothing to check the figures against, every number on
 * the page is equally unexplained and flagging them all would say nothing. */
const briefIndex = args.indexOf("--brief");
const brief = briefIndex === -1 ? null : args[briefIndex + 1] ?? "";

/* --fix applies the mechanical repairs first, exactly as the build pipeline
   does, and says what it changed. Without it this reports a page the pipeline
   would never have shipped in that state — which makes the numbers here
   pessimistic rather than wrong, but not comparable. */
if (args.includes("--fix")) {
  const repaired = qa.autofix(html);
  html = repaired.html;
  if (repaired.applied.length > 0) {
    console.log(`\nRepaired before checking: ${qa.describeFixes(repaired.applied)}`);
  }
  if (args.includes("--write")) {
    writeFileSync(file, html);
    console.log(`Wrote the repairs back to ${file}`);
  }
}

const result = await qa.runQa({
  html,
  tree: [],
  manifest,
  design: dna,
  render,
  evidence: brief === null ? undefined : qa.evidenceFrom(brief),
});

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "failed" ? 1 : 0);
}

console.log(`\n${file} — ${result.status.toUpperCase()}`);
if (!render) {
  console.log("  (no browser found, so the rendered gates were not exercised)");
} else {
  console.log(`  rendered at ${qa.VIEWPORTS.map((viewport) => viewport.width).join(", ")}px`);
}
if (brief === null) {
  console.log("  (no --brief, so the figures on the page were not checked against anything)");
}
console.log("");

for (const gate of qa.GATES) {
  const entry = result[gate];
  const mark = !entry.ran ? "–" : entry.passed ? "✓" : "✗";
  const state = !entry.ran ? "not run" : entry.passed ? "passed" : "failed";
  console.log(`  ${mark} ${gate.padEnd(14)} ${state}`);
  for (const issue of entry.issues) {
    console.log(`      ${issue.severity === "error" ? "!" : "·"} ${issue.message}`);
  }
}

console.log("");
process.exit(result.status === "failed" ? 1 : 0);
