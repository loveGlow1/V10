#!/usr/bin/env node
/* The pause switch, and the places that must honour it.
 *
 *   npm run check:availability
 *
 * This guards a promise made to people rather than a behaviour of the code:
 * when the builder cannot work, nobody is shown progress toward something that
 * cannot happen. On 2026-09-02 the generation key ran out of credit and every
 * build spent minutes on a spinner before failing — the call had actually been
 * refused in 385ms. The switch is what stops that; these are the ways it could
 * quietly stop stopping it.
 *
 * The parsing half is executed. The wiring half is read out of the source,
 * which is coarser than a test but catches the failure that matters: somebody
 * removing a guard without noticing that three of them were load-bearing.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "node_modules", ".cache", "quickstark-availability");
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
    files: [join(process.cwd(), "src/lib/builder/availability.ts")],
  }),
);

let failed = 0;
const ok = (t, d) => console.log(`ok    ${t}${d !== undefined ? ` — ${d}` : ""}`);
function fail(t, d) { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); }
const is = (got, want, t) => (got === want ? ok(t, String(got)) : fail(t, `expected ${want}, got ${got}`));
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

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
          return `${q}${prefix}${existsSync(asFile) ? `${rest}.js` : `${rest}/index.js`}${q}`;
        }));
    }
  };
  rewrite(out);

  const availability = await import(join(out, "lib/builder/availability.js"));

  const withEnv = (value, message) => {
    const previous = [process.env.BUILDER_PAUSED, process.env.BUILDER_PAUSED_MESSAGE];
    if (value === undefined) delete process.env.BUILDER_PAUSED;
    else process.env.BUILDER_PAUSED = value;
    if (message === undefined) delete process.env.BUILDER_PAUSED_MESSAGE;
    else process.env.BUILDER_PAUSED_MESSAGE = message;
    const result = availability.builderAvailability();
    if (previous[0] === undefined) delete process.env.BUILDER_PAUSED;
    else process.env.BUILDER_PAUSED = previous[0];
    if (previous[1] === undefined) delete process.env.BUILDER_PAUSED_MESSAGE;
    else process.env.BUILDER_PAUSED_MESSAGE = previous[1];
    return result;
  };

  // ── Running is the default ──────────────────────────────────────────────
  console.log("Running unless told otherwise:");
  is(withEnv(undefined).paused, false, "unset means running");
  is(withEnv("").paused, false, "empty means running");
  is(withEnv("false").paused, false, '"false" means running');
  is(withEnv("no").paused, false, '"no" means running');
  /* The one that matters most. A typo must fail OPEN — an app that refuses
     every build because somebody wrote "ture" is a worse outage than the one
     the switch was for. */
  is(withEnv("ture").paused, false, "a typo fails open, not closed");

  console.log("Paused when told:");
  is(withEnv("true").paused, true, '"true" pauses');
  is(withEnv("TRUE").paused, true, "case does not matter");
  is(withEnv("  true  ").paused, true, "whitespace does not matter");
  is(withEnv("1").paused, true, '"1" pauses');
  is(withEnv("yes").paused, true, '"yes" pauses');

  console.log("There is always something to say:");
  has(withEnv("true").message.length > 20, "the default message is a real sentence");
  is(withEnv("true", "Back at nine.").message, "Back at nine.", "a custom message wins");
  is(withEnv("true", "   ").message, availability.DEFAULT_PAUSE_MESSAGE, "a blank custom message falls back");
  has(
    /nothing has been charged|not been charged/i.test(availability.DEFAULT_PAUSE_MESSAGE),
    "the default says nothing was charged",
    "it is the first thing anyone wonders, so it should not need asking",
  );

  // ── The places that must honour it ──────────────────────────────────────
  console.log("Everywhere that must honour it still does:");

  const route = read("src/app/api/build/route.ts");
  has(route.includes("builderAvailability()"), "the build route asks", "nothing else can be trusted if the server does not check");
  /* The gate must sit ABOVE the classifier. Classifying is itself a model call,
     so asking a dead key what a message means — in order to say the key is
     dead — repeats the bug one level down. */
  const gateAt = route.indexOf("const availability = builderAvailability()");
  const classifyAt = route.indexOf("await classifyIntent(");
  has(gateAt > 0 && classifyAt > 0 && gateAt < classifyAt, "and asks BEFORE classifying", "a model call to explain that model calls are down");
  has(
    route.includes("wantsDownload(prompt)") && route.includes('override === "revert"'),
    "the two model-free paths still work while paused",
    "download and undo need no model; refusing them makes the outage look bigger than it is",
  );

  has(existsSync(join(process.cwd(), "src/app/api/builder/status/route.ts")), "the status route exists");
  const status = read("src/app/api/builder/status/route.ts");
  has(status.includes('dynamic = "force-dynamic"'), "status is never cached", "a cached one keeps announcing an outage that ended");

  for (const [label, path] of [
    ["the workspace composer", "src/app/dashboard/components/workspace/ChatPanel.tsx"],
    ["home", "src/app/dashboard/page.tsx"],
  ]) {
    const source = read(path);
    has(source.includes("/api/builder/status"), `${label} asks the server`);
    has(source.includes("paused"), `${label} holds the answer`);
  }

  const button = read("src/app/dashboard/components/StartBuildButton.tsx");
  has(
    /if \(disabled\) return;/.test(button),
    "Home's send is guarded inside start(), not only on the button",
    "Home fires this through a ref on Enter, which never touches the disabled attribute",
  );

  console.log(failed ? `\n${failed} failed.` : "\nAll passed.");
  process.exit(failed ? 1 : 0);
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(1);
}
