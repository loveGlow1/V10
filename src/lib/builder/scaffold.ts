/* The shape a generated Next.js project has to have to be a project.
 *
 * A model asked for "a Next.js app" writes app/page.tsx and stops. What comes
 * back is not wrong, it is unbuildable: no package.json, so nothing to install;
 * no next.config, so no static export; no tsconfig, so the `@/` imports it
 * wrote resolve against nothing. Three files nobody thinks about are the
 * difference between a directory of TypeScript and something `next build`
 * accepts.
 *
 * So they are not asked for. They are WRITTEN HERE, deterministically, and
 * merged under whatever the model produced — see completeTree. The model's job
 * is the part that is actually about this project: the pages, the components,
 * the copy, the design. The plumbing is the same every time, and a model that
 * spends tokens rewriting tsconfig.json is a model not spending them on the
 * page somebody asked for.
 *
 * STATIC EXPORT. `output: "export"` in next.config is the decision that makes
 * the rest of this fit: the build produces a directory of HTML, CSS and JS,
 * which the preview route can serve and the download can zip, with nothing to
 * provision and nothing to keep warm. What it costs is stated where it bites —
 * no route handlers, no server components fetching secrets, no middleware. An
 * app here talks to its data from the browser, which is why the Supabase client
 * below is a browser client and why row-level security is not optional.
 */

import type { BuildKind } from "./kinds";
import type { FileTree, ProjectFile } from "./tree";

/* The version of Next.js these projects are written against.
 *
 * Pinned, and pinned exactly. A caret here means a project generated today and
 * a project generated in March install different frameworks, and the second one
 * fails on an API the first one used — which arrives as "my app broke and I
 * didn't touch it". Somebody moves this deliberately or it does not move. */
const NEXT = "15.5.4";
const REACT = "19.1.0";
const TYPES_REACT = "19.1.0";
const TYPESCRIPT = "5.6.3";
const TAILWIND = "3.4.14";
const SUPABASE_JS = "2.47.10";

/** Files every generated project gets, whatever it is. */
export const REQUIRED_FILES = [
  "package.json",
  "next.config.mjs",
  "tsconfig.json",
  "app/layout.tsx",
  "app/page.tsx",
  "app/globals.css",
] as const;

/**
 * The plumbing, written rather than requested.
 *
 * `name` becomes the package name, so it is slugged rather than trusted: a
 * project called "Jephthah's Café" is not a valid npm name and npm will refuse
 * the whole install over it.
 */
export function platformFiles(name: string, withBackend: boolean): FileTree {
  const slug = packageName(name);

  const files: FileTree = [
    {
      path: "package.json",
      content: `${JSON.stringify(
        {
          name: slug,
          version: "0.1.0",
          private: true,
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
            lint: "next lint",
          },
          dependencies: {
            next: NEXT,
            react: REACT,
            "react-dom": REACT,
            ...(withBackend ? { "@supabase/supabase-js": SUPABASE_JS } : {}),
          },
          devDependencies: {
            "@types/node": "22.9.0",
            "@types/react": TYPES_REACT,
            "@types/react-dom": TYPES_REACT,
            autoprefixer: "10.4.20",
            postcss: "8.4.49",
            tailwindcss: TAILWIND,
            typescript: TYPESCRIPT,
          },
        },
        null,
        2,
      )}\n`,
    },

    {
      /* .mjs rather than .js, because package.json above has no "type" field —
         so a .js config is CommonJS, and `export default` in it is a syntax
         error at the first thing the build does. */
      path: "next.config.mjs",
      content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  /* A directory of files rather than a server. See scaffold.ts: it is what
     lets this be previewed and downloaded without anything being provisioned.
     Route handlers and middleware do not run under it — data comes from the
     browser instead. */
  output: "export",

  /* The exported site is served from a plain file server, which has no image
     optimiser behind it. Left on, every <Image> in the project fails the
     build with a message about a loader. */
  images: { unoptimized: true },

  /* Every route becomes a directory with an index.html in it, so /pricing
     works as a path on a static host instead of only /pricing.html. */
  trailingSlash: true,
};

export default nextConfig;
`,
    },

    {
      path: "tsconfig.json",
      content: `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["dom", "dom.iterable", "esnext"],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
            incremental: true,
            plugins: [{ name: "next" }],
            paths: { "@/*": ["./*"] },
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
          exclude: ["node_modules"],
        },
        null,
        2,
      )}\n`,
    },

    {
      path: "postcss.config.mjs",
      content: `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n`,
    },

    {
      path: "tailwind.config.ts",
      content: `import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
`,
    },

    {
      path: ".gitignore",
      content: `node_modules/\n.next/\nout/\n.env*.local\n.DS_Store\n`,
    },

    {
      path: "README.md",
      content: `# ${name}

Built with QuickStark.AI.

    npm install
    npm run dev

\`npm run build\` writes a static site to \`out/\`, which can be served by any
file host.
${
  withBackend
    ? `
## Data

This project reads and writes through Supabase from the browser, so every table
it touches must have row-level security on with a policy that allows it.
Set these before running:

    NEXT_PUBLIC_SUPABASE_URL=
    NEXT_PUBLIC_SUPABASE_ANON_KEY=

See \`lib/supabase.ts\`.
`
    : ""
}`,
    },
  ];

  if (withBackend) {
    files.push({
      path: "lib/supabase.ts",
      content: `import { createClient } from "@supabase/supabase-js";

/* A BROWSER client, and only ever a browser client.
 *
 * This project is exported statically — there is no server of its own to hold
 * a secret, so there is nowhere a service key could live and nothing that
 * could use one safely. The anon key below is public by design: it identifies
 * the project, it does not authorise anything.
 *
 * What authorises is row-level security, on the database. Every table this
 * app touches needs RLS ON and a policy saying who may read and write which
 * rows. A table without one is readable by anybody who opens the page and
 * looks at the network tab. There is no second line of defence here. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "This app needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. See README.md.",
  );
}

export const supabase = createClient(url, anonKey);
`,
    });
  }

  return files;
}

/**
 * A package name npm will accept, from whatever somebody called their project.
 *
 * npm is stricter than it looks: lower case, no spaces, no leading dot or
 * underscore, 214 characters. A name that fails it fails the install, which is
 * the first thing that happens and the least explicable place to fail.
 */
export function packageName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 214);

  return slug.length > 0 ? slug : "quickstark-app";
}

/**
 * The model's files, with the plumbing underneath them.
 *
 * The model wins every collision, and that is the right way round: if it wrote
 * its own tailwind.config.ts because the design needed one, taking that away
 * and substituting the default would silently undo the thing somebody asked
 * for. The scaffold is a floor, not a ceiling — it supplies what is missing and
 * argues with nothing.
 */
export function completeTree(generated: FileTree, name: string, withBackend: boolean): FileTree {
  const byPath = new Map<string, ProjectFile>();

  for (const file of platformFiles(name, withBackend)) byPath.set(file.path, file);
  for (const file of generated) byPath.set(file.path, file);

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * What a completed tree is still missing, as sentences. Empty means buildable.
 *
 * Runs AFTER completeTree, so anything reported here is something the model was
 * supposed to write and did not — app/page.tsx above all, which is the project.
 */
export function missingFrom(tree: FileTree): string[] {
  const paths = new Set(tree.map((file) => file.path));
  return REQUIRED_FILES.filter((required) => !paths.has(required)).map(
    (required) => `${required} is missing, and \`next build\` needs it`,
  );
}

/* ── What the model is asked for ───────────────────────────────────────────*/

/* The routes each kind of project has, over and above the home page.
 *
 * Deliberately short lists. A generated app with fourteen routes is fourteen
 * pages of filler nobody asked for, and every one of them is a page somebody
 * now has to delete. These are the ones whose absence would be noticed. */
const ROUTES: Record<BuildKind, string[]> = {
  landing: ["app/pricing/page.tsx", "app/contact/page.tsx"],
  ecommerce: ["app/products/page.tsx", "app/products/[slug]/page.tsx", "app/cart/page.tsx"],
  blog: ["app/blog/page.tsx", "app/blog/[slug]/page.tsx", "app/about/page.tsx"],
  webapp: ["app/dashboard/page.tsx", "app/login/page.tsx"],
  news: ["app/[section]/page.tsx", "app/article/[slug]/page.tsx"],
};

/**
 * The file-tree half of a build prompt: what to write, where, and what not to
 * bother with because it is written here.
 */
export function treeBrief(kind: BuildKind, withBackend: boolean): string {
  const routes = ROUTES[kind] ?? [];

  return `RETURN A FILE TREE, not a single document.

Answer with JSON only: an object whose keys are file paths and whose values are the complete contents of those files. No prose, no markdown fences.

WRITE THESE:
- app/page.tsx — the home page, and the one that matters most
- app/layout.tsx — the shell: <html>, <body>, fonts, the nav and footer
- app/globals.css — the design system as CSS custom properties, imported by the layout
${routes.map((route) => `- ${route}`).join("\n")}
- components/*.tsx — anything used more than once. A component used once belongs in the page that uses it.

DO NOT WRITE THESE — they are supplied and yours would be overwritten:
- package.json, next.config.mjs, tsconfig.json, postcss.config.mjs, tailwind.config.ts, .gitignore, README.md${withBackend ? "\n- lib/supabase.ts" : ""}

RULES:
- Next.js App Router, TypeScript, Tailwind. Every file must compile under \`strict\`.
- STATIC EXPORT. There is no server. No route handlers, no middleware, no server actions, no \`fetch\` in a server component against your own API. A page that needs data reads it in the browser.
- Import across the project with \`@/\` — \`@/components/Nav\`, not a relative climb.
- Every dynamic route needs \`generateStaticParams\`, or the export fails on it.
- Use next/image with width and height. The optimiser is off, so a missing dimension is a layout shift rather than an error, and it will show.
${
  withBackend
    ? `- Data comes from \`@/lib/supabase\`, in a client component ("use client"), inside useEffect or an event handler. Never at module scope — it runs at build time and there is no session then.
- Assume every table has row-level security on. Write the query as the signed-in user, never as an admin.`
    : `- There is no database. Data is typed constants in the file that renders it, or in \`lib/data.ts\` when two pages share it.`
}
- No placeholder copy. No lorem ipsum, no "Feature One", no "Your text here". Write what this business would actually say.`;
}
