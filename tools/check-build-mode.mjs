#!/usr/bin/env node
/* Static or server, decided by reading the project.
 *
 *   npm run check:build-mode
 *
 * Every project this platform builds used to be `output: "export"` — a
 * directory of files, served from a CDN, talking to Supabase from the browser.
 * That is right about 95% of the time and it stays the default: nothing to
 * provision, nothing to keep warm, previewable and downloadable without a
 * server existing anywhere.
 *
 * The other 5% cannot be done that way at all, and the two halves fail
 * differently, which is why this check exists rather than a comment:
 *
 *   - a route handler under `output: "export"` FAILS THE BUILD, loudly;
 *   - a `middleware.ts` under it is SILENTLY IGNORED — the build succeeds, the
 *     site deploys, and the route guard protects nothing.
 *
 * The second is the one worth writing a check for. Nobody reports a bug that
 * compiles.
 *
 * The rule the whole module is built on: it only ever RAISES. A static config
 * over server code is a broken build; a server config over static code is a
 * working site that costs a little more to host. When the code and the config
 * disagree, the expensive answer is the safe one.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-build-mode");
mkdirSync(out, { recursive: true });

execFileSync(
  "npx",
  ["tsc", "src/lib/builder/build-mode.ts", "src/lib/builder/scaffold.ts",
   "src/lib/builder/architecture.ts", "src/lib/builder/schema.ts", "src/lib/builder/tree.ts",
   "--outDir", out, "--rootDir", "src", "--module", "esnext", "--target", "es2022",
   "--moduleResolution", "bundler", "--skipLibCheck"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

for (const entry of readdirSync(join(out, "lib/builder"))) {
  if (!entry.endsWith(".js")) continue;
  const path = join(out, "lib/builder", entry);
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(
      /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
      (whole, before, specifier, after) =>
        specifier.endsWith(".js") ? whole : `${before}${specifier}.js${after}`,
    ),
  );
}

const { buildModeOf, isServerBuild } = await import(join(out, "lib/builder/build-mode.js"));
const scaffold = await import(join(out, "lib/builder/scaffold.js"));
const schema = await import(join(out, "lib/builder/schema.js"));

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const file = (path, content) => ({ path, content });

const PAGE = file("app/page.tsx", `"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const [rows, setRows] = useState([]);
  useEffect(() => { void supabase.from("posts").select("*").then(({ data }) => setRows(data ?? [])); }, []);
  return <main>{rows.length}</main>;
}
`);
const LAYOUT = file("app/layout.tsx", `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
`);

const STATIC_TREE = [PAGE, LAYOUT];

/* ── The default, and it has to stay the default ─────────────────────────── */
{
  const verdict = buildModeOf(STATIC_TREE);
  has(verdict.mode === "static", "an ordinary project is static", verdict.because.join("; "));
  has(verdict.because.length === 0, "with nothing to justify, because the default needs no justification");
  has(isServerBuild(STATIC_TREE) === false, "and the shorthand agrees");
}

/* ── The four things that need a server ──────────────────────────────────── */
const TRIGGERS = [
  [
    "a route handler",
    file("app/api/contact/route.ts", `export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ ok: true, body });
}
`),
    /answers requests/,
  ],
  [
    "a server action",
    file("app/actions.ts", `"use server";

export async function subscribe(email: string) {
  return email;
}
`),
    /use server/,
  ],
  [
    "root middleware",
    file("middleware.ts", `import { NextResponse } from "next/server";

export function middleware() {
  return NextResponse.next();
}
`),
    /ignores rather than refuses/,
  ],
  [
    "a secret key",
    file("lib/billing.ts", `const key = process.env.STRIPE_SECRET_KEY;

export function charge() { return key; }
`),
    /STRIPE_SECRET_KEY/,
  ],
  [
    "a server-only package",
    file("lib/mail.ts", `import { Resend } from "resend";

export const mailer = new Resend("");
`),
    /resend/,
  ],
];

for (const [label, extra, expected] of TRIGGERS) {
  const verdict = buildModeOf([...STATIC_TREE, extra]);
  has(verdict.mode === "server", `${label} makes it a server build`, verdict.because.join("; "));
  has(
    verdict.because.some((why) => expected.test(why)),
    `${label} says why, naming the file`,
    verdict.because.join("; "),
  );
}

/* ── And the things that only LOOK like they do ──────────────────────────── */
const INNOCENT = [
  [
    "a published variable",
    file("lib/config.ts", `export const url = process.env.NEXT_PUBLIC_SUPABASE_URL;\n`),
  ],
  [
    "the build-time flag everything reads",
    file("lib/dev.ts", `export const dev = process.env.NODE_ENV !== "production";\n`),
  ],
  [
    "the browser half of a payments SDK",
    file("lib/pay.ts", `import { loadStripe } from "@stripe/stripe-js";\n\nexport const stripe = loadStripe("pk_test");\n`),
  ],
  [
    "the words in a comment",
    file("lib/notes.ts", `/* Later this will need process.env.OPENAI_API_KEY and a "use server" action. */\nexport const todo = true;\n`),
  ],
  [
    "the words in a string",
    file("app/help/page.tsx", `export default function Help() {\n  return <p>{"Set process.env.STRIPE_SECRET_KEY on your server"}</p>;\n}\n`),
  ],
  [
    "a page that merely mentions api in its path",
    file("app/api-docs/page.tsx", `export default function Docs() { return <main>docs</main>; }\n`),
  ],
];

for (const [label, extra] of INNOCENT) {
  const verdict = buildModeOf([...STATIC_TREE, extra]);
  has(verdict.mode === "static", `${label} stays static`, verdict.because.join("; "));
}

/* ── The config that comes out the other end ─────────────────────────────── */
const MANIFEST = {
  type: "webapp", frontend: true, backend: true, database: true,
  authentication: true, admin: false, storage: false, payments: false,
  realtime: false, email: false,
};
const model = schema.dataModelFor(MANIFEST, "app_probe");
const configOf = (tree) =>
  scaffold.completeTree(tree, "Probe", MANIFEST, model).find((f) => f.path === "next.config.mjs").content;
const packageOf = (tree) =>
  JSON.parse(scaffold.completeTree(tree, "Probe", MANIFEST, model).find((f) => f.path === "package.json").content);

{
  const config = configOf(STATIC_TREE);
  has(/output:\s*"export"/.test(config), "a static project is configured for export");
  has(/unoptimized:\s*true/.test(config), "with the image optimiser off, because nothing is behind it");
  has(/trailingSlash:\s*true/.test(config), "and trailing slashes, so /pricing is a directory");
  has(
    !("@supabase/ssr" in packageOf(STATIC_TREE).dependencies),
    "and no @supabase/ssr, which nothing there would import",
  );
}

{
  const tree = [...STATIC_TREE, TRIGGERS[0][1]];
  const config = configOf(tree);
  has(!/output:\s*"export"/.test(config), "a project with a route handler is NOT configured for export");
  has(/nextConfig/.test(config) && /export default nextConfig/.test(config), "and is still a valid config");
  has(
    packageOf(tree).dependencies["@supabase/ssr"] !== undefined,
    "and gets @supabase/ssr, for the cookie sessions a server can hold",
  );
}

{
  /* The one that would otherwise ship. completeTree has to catch it, because
     nothing downstream will: the build is green and the guard is gone. */
  const config = configOf([...STATIC_TREE, TRIGGERS[2][1]]);
  has(
    !/output:\s*"export"/.test(config),
    "a project with middleware is not exported, which is the silent one",
    "under output: export the middleware is dropped, the build passes, and the route guard protects nothing",
  );
}

/* ── The upgrade, which is the whole reason for two modes ────────────────
 *
 * A landing page acquires a contact form; the form acquires a route handler;
 * the project is now something its next.config.mjs is wrong about. The edit
 * path re-derives the config from the tree, so the project stops being exported
 * at the moment it stops being exportable — nobody asks and nothing is
 * migrated. See retuneBuild. */
{
  const built = scaffold.completeTree(STATIC_TREE, "Probe", MANIFEST, model);
  has(
    /output:\s*"export"/.test(built.find((f) => f.path === "next.config.mjs").content),
    "a project starts its life exported",
  );

  /* The edit: one file added, which is all it takes. */
  const evolved = [...built, TRIGGERS[0][1]];
  const retuned = scaffold.retuneBuild(evolved, "Probe", MANIFEST, model);

  has(retuned.changed === true, "adding a route handler changes the build");
  has(retuned.mode === "server", "to a server one", retuned.mode);
  has(
    !/output:\s*"export"/.test(retuned.tree.find((f) => f.path === "next.config.mjs").content),
    "and the config it goes out with is no longer an export",
  );
  has(
    retuned.because.length > 0 && /route\.ts/.test(retuned.because[0]),
    "with a reason that names the file, so it can be said in a sentence",
    retuned.because.join("; "),
  );

  const deps = JSON.parse(retuned.tree.find((f) => f.path === "package.json").content).dependencies;
  has(deps["@supabase/ssr"] !== undefined, "the cookie-session package is added");
  has(deps.next !== undefined && deps["@supabase/supabase-js"] !== undefined, "and nothing already there is lost");
}

{
  /* The dependency the MODEL added, which a rewritten package.json would
     delete — and the build would then fail on an import the model was told to
     write. zod is the case: the server brief asks for it by name. */
  const built = scaffold.completeTree(STATIC_TREE, "Probe", MANIFEST, model);
  const withZod = built.map((f) =>
    f.path === "package.json"
      ? { ...f, content: JSON.stringify({ ...JSON.parse(f.content), dependencies: { ...JSON.parse(f.content).dependencies, zod: "3.23.8" } }, null, 2) }
      : f);
  const retuned = scaffold.retuneBuild([...withZod, TRIGGERS[0][1]], "Probe", MANIFEST, model);
  const deps = JSON.parse(retuned.tree.find((f) => f.path === "package.json").content).dependencies;

  has(deps.zod === "3.23.8", "a dependency the model added survives the retune", JSON.stringify(deps));
  has(deps["@supabase/ssr"] !== undefined, "alongside the one the retune adds");
}

{
  /* Nothing to do is nothing done. An ordinary edit must not rewrite the
     config, or every edit reports a build-mode change that did not happen. */
  const built = scaffold.completeTree(STATIC_TREE, "Probe", MANIFEST, model);
  const retuned = scaffold.retuneBuild(built, "Probe", MANIFEST, model);
  has(retuned.changed === false, "an ordinary edit changes nothing");
  has(retuned.mode === "static", "and leaves the project static");

  /* And a project already on a server is not rewritten a second time. */
  const server = scaffold.completeTree([...STATIC_TREE, TRIGGERS[0][1]], "Probe", MANIFEST, model);
  const again = scaffold.retuneBuild(server, "Probe", MANIFEST, model);
  has(again.changed === false, "nor is a server project retuned again on every edit");
}

/* ── What the model is told, which has to match the config ───────────────── */
{
  const staticBrief = scaffold.treeBrief("webapp", MANIFEST, model, undefined, 0, "static");
  const serverBrief = scaffold.treeBrief("webapp", MANIFEST, model, undefined, 0, "server");

  has(/STATIC EXPORT\. There is no server/.test(staticBrief), "the static brief says there is no server");
  has(/generateStaticParams/.test(staticBrief), "and asks for generateStaticParams on dynamic routes");

  has(/THIS PROJECT HAS A SERVER/.test(serverBrief), "the server brief says there is one");
  has(
    !/Every dynamic route needs `generateStaticParams`/.test(serverBrief),
    "and stops demanding generateStaticParams, which a server does not need",
  );
  has(/Zod/.test(serverBrief), "server writes are validated with Zod before they reach the database");
  has(/@supabase\/ssr/.test(serverBrief), "and sessions are cookie-based through @supabase/ssr");
  has(
    /root `middleware\.ts`/.test(serverBrief),
    "the server brief names root middleware.ts as something that runs",
  );
  has(
    /no middleware/.test(staticBrief) && !/root `middleware\.ts`/.test(staticBrief),
    "and the static brief forbids it outright, rather than leaving it to be discovered",
    "middleware under output: export is dropped without a word, so the model must simply never write one",
  );

  /* A caller that knows nothing about the two modes must get the safe one. */
  has(
    /STATIC EXPORT/.test(scaffold.treeBrief("webapp", MANIFEST, model)),
    "a caller that says nothing gets the static brief",
  );
}

console.log(failed === 0 ? "\nAll build mode checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
