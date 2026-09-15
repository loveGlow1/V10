#!/usr/bin/env node
/* What `next build` would refuse, caught before anything is uploaded.
 *
 *   npm run check:next-structure
 *
 * Two halves, and the second is the one to read carefully.
 *
 * The findings have to be RIGHT, because a false blocking finding stops
 * somebody publishing a project that would have built perfectly — which is
 * worse than the build error it was trying to save them from. So the tests
 * below spend most of their time on what must NOT be reported: a type export, a
 * framework field, a constant in a components file, a hook in a file that is
 * properly marked.
 *
 * The repair has to be SAFE. It rewrites a customer's source. Anything it
 * cannot read cleanly it must leave alone, it must not overwrite a file that
 * exists, and running it twice must do nothing the second time.
 *
 * No keys, no network.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const out = join(root, "node_modules", ".cache", "quickstark-next-structure");
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
      include: [join(root, "src/lib/builder/next-structure.ts")],
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
const { inspectStructure, repairStructure, blocking, namedExports, hasDefaultExport } = require(
  join(out, "lib/builder/next-structure.js"),
);

let failed = 0;
const ok = (t) => console.log(`ok    ${t}`);
const fail = (t, d) => { failed++; console.log(`FAIL  ${t}${d ? `\n        ${d}` : ""}`); };
const has = (cond, t, d) => (cond ? ok(t) : fail(t, d));

const file = (path, content) => ({ path, content });
const at = (tree, path) => tree.find((f) => f.path === path)?.content ?? "";

const SHELL = file(
  "app/layout.tsx",
  'export default function RootLayout({ children }) {\n  return <html lang="en"><body>{children}</body></html>;\n}\n',
);
const HOME = file("app/page.tsx", "export default function Home() {\n  return <h1>Hi</h1>;\n}\n");

const sound = [SHELL, HOME];

/* ── A project that is fine is reported as fine ─────────────────────────── */

has(inspectStructure(sound).length === 0, "a sound project has no findings", JSON.stringify(inspectStructure(sound)));

/* ── Reading exports ────────────────────────────────────────────────────── */

has(
  namedExports("export type Props = { a: string };\nexport default function P(){}").length === 0,
  "a type export is not a value export",
);
has(
  namedExports("export interface Props { a: string }\nexport default function P(){}").length === 0,
  "an interface is not a value export",
);
has(
  namedExports("// export function Nav(){}\nexport default function P(){}").length === 0,
  "an export inside a comment is not an export",
);
has(
  namedExports('const s = "export function Nav(){}";\nexport default function P(){}').length === 0,
  "an export inside a string is not an export",
);
has(
  namedExports("export function Nav(){}").map((e) => e.name).join() === "Nav",
  "a function export is found",
);
has(
  namedExports("export { Nav as Sidebar };").map((e) => e.name).join() === "Sidebar",
  "a renamed export is reported under its exported name",
);
has(hasDefaultExport("export default function P(){}"), "a default export is found");
has(!hasDefaultExport("export function P(){}"), "a named export is not a default");

/* ── The one from the specification ─────────────────────────────────────── */

{
  const tree = [
    SHELL,
    HOME,
    file(
      "app/admin/page.tsx",
      'import Link from "next/link";\n\nexport function AdminNav() {\n  return <nav><Link href="/admin">Home</Link></nav>;\n}\n\nexport default function AdminPage() {\n  return <div><AdminNav /></div>;\n}\n',
    ),
  ];

  const findings = inspectStructure(tree);
  const component = findings.find((f) => f.file === "app/admin/page.tsx");
  has(Boolean(component), "a component exported from a page module is a finding");
  has(component && component.severity === "blocking", "and it is blocking — the build fails on it");
  has(component && component.repairable, "and it is repairable without a model");
  has(
    component && component.detail.includes("not a valid Page export field"),
    "the technical detail quotes the framework's own error",
    component ? component.detail : "",
  );
  has(
    component && !component.problem.includes("export field"),
    "the human sentence does not talk about export fields",
    component ? component.problem : "",
  );

  const { tree: fixed, repairs } = repairStructure(tree);
  has(repairs.length === 1, "one repair is made", JSON.stringify(repairs));

  const moved = at(fixed, "components/admin/AdminNav.tsx");
  has(moved.length > 0, "the component now has its own file at components/admin/AdminNav.tsx");
  has(
    /export default function AdminNav/.test(moved),
    "and exports itself as the default",
    moved,
  );
  has(
    moved.includes('import Link from "next/link"'),
    "the import it uses came across with it",
    moved,
  );

  const page = at(fixed, "app/admin/page.tsx");
  has(
    page.includes('import AdminNav from "@/components/admin/AdminNav"'),
    "the page imports it back",
    page,
  );
  has(!/export\s+function\s+AdminNav/.test(page), "and no longer exports it");
  has(/export default function AdminPage/.test(page), "the page itself is untouched");
  has(page.includes("<AdminNav />"), "the page still renders it");

  has(inspectStructure(fixed).length === 0, "the repaired project has no findings", JSON.stringify(inspectStructure(fixed)));

  const again = repairStructure(fixed);
  has(again.repairs.length === 0, "repairing an already-repaired tree does nothing");
}

/* ── What must NOT be reported ──────────────────────────────────────────── */

{
  const tree = [
    SHELL,
    file(
      "app/page.tsx",
      'export const metadata = { title: "Home" };\nexport const revalidate = 60;\nexport async function generateStaticParams() { return []; }\nexport default function Home(){ return <h1>Hi</h1>; }\n',
    ),
  ];
  has(inspectStructure(tree).length === 0, "framework fields are allowed exports", JSON.stringify(inspectStructure(tree)));
  has(repairStructure(tree).repairs.length === 0, "and are never moved out");
}

{
  /* A components file is not a page and none of these rules apply to it. */
  const tree = [
    SHELL,
    HOME,
    file("components/Nav.tsx", "export function Nav(){ return <nav/>; }\nexport const LINKS = [];\n"),
  ];
  has(inspectStructure(tree).length === 0, "a components file may export whatever it likes");
  has(repairStructure(tree).repairs.length === 0, "and is never rewritten");
}

{
  const tree = [
    SHELL,
    file("app/page.tsx", '"use client";\nimport { useState } from "react";\nexport default function Home(){ const [n] = useState(0); return <p>{n}</p>; }\n'),
  ];
  has(inspectStructure(tree).length === 0, "hooks in a properly marked client page are fine");
}

{
  /* An all-caps constant is not a component and moving it would break the
     files importing it. */
  const tree = [
    SHELL,
    file("app/page.tsx", "export const NAV_LINKS = [];\nexport default function Home(){ return <h1/>; }\n"),
  ];
  const findings = inspectStructure(tree);
  has(findings.length === 1 && findings[0].severity === "blocking", "a stray constant is still an invalid page export");
  has(!findings[0].repairable, "but it is not repaired automatically");
  has(repairStructure(tree).repairs.length === 0, "and the tree is left alone");
}

/* ── The other build failures ───────────────────────────────────────────── */

{
  const tree = [SHELL, file("app/page.tsx", "export function Home(){ return <h1/>; }\n")];
  const findings = inspectStructure(tree);
  has(
    findings.some((f) => f.problem.includes("never says what to render")),
    "a page with no default export is a finding",
    JSON.stringify(findings.map((f) => f.problem)),
  );
}

{
  const tree = [
    SHELL,
    file("app/page.tsx", 'import { useState } from "react";\nexport default function Home(){ const [n] = useState(0); return <p>{n}</p>; }\n'),
  ];
  const findings = inspectStructure(tree);
  has(
    findings.some((f) => f.problem.includes("not marked as a client component")),
    "hooks without the directive are caught",
    JSON.stringify(findings.map((f) => f.problem)),
  );
}

{
  const tree = [
    SHELL,
    file("app/page.tsx", '"use client";\nexport const metadata = { title: "x" };\nexport default function Home(){ return <h1/>; }\n'),
  ];
  has(
    inspectStructure(tree).some((f) => f.detail.includes('export "metadata" from a component marked with "use client"')),
    "metadata in a client component is caught",
  );
}

{
  const tree = [
    SHELL,
    file("app/[slug]/page.tsx", '"use client";\nexport async function generateStaticParams(){ return []; }\nexport default function P(){ return <h1/>; }\n'),
  ];
  has(
    inspectStructure(tree).some((f) => f.detail.includes('cannot use both "use client"')),
    "the client/static-params conflict is caught",
  );
}

has(
  inspectStructure([SHELL]).some((f) => f.problem.includes("no pages")),
  "a project with no pages at all is caught",
);

has(
  inspectStructure([HOME]).some((f) => f.problem.includes("no root layout")),
  "a missing root layout is caught",
);

has(
  inspectStructure([
    file("app/layout.tsx", "export default function L({children}){ return <div>{children}</div>; }"),
    HOME,
  ]).some((f) => f.problem.includes("<html>")),
  "a root layout with no html/body is caught",
);

{
  const tree = [SHELL, HOME, file("app/api/hook/route.ts", "export default function handler(){}\n")];
  const findings = inspectStructure(tree);
  has(findings.some((f) => f.detail.includes("may not have a default export")), "a route handler with a default export is caught");
  has(findings.some((f) => f.problem.includes("answers no requests")), "a route handler with no verbs is caught");
}

{
  const tree = [
    SHELL,
    HOME,
    file("app/api/x/route.ts", "export async function GET(){ return new Response('ok'); }\n"),
  ];
  has(inspectStructure(tree).length === 0, "a correct route handler is fine", JSON.stringify(inspectStructure(tree)));
}

{
  const tree = [
    SHELL,
    HOME,
    file("app/thing/page.tsx", "export default function P(){ return <h1/>; }"),
    file("app/thing/route.ts", "export async function GET(){ return new Response('ok'); }"),
  ];
  has(
    inspectStructure(tree).some((f) => f.problem.includes("both claim the address")),
    "a page and a route handler in one folder is caught",
  );
}

/* ── Severity ───────────────────────────────────────────────────────────── */

{
  const tree = [
    SHELL,
    file("app/page.tsx", "export default function Home(){ const w = window.innerWidth; return <p>{w}</p>; }\n"),
  ];
  const findings = inspectStructure(tree);
  has(findings.length === 1 && findings[0].severity === "advisory", "touching the browser is advisory, not blocking");
  has(blocking(findings).length === 0, "so it does not stop a publish");
}

/* ── The repair must not damage anything ────────────────────────────────── */

{
  /* A file the repair cannot read is left exactly as it was. */
  const broken = 'export function Nav() { return <nav>{"unclosed\n';
  const tree = [SHELL, HOME, file("app/admin/page.tsx", broken + "\nexport default function A(){ return <div/>; }")];
  const { tree: after, repairs } = repairStructure(tree);
  has(repairs.length === 0, "a declaration it cannot read is not moved");
  has(at(after, "app/admin/page.tsx") === at(tree, "app/admin/page.tsx"), "and the file is byte-identical");
}

{
  /* A components file already at that path is not overwritten. */
  const tree = [
    SHELL,
    HOME,
    file("components/admin/AdminNav.tsx", "export default function Existing(){ return <nav/>; }\n"),
    file("app/admin/page.tsx", "export function AdminNav(){ return <nav/>; }\nexport default function A(){ return <div><AdminNav/></div>; }\n"),
  ];
  const { tree: after, repairs } = repairStructure(tree);
  has(
    at(after, "components/admin/AdminNav.tsx").includes("Existing"),
    "an existing file of that name is not overwritten",
  );
  has(repairs.length === 1 && repairs[0].file !== "components/admin/AdminNav.tsx", "the moved component takes another name", JSON.stringify(repairs));
  has(
    at(after, "app/admin/page.tsx").includes("AdminNav2"),
    "and the page imports and renders the name it actually used",
    at(after, "app/admin/page.tsx"),
  );
}

{
  /* "use client" must stay the first thing in the file or it stops being a
     directive, which would turn one finding into a different one. */
  const tree = [
    SHELL,
    HOME,
    file(
      "app/admin/page.tsx",
      '"use client";\n\nexport function Panel(){ return <div/>; }\n\nexport default function A(){ return <Panel/>; }\n',
    ),
  ];
  const { tree: after } = repairStructure(tree);
  const page = at(after, "app/admin/page.tsx");
  has(/^\s*"use client";/.test(page), "the directive is still the first thing in the file", page);
}

{
  /* An arrow-function component ends at a paren, not a brace. */
  const tree = [
    SHELL,
    HOME,
    file(
      "app/admin/page.tsx",
      "export const Badge = () => (\n  <span>New</span>\n);\n\nexport default function A(){ return <Badge/>; }\n",
    ),
  ];
  const { tree: after, repairs } = repairStructure(tree);
  has(repairs.length === 1, "an arrow component is moved too", JSON.stringify(repairs));
  const moved = at(after, "components/admin/Badge.tsx");
  has(/export default const|export default/.test(moved), "it is exported as the default");
  has(!/export\s+const\s+Badge/.test(at(after, "app/admin/page.tsx")), "and is gone from the page");
}

console.log(failed === 0 ? "\nAll Next.js structure checks passed." : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
