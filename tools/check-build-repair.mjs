#!/usr/bin/env node
/* Putting right a build the deploy refused, without being asked.
 *
 *   npm run check:build-repair
 *
 * A failed deployment leaves the customer with a project that is finished,
 * paid for, stored, and not on the internet — plus a build log, which is
 * evidence rather than an answer. The log names the file and the line. The
 * source is in our own database. Nothing was reading one against the other.
 *
 * The part tested here is the decision, not the model: which file a log is
 * about, when there is no file to act on, and when the deterministic repair
 * settles it for nothing. The model half needs a key and is not run here — but
 * it is also the half that matters least, because most of what `next build`
 * refuses in generated code has a deterministic fix.
 *
 * THE REFUSALS ARE THE IMPORTANT TESTS. A repair that guesses at somebody's
 * source because we would rather not report a failure is not a repair, it is an
 * automatic corruption of a project the customer cannot get back.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-build-repair");
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
      include: [join(root, "src/lib/builder/repair-build.ts")],
    },
    null,
    2,
  ),
);

execFileSync("npx", ["tsc", "-p", join(out, "tsconfig.json")], { stdio: ["ignore", "ignore", "inherit"] });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));

/* tsc emits `@/...` exactly as it was written, and node has never heard of the
   alias. A node_modules/@ pointing back at the output makes it resolve, which
   is the same trick check-generated-types.mjs uses one directory over. */
const shim = join(out, "node_modules");
mkdirSync(shim, { recursive: true });
try { execFileSync("ln", ["-sfn", out, join(shim, "@")]); } catch { /* already there */ }

const require = createRequire(import.meta.url);
const { failingFile, repairFromLog } = require(join(out, "lib/builder/repair-build.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const file = (path, content) => ({ path, content });

const TREE = [
  file("app/layout.tsx", `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
`),
  file("app/page.tsx", `export default function Home() { return <main>home</main>; }\n`),
  file("app/products/page.tsx", `import { Shirt } from "lucide-react";

const ICONS: Record<string, JSX.Element> = { clothing: <Shirt /> };

export default function Products() {
  return <main>{Object.keys(ICONS).length}</main>;
}
`),
  file("components/Nav.tsx", `export default function Nav() { return <nav />; }\n`),
  file("next.config.mjs", `const nextConfig = { output: "export" };\nexport default nextConfig;\n`),
];

/* ── Which file a log is about ───────────────────────────────────────────── */
{
  const log = `./app/products/page.tsx:3:38
Type error: Cannot find namespace 'JSX'.`;
  has(failingFile(log, TREE) === "app/products/page.tsx", "a compiler path resolves to the file in the tree", failingFile(log, TREE));
}
{
  const log = `Failed to compile.\n./components/Nav.tsx\nError: something`;
  has(failingFile(log, TREE) === "components/Nav.tsx", "with or without a line and column");
}
{
  const log = `./app/checkout/page.tsx:9:1\nType error: nope`;
  has(
    failingFile(log, TREE) === null,
    "a file the project does not have is not resolved to something near it",
    "a fuzzy match on a filename is how a repair lands in the wrong file",
  );
}
{
  const log = "Error: Command \"npm run build\" exited with 1";
  has(failingFile(log, TREE) === null, "a log that names no file resolves to nothing");
}
{
  const log = `./next.config.mjs\nError: bad config`;
  has(
    failingFile(log, TREE) === null,
    "and a platform-owned file is never handed to a model",
    "a build failing in next.config.mjs is our bug; a model rewriting it would bury the evidence",
  );
}

/* ── The free half, which settles most of it ─────────────────────────────── */
{
  const log = `./app/products/page.tsx:3:38
Type error: Cannot find namespace 'JSX'.`;
  const repair = await repairFromLog(log, TREE);

  has(repair.ok === true, "the JSX namespace failure is repaired", repair.ok ? "" : repair.reason);
  has(repair.ok && repair.how === "structural", "deterministically, with no model call and no cost");
  has(
    repair.ok && repair.changed.includes("app/products/page.tsx"),
    "naming the file it changed",
    repair.ok ? repair.changed.join(", ") : "",
  );

  const fixed = repair.ok && repair.tree.find((f) => f.path === "app/products/page.tsx").content;
  has(
    typeof fixed === "string" && /import type \{ JSX \} from "react"/.test(fixed),
    "by importing the namespace React 19 stopped providing globally",
  );
  has(
    typeof fixed === "string" && /Shirt/.test(fixed) && /export default function Products/.test(fixed),
    "and leaving the rest of the file alone",
  );
}

/* ── And the refusals ──────────────────────────────────────────────────────
 *
 * Against a tree with nothing deterministically wrong with it, because the free
 * pass above fixes what it can whatever the log says — which is right (those
 * defects would fail the build too) and would mask every refusal below. */
const SOUND = TREE.map((f) =>
  f.path === "app/products/page.tsx"
    ? file("app/products/page.tsx", `import type { JSX } from "react";
import { Shirt } from "lucide-react";

const ICONS: Record<string, JSX.Element> = { clothing: <Shirt /> };

export default function Products() {
  return <main>{Object.keys(ICONS).length}</main>;
}
`)
    : f,
);

{
  const clean = await repairFromLog("./app/products/page.tsx:3:1\nType error", SOUND);
  has(
    clean.ok === false || clean.how !== "structural",
    "the free pass finds nothing to do on a sound tree",
    clean.ok ? clean.how : clean.reason,
  );
}

{
  const repair = await repairFromLog("Error: Command \"npm run build\" exited with 1", SOUND);
  has(repair.ok === false, "a log with nothing specific in it is refused rather than guessed at");
  has(
    !repair.ok && /does not name a file/.test(repair.reason),
    "with a reason that says why",
    repair.ok ? "" : repair.reason,
  );
}
{
  const repair = await repairFromLog("./app/page.tsx:1:1\nType error", []);
  has(repair.ok === false, "an empty tree is refused");
}
{
  const repair = await repairFromLog("./next.config.mjs\nError: bad config", SOUND);
  has(
    repair.ok === false,
    "a failure in a file the model does not own is reported, not repaired",
    repair.ok ? "repaired anyway" : repair.reason,
  );
}

/* ── The bound, and where it is kept ─────────────────────────────────────── */
const settle = readFileSync(join(root, "src/lib/publish/settle.ts"), "utf8");

has(/const MAX_REPAIRS = 2;/.test(settle), "two attempts, no more");
has(
  /repair:\$\{attempt \+ 1\}:\$\{root\}/.test(settle),
  "counted on the build row itself, so the count survives a restart",
  "an in-memory counter resets and the loop becomes unbounded",
);
has(
  /if \(attempt >= MAX_REPAIRS\) return false;/.test(settle),
  "and past it this behaves exactly as it did before",
);
has(
  !/chargeCredits/.test(settle),
  "nothing is charged for a repair",
  "the customer paid for a build; this is that build not having worked",
);
has(
  /\.insert\(\{\s*project_id: build\.project_id/.test(settle),
  "the repair is stored as a NEW build, so undo is a version rather than an overwrite",
);
has(
  /\.delete\(\)\.eq\("id", fixed\.id\)/.test(settle),
  "and a build row whose files did not store is withdrawn",
  "a row claiming files it does not have is worse than no row",
);

console.log(failed === 0 ? "\nAll build repair checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
