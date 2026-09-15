#!/usr/bin/env node
/* The App Router's conventions, read off a directory.
 *
 *   npm run check:preview-routes
 *
 * The in-builder preview renders a generated project by reading its files the
 * way Next.js would: `app/blog/[slug]/page.tsx` is a route because of where it
 * sits, `app/(marketing)/pricing` is `/pricing` because parentheses organise
 * files rather than addresses, and the layouts wrapping a page are every
 * layout.tsx on the real path down to it — INCLUDING the one inside the route
 * group, which is the whole reason somebody made the group.
 *
 * Getting any of that wrong shows the customer the wrong screen confidently,
 * which is worse than the summary this replaced. So the precedence rules are
 * pinned here: a literal beats a parameter, a parameter beats a catch-all, and
 * a preview never opens on a dynamic route while a static one exists.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-preview-routes");
mkdirSync(out, { recursive: true });

const config = join(out, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify(
    {
      extends: join(root, "tsconfig.json"),
      compilerOptions: {
        noEmit: false, outDir: out, rootDir: join(root, "src"),
        module: "commonjs", moduleResolution: "node",
        declaration: false, incremental: false, plugins: [],
        baseUrl: root, paths: { "@/*": ["src/*"] },
      },
      include: [join(root, "src/lib/builder/preview/routes.ts")],
    },
    null,
    2,
  ),
);
try {
  execFileSync("npx", ["tsc", "-p", config], { stdio: ["ignore", "ignore", "pipe"] });
} catch {
  /* The emit is what matters; a real type error is caught by the repo's own
     `tsc --noEmit`, which this does not replace. */
}
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "commonjs" }));

const require = createRequire(import.meta.url);
const { routesOf, matchRoute, layoutsFor, patternFor, entryRoute } = require(
  join(out, "lib/builder/preview/routes.js"),
);

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const tree = (...paths) => paths.map((path) => ({ path, content: "" }));

/* ── What a route's address is ──────────────────────────────────────────── */

has(patternFor("app/page.tsx") === "/", "the root page is /");
has(patternFor("app/pricing/page.tsx") === "/pricing", "a folder is a segment");
has(
  patternFor("app/(marketing)/pricing/page.tsx") === "/pricing",
  "a route group is not in the address",
  patternFor("app/(marketing)/pricing/page.tsx"),
);
has(
  patternFor("app/blog/[slug]/page.tsx") === "/blog/[slug]",
  "a dynamic segment keeps its brackets in the pattern",
);

/* ── Which files are routes at all ──────────────────────────────────────── */

{
  const routes = routesOf(
    tree(
      "app/page.tsx",
      "app/layout.tsx",
      "app/_components/Hero.tsx",
      "app/_components/page.tsx",
      "components/Nav.tsx",
      "lib/images.ts",
    ),
  );
  has(routes.length === 1, "only page files are routes", `${routes.length} found`);
  has(
    routes.every((route) => !route.file.includes("_components")),
    "a page inside a private folder is not a route",
  );
}

/* ── Layouts ────────────────────────────────────────────────────────────── */

{
  const files = tree(
    "app/layout.tsx",
    "app/(marketing)/layout.tsx",
    "app/(marketing)/pricing/page.tsx",
    "app/admin/layout.tsx",
    "app/admin/page.tsx",
  );

  const pricing = layoutsFor("app/(marketing)/pricing/page.tsx", files);
  has(
    pricing.length === 2 && pricing[0] === "app/layout.tsx" && pricing[1] === "app/(marketing)/layout.tsx",
    "a group's own layout wraps the pages inside it",
    pricing.join(" > "),
  );
  has(pricing[0] === "app/layout.tsx", "the root layout is outermost");

  const admin = layoutsFor("app/admin/page.tsx", files);
  has(
    admin.length === 2 && admin[1] === "app/admin/layout.tsx",
    "a nested layout is innermost",
    admin.join(" > "),
  );
  has(
    !admin.includes("app/(marketing)/layout.tsx"),
    "a sibling group's layout does not wrap an unrelated page",
  );
}

/* ── Precedence ─────────────────────────────────────────────────────────── */

{
  const routes = routesOf(
    tree(
      "app/page.tsx",
      "app/blog/[slug]/page.tsx",
      "app/blog/new/page.tsx",
      "app/docs/[...rest]/page.tsx",
    ),
  );

  const literal = matchRoute(routes, "/blog/new");
  has(
    literal && literal.route.file === "app/blog/new/page.tsx",
    "a literal segment beats a parameter that would also match",
    literal ? literal.route.file : "no match",
  );

  const dynamic = matchRoute(routes, "/blog/hello-world");
  has(
    dynamic && dynamic.route.file === "app/blog/[slug]/page.tsx",
    "a parameter matches what no literal does",
  );
  has(
    dynamic && dynamic.params.slug === "hello-world",
    "the parameter carries its value",
    dynamic ? JSON.stringify(dynamic.params) : "",
  );

  const rest = matchRoute(routes, "/docs/a/b/c");
  has(
    rest && Array.isArray(rest.params.rest) && rest.params.rest.length === 3,
    "a catch-all collects every remaining segment",
    rest ? JSON.stringify(rest.params) : "no match",
  );

  has(matchRoute(routes, "/docs") === null, "a required catch-all does not match nothing");
  has(matchRoute(routes, "/nope") === null, "an address with no page matches nothing");
  has(matchRoute(routes, "/") !== null, "the root still matches");
}

{
  const routes = routesOf(tree("app/docs/[[...rest]]/page.tsx"));
  has(matchRoute(routes, "/docs") !== null, "an optional catch-all matches its own base");
}

/* A parameter must not swallow a deeper address — the failure that shows
   somebody /blog/[slug] when they asked for /blog/2024/hello. */
{
  const routes = routesOf(tree("app/blog/[slug]/page.tsx"));
  has(matchRoute(routes, "/blog/2024/hello") === null, "a parameter matches exactly one segment");
}

/* ── Where the preview opens ────────────────────────────────────────────── */

{
  const routes = routesOf(tree("app/blog/[slug]/page.tsx", "app/about/page.tsx", "app/page.tsx"));
  has(routes[0].pattern === "/", "the home page is first when there is one");
  has(entryRoute(routes) === "/", "the preview opens on the home page");
}

{
  const routes = routesOf(tree("app/blog/[slug]/page.tsx", "app/about/page.tsx"));
  has(
    routes[0].pattern === "/about",
    "without a home page the shallowest static route is first",
    routes[0].pattern,
  );
}

{
  /* A project of nothing but dynamic routes still has to open somewhere, and
     `/blog/undefined` looks broken in a way the project is not. */
  const routes = routesOf(tree("app/blog/[slug]/page.tsx"));
  const entry = entryRoute(routes);
  has(entry === "/blog/slug", "a dynamic-only project opens on a legible placeholder", entry);
}

has(routesOf([]).length === 0, "a tree with no pages has no routes");
has(entryRoute([]) === "/", "no routes still yields an address");

console.log(failed === 0 ? "\nAll preview route checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
