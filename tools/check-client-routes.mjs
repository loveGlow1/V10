#!/usr/bin/env node
/* The page that cannot be both things.
 *
 *   npm run check:client-routes
 *
 * Next.js refuses a file that is "use client" AND exports generateStaticParams,
 * and a generated project walks into that every time it has a dynamic route:
 * `output: "export"` REQUIRES generateStaticParams there, and a page people can
 * search and filter is interactive. Both halves are right. Together they do not
 * compile, and a twenty-seven file newsroom died on exactly two of them.
 *
 * These assertions are the split that fixes it, and — more importantly — the
 * edges where a rewrite of somebody's source must NOT be clever: a brace inside
 * a string, a name already taken, a shape this does not understand. The last
 * one is the one to read. A repair that guesses is worse than the framework's
 * own error message.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-client-routes");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(config, JSON.stringify({
  extends: join(root, "tsconfig.json"),
  compilerOptions: {
    noEmit: false, outDir: out, rootDir: join(root, "src"),
    module: "commonjs", moduleResolution: "node",
    declaration: false, incremental: false, plugins: [],
    baseUrl: root, paths: { "@/*": ["src/*"] },
  },
  include: [join(root, "src/lib/builder/client-routes.ts")],
}, null, 2));
try {
  execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "pipe"] });
} catch {
  /* tree.ts references Buffer and this config has no node types. The emit is
     what matters and it happens anyway; a real type error is caught by the
     repo's own `tsc --noEmit`, which this does not replace. */
}
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));

const require = createRequire(import.meta.url);
const { splitClientRoutes } = require(join(out, "lib/builder/client-routes.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const at = (tree, path) => tree.find((f) => f.path === path)?.content ?? "";

/* The newsroom's own /[section], near enough to the byte. */
const SECTION = `"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BEATS } from "@/components/Masthead";

export function generateStaticParams() {
  return BEATS.map((b) => ({ section: b.slug }));
}

export default function SectionPage({ params }: { params: { section: string } }) {
  const [n] = useState(0);
  useEffect(() => { void supabase; }, [params.section]);
  return <div>{params.section}{n}</div>;
}
`;

// ── The split ─────────────────────────────────────────────────────────────

const split = splitClientRoutes([{ path: "app/[section]/page.tsx", content: SECTION }]);
const page = at(split, "app/[section]/page.tsx");
const client = at(split, "app/[section]/PageClient.tsx");

has(split.length === 2, "one conflicted page becomes two files", `got ${split.length}`);
has(!/use client/.test(page), "the route file is no longer a client component");
has(/generateStaticParams/.test(page), "the route file keeps generateStaticParams");
has(/use client/.test(client), "the client half keeps the directive");
has(!/generateStaticParams/.test(client), "the client half does not keep it — THE WHOLE POINT");
has(/export default function SectionPage/.test(client), "the model's component is unchanged");

/* The import generateStaticParams depends on has to come with it, or the
   route file does not compile for a new reason. */
has(/import \{ BEATS \} from "@\/components\/Masthead";/.test(page),
  "an import the lifted function uses comes with it");
/* And the ones it does not must NOT: hooks in a server component read as a
   mistake and invite somebody to put the directive back. */
has(!/useState|useEffect/.test(page), "hooks do not follow it into the server file");
has(/import PageClient from ".\/PageClient";/.test(page), "the route renders the client half");

/* params is a Promise in Next 15 and the component below reads it
   synchronously, so the await is what keeps the model's code correct. */
has(/params: Promise<\{ section: string \}>/.test(page), "params is typed as the promise it is");
has(/<PageClient params=\{await params\} \/>/.test(page), "and is awaited before it is passed down");

// ── Route shapes ──────────────────────────────────────────────────────────

const shape = (path) => {
  const tree = splitClientRoutes([{ path, content: SECTION.replace("section: string", "x: string") }]);
  return at(tree, path);
};
has(/params: Promise<\{ slug: string \}>/.test(shape("app/article/[slug]/page.tsx")),
  "a named segment is a string");
has(/params: Promise<\{ slug: string\[\] \}>/.test(shape("app/docs/[...slug]/page.tsx")),
  "a catch-all is an array");
has(/params: Promise<\{ slug\?: string\[\] \}>/.test(shape("app/docs/[[...slug]]/page.tsx")),
  "an optional catch-all may be absent");
has(/params: Promise<\{ a: string; b: string \}>/.test(shape("app/[a]/x/[b]/page.tsx")),
  "two segments both arrive");

/* A STATIC route with generateStaticParams has no params to generate, so the
   function does nothing and splitting the page around it would be ceremony.
   It goes; the page stays one client component. */
const static_ = splitClientRoutes([{ path: "app/about/page.tsx", content: SECTION }]);
has(static_.length === 1, "a static route is not split", `got ${static_.length}`);
has(/use client/.test(at(static_, "app/about/page.tsx")), "it stays a client component");
has(!/generateStaticParams/.test(at(static_, "app/about/page.tsx")),
  "the function that did nothing is dropped");

// ── What must not be touched ──────────────────────────────────────────────

const innocent = [
  { path: "app/page.tsx", content: `"use client";\nexport default function P() { return null; }` },
  { path: "app/[id]/page.tsx", content: `export function generateStaticParams() { return []; }\nexport default function P() { return null; }` },
  { path: "lib/data.ts", content: `export const x = 1;` },
];
has(JSON.stringify(splitClientRoutes(innocent)) === JSON.stringify(innocent),
  "a tree with no conflict is returned untouched");

/* "use client" that is not the first thing in the file is a string in
   somebody's code. Next.js does not treat it as a directive and neither may
   this — rewriting that file would break working code. */
const mention = [{
  path: "app/[id]/page.tsx",
  content: `export function generateStaticParams() { return []; }\nconst note = "use client";\nexport default function P() { return <i>{note}</i>; }`,
}];
has(JSON.stringify(splitClientRoutes(mention)) === JSON.stringify(mention),
  "a 'use client' further down the file is a string, not a directive");

// ── The brace scanner ─────────────────────────────────────────────────────
//
// Finding where the function ends is done by counting braces, and generated
// React is full of braces that do not count.

const TRICKY = `'use client';
export function generateStaticParams() {
  const s = "a { brace in a string";
  const t = \`a \${"nested"} template { brace\`;
  // a { brace in a comment
  /* another } one */
  const r = { a: 1, b: { c: 2 } };
  return [{ id: s.length + t.length + r.b.c }];
}

export default function P() { return <b>{"}"}</b>; }
`;
const tricky = splitClientRoutes([{ path: "app/[id]/page.tsx", content: TRICKY }]);
has(tricky.length === 2, "a function full of awkward braces is still found");
has(/return \[\{ id: s\.length/.test(at(tricky, "app/[id]/page.tsx")),
  "the whole function comes across, not part of it");
has(/export default function P/.test(at(tricky, "app/[id]/PageClient.tsx")),
  "and the component after it stays behind");
has(!/generateStaticParams/.test(at(tricky, "app/[id]/PageClient.tsx")),
  "with nothing of the function left in it");
has(/^'use client';/.test(at(tricky, "app/[id]/PageClient.tsx")),
  "a single-quoted directive is a directive too");

/* async, which a generateStaticParams that reads a database would be. */
const asy = splitClientRoutes([{
  path: "app/[id]/page.tsx",
  content: `"use client";\nexport async function generateStaticParams() { return []; }\nexport default function P() { return null; }`,
}]);
has(/export async function generateStaticParams/.test(at(asy, "app/[id]/page.tsx")),
  "an async generateStaticParams is lifted too");

/* THE ONE THAT MATTERS MOST. A brace that never closes means this cannot know
   where the function ends, and a rewrite based on a guess would corrupt
   somebody's source. The build then fails with the framework's own message,
   which is a worse build and a better failure. */
const broken = [{
  path: "app/[id]/page.tsx",
  content: `"use client";\nexport function generateStaticParams() { return [{ id: "x" }];\nexport default function P() { return null; }`,
}];
has(JSON.stringify(splitClientRoutes(broken)) === JSON.stringify(broken),
  "a function it cannot read is LEFT ALONE rather than guessed at");

// ── Names already in use ──────────────────────────────────────────────────

const collide = splitClientRoutes([
  { path: "app/[id]/page.tsx", content: SECTION },
  { path: "app/[id]/PageClient.tsx", content: "export default function Existing() { return null; }" },
]);
has(/export default function Existing/.test(at(collide, "app/[id]/PageClient.tsx")),
  "an existing file of that name is not overwritten");
has(collide.some((f) => f.path === "app/[id]/RouteClient.tsx"),
  "the client half takes the next name instead");
has(/import RouteClient from ".\/RouteClient";/.test(at(collide, "app/[id]/page.tsx")),
  "and the route imports the name it actually used");

// ── Running it twice ──────────────────────────────────────────────────────
//
// It runs in completeTree AND at deploy time, so a tree can meet it twice.

const once = splitClientRoutes([{ path: "app/[section]/page.tsx", content: SECTION }]);
has(JSON.stringify(splitClientRoutes(once)) === JSON.stringify(once),
  "splitting an already-split tree changes nothing");

console.log(failed === 0 ? "\nall good" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
