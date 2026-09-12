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

import type { ArchitectureManifest } from "./architecture";
import { type DesignDNA, tokensCss } from "./design";
import type { BuildKind } from "./kinds";
import { type DataModel, schemaBrief, toTypes } from "./schema";
import { splitClientRoutes } from "./client-routes";
import type { FileTree, ProjectFile } from "./tree";

/* The version of Next.js these projects are written against.
 *
 * Pinned, and pinned exactly. A caret here means a project generated today and
 * a project generated in March install different frameworks, and the second one
 * fails on an API the first one used — which arrives as "my app broke and I
 * didn't touch it". Somebody moves this deliberately or it does not move.
 *
 * Moved deliberately, on 2026-09-12. 15.5.4 was deprecated on npm for
 * CVE-2025-66478, which means every project generated up to that date shipped
 * a framework with a known vulnerability — and the only place it was ever said
 * out loud was an npm warning in a build log nobody was reading. 15.5.25 is the
 * patched release on the same minor line; the jump to 16 is a major and is not
 * something to make inside a security patch. check:versions is the reason this
 * will not go unnoticed again. */
export const NEXT_VERSION = "15.5.25";
const NEXT = NEXT_VERSION;
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
export function platformFiles(
  name: string,
  manifest: ArchitectureManifest,
  model: DataModel,
  design?: DesignDNA,
): FileTree {
  const slug = packageName(name);
  const withBackend = manifest.backend;

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
      /* The tokens, wired through to Tailwind — and this is a bug fix.
       *
       * Tailwind was installed, configured and given an EMPTY theme, while the
       * prompt told the model to put every colour in tokens.css as a custom
       * property. So the model did what anyone would with a tailwind.config in
       * front of it and wrote `className="bg-ground text-ink"` — classes that
       * existed in neither system and compiled to nothing. The deployed result
       * was a page with no styling at all: two white rectangles on black.
       *
       * Mapping the token names here is what makes those classes real. The
       * values stay in tokens.css, where the prompt says they live; this only
       * teaches Tailwind the names, so `bg-ground` resolves to var(--ground)
       * and the two halves of the design system stop contradicting each other. */
      content: `import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: "var(--ground)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--line)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
      },
      maxWidth: { container: "var(--container)" },
    },
  },
  plugins: [],
} satisfies Config;
`,
    },

    ...(design
      ? [
          {
            /* The design system as a file, written here rather than requested.
             *
             * Same rule as the rest of this scaffold: a model asked to reproduce
             * a palette will type #5C6470 in one place and #5C6472 in another,
             * and nobody will ever notice. Written once, imported by the layout,
             * and the prompt asks for the NAMES — see designBrief. */
            path: "app/tokens.css",
            content: tokensCss(design),
          },
        ]
      : []),

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

This project reads and writes through Supabase from the browser. There is no
server here to hold a secret, so row-level security on the database is the only
thing standing between a row and anybody — every table this app touches has RLS
on and a policy behind it. Set these before running:

    NEXT_PUBLIC_SUPABASE_URL=
    NEXT_PUBLIC_SUPABASE_ANON_KEY=
    NEXT_PUBLIC_SUPABASE_SCHEMA=${model.schema}

The schema is the third one because these tables live in \`${model.schema}\`
rather than in \`public\`. Pointing the app at the wrong schema is how it ends
up querying somebody else's tables and being refused by policies written for
them.

Never put a service-role key in any of these. They are compiled into the
JavaScript and served to every visitor; a service key there bypasses every
policy for everyone who loads the page.

See \`lib/supabase.ts\` and \`lib/database.types.ts\`.
`
    : ""
}`,
    },
  ];

  if (withBackend) {
    files.push({
      path: "lib/supabase.ts",
      content: `import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/* A BROWSER client, and only ever a browser client.
 *
 * This project is exported statically — there is no server of its own to hold
 * a secret, so there is nowhere a service key could live and nothing that
 * could use one safely. The anon key below is public by design: it identifies
 * the project, it does not authorise anything.
 *
 * What authorises is row-level security, on the database. Every table this app
 * touches has RLS on and a policy saying who may read and write which rows —
 * they were created with the project. A table without one would be readable by
 * anybody who opens the page and looks at the network tab. There is no second
 * line of defence here, which is why you must never filter for permission in
 * this app: the database has already done it, and a query written as though it
 * had not is a query that hides the case where it did not.
 *
 * The schema matters as much as the URL. These tables are in \`${model.schema}\`,
 * not in \`public\` — an unscoped client would query a schema belonging to
 * something else entirely. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const schema = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA ?? "${model.schema}";

if (!url || !anonKey) {
  throw new Error(
    "This app needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. See README.md.",
  );
}

/* The schema as an explicit generic, not just as a runtime option.
 *
 * database.types.ts mounts this project's tables under BOTH their real schema
 * name and \`public\`, so that a query written the way every Supabase example
 * writes it compiles. The cost of that is here: with \`public\` present,
 * createClient's second type parameter defaults to it, and then \`db.schema\`
 * is required to be "public" too — which would be a lie about which schema is
 * really being read. Naming it settles both halves. */
export const supabase = createClient<Database, "${model.schema}">(url, anonKey, {
  db: { schema: schema as "${model.schema}" },
});
`,
    });

    /* The tables as types, so a column that does not exist is a compile error
       here rather than a null in somebody's browser. Generated from the same
       model the migration came from — see schema.ts, toTypes. */
    const types = toTypes(model);
    if (types) files.push({ path: "lib/database.types.ts", content: types });

    /* No .env.example, deliberately, and the README names the three variables
       instead.
       
       tree.ts refuses any path matching .env.* — it is how a generated project
       is stopped from writing a .env that then gets downloaded and pushed to
       GitHub with a key in it. An example file holds no values and would be
       harmless, but the exception could not be written narrowly enough to stay
       harmless: the same allowance that lets the scaffold write .env.example
       lets a model write one, with whatever it decided to put in it. A guard
       against leaking secrets is not worth widening for a convenience file. */
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
/* Files the platform writes and the model may not replace.
 *
 * These used to be scaffolded first and then overwritten by anything the model
 * happened to emit at the same path, which is the right precedence for
 * everything the model is actually being asked to write — app/** is its job,
 * and a scaffolded placeholder should lose to a real page.
 *
 * It is the wrong precedence here, and one build shows why. Asked for a
 * dashboard with sign-in, the model wrote its own `lib/supabase.ts` carrying a
 * hardcoded project URL and anon key — a project that does not exist, invented
 * whole. It replaced a scaffolded client that reads
 * NEXT_PUBLIC_SUPABASE_URL/ANON_KEY/SCHEMA from the environment and is pinned
 * to the schema this project's tables were actually created in. The app that
 * came out would have talked to nothing, and would have gone on doing it
 * silently, because a Supabase client does not fail until it is queried.
 *
 * So these paths are the platform's. Every one of them is infrastructure whose
 * correct contents are known here and cannot be known by a model: the
 * credentials, the schema they are pinned to, the types generated from the real
 * tables, and the config that makes the export work at all.
 *
 * package.json is deliberately NOT on this list. A model that adds a dependency
 * needs its manifest to survive, and a wrong one breaks a build loudly rather
 * than quietly. */
const PLATFORM_OWNED = new Set([
  "lib/supabase.ts",
  "lib/database.types.ts",
  "next.config.mjs",
  "postcss.config.mjs",
  "tailwind.config.ts",
  "tsconfig.json",
]);

/* Tailwind's own directives, guaranteed to be in the stylesheet.
 *
 * The other half of the same bug. postcss.config.mjs runs Tailwind, the
 * project depends on it, and tailwind.config.ts now maps the design tokens —
 * and none of that emits a single class unless the stylesheet actually asks
 * for them. The model writes app/globals.css to a prompt about resets and
 * tokens, so it had no reason to include the directives, and without them
 * every `className` in the project resolved to nothing at all.
 *
 * Inserted rather than the file being taken over. globals.css IS the model's
 * work — the tokens import, the resets, the element styles — and owning it
 * outright would throw away the design to fix the plumbing. So the three lines
 * go in and nothing else is touched.
 *
 * After any leading @import, because CSS requires @import to come first and a
 * stylesheet that breaks that rule drops the import silently — which would
 * take the tokens with it. */
function withTailwindDirectives(css: string): string {
  if (/^\s*@tailwind\s+utilities/m.test(css)) return css;

  const lines = css.split("\n");
  let at = 0;
  while (at < lines.length && (lines[at].trim() === "" || lines[at].trim().startsWith("@import"))) {
    at += 1;
  }

  const directives = ["@tailwind base;", "@tailwind components;", "@tailwind utilities;", ""];
  return [...lines.slice(0, at), ...directives, ...lines.slice(at)].join("\n");
}

export function completeTree(
  generated: FileTree,
  name: string,
  manifest: ArchitectureManifest,
  model: DataModel,
  design?: DesignDNA,
): FileTree {
  const byPath = new Map<string, ProjectFile>();
  const platform = platformFiles(name, manifest, model, design);
  const owned = new Set(platform.filter((file) => PLATFORM_OWNED.has(file.path)).map((f) => f.path));

  for (const file of platform) byPath.set(file.path, file);
  for (const file of generated) {
    /* The model's version of an owned path is discarded rather than merged.
       There is no half of a wrong connection string worth keeping. */
    if (owned.has(file.path)) continue;
    byPath.set(file.path, file);
  }

  const globals = byPath.get("app/globals.css");
  if (globals) {
    byPath.set("app/globals.css", { ...globals, content: withTailwindDirectives(globals.content) });
  }

  /* Last, and after everything else has been merged in: a page that is both
     "use client" and a source of generateStaticParams does not compile, and
     that is a property of the finished tree rather than of any one file the
     model wrote. See client-routes.ts. */
  return splitClientRoutes([...byPath.values()]).sort((a, b) =>
    a.path.localeCompare(b.path),
  );
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

/* The back office, when the manifest says there is one.
 *
 * Under /admin rather than scattered, because the whole point of it is that it
 * is a different place with a different audience and a different rule about who
 * may be there. Every one of these reads and writes the same tables the public
 * routes read — that is what makes it a CMS rather than a second website — and
 * the sign-in is listed with them because an admin without one is a public back
 * office.
 *
 * Short, again. A generated admin with fourteen screens is thirteen screens
 * nobody asked for; these are the ones whose absence makes the admin a
 * decoration. */
const ADMIN_ROUTES: Partial<Record<BuildKind, string[]>> = {
  ecommerce: [
    "app/admin/page.tsx",
    "app/admin/products/page.tsx",
    "app/admin/orders/page.tsx",
  ],
  blog: ["app/admin/page.tsx", "app/admin/posts/page.tsx", "app/admin/media/page.tsx"],
  news: ["app/admin/page.tsx", "app/admin/posts/page.tsx", "app/admin/media/page.tsx"],
  webapp: ["app/admin/page.tsx"],
};

/* What each kind's customer-facing account area is. Only reached when the
   manifest has authentication, and named per kind because "account" means
   different things: a shopper's order history is not a reader's profile. */
const ACCOUNT_ROUTES: Partial<Record<BuildKind, string[]>> = {
  ecommerce: ["app/account/page.tsx", "app/account/orders/page.tsx"],
};

/**
 * The file-tree half of a build prompt: what to write, where, and what not to
 * bother with because it is written here.
 *
 * Driven by the manifest rather than by a boolean. The difference shows in the
 * negative space: a project with no admin is told it has no admin, and a model
 * told that does not build one. The layer that gets invented is always the one
 * nothing said anything about.
 */
export function treeBrief(
  kind: BuildKind,
  manifest: ArchitectureManifest,
  model: DataModel,
  design?: DesignDNA,
): string {
  const routes = ROUTES[kind] ?? [];
  const admin = manifest.admin ? (ADMIN_ROUTES[kind] ?? ["app/admin/page.tsx"]) : [];
  const account = manifest.authentication ? (ACCOUNT_ROUTES[kind] ?? []) : [];

  const write = [
    "- app/page.tsx — the home page, and the one that matters most",
    "- app/layout.tsx — the shell: <html>, <body>, fonts, the nav and footer",
    design
      ? "- app/globals.css — imports ./tokens.css on its first line, then only what the tokens cannot express: resets, base element styles, and any keyframes. Never a colour, size, radius or duration that is not a token."
      : "- app/globals.css — the design system as CSS custom properties, imported by the layout",
    ...routes.map((route) => `- ${route}`),
  ];

  if (manifest.authentication) {
    write.push(
      "- app/login/page.tsx — sign in and sign up, in one place, with inline errors",
      ...account.map((route) => `- ${route}`),
    );
  }

  if (manifest.admin) {
    write.push(
      ...admin.map((route) => `- ${route}`),
      "- components/AdminGuard.tsx — renders nothing until the session is loaded and the profile's role is checked, then either the children or a refusal",
    );
  }

  write.push(
    "- components/*.tsx — anything used more than once. A component used once belongs in the page that uses it.",
  );

  const supplied = [
    "- package.json, next.config.mjs, tsconfig.json, postcss.config.mjs, tailwind.config.ts, .gitignore, README.md",
  ];
  if (design) {
    supplied.push(
      "- app/tokens.css — every colour, size, radius and duration this project has. Import it from globals.css and use the variable names; do not restate the values.",
    );
  }
  if (manifest.backend) {
    supplied.push("- lib/supabase.ts — the client, already pointed at the right schema");
    if (model.tables.length > 0) {
      supplied.push("- lib/database.types.ts — the tables as types; import Database and the row aliases from here");
    }
  }

  const rules = [
    "- Next.js App Router, TypeScript, Tailwind. Every file must compile under `strict`.",
    "- STATIC EXPORT. There is no server. No route handlers, no middleware, no server actions, no `fetch` in a server component against your own API. A page that needs data reads it in the browser.",
    "- Import across the project with `@/` — `@/components/Nav`, not a relative climb.",
    /* These two rules used to be one line, and together they instructed the
       model straight into a page that cannot compile: every dynamic route
       needs generateStaticParams, and a page that reads data has to be
       "use client" — so it wrote both into one file, which Next.js refuses
       outright. The brief has to name the way out, because both halves of the
       conflict are things this same brief asks for. completeTree repairs it
       either way (see client-routes.ts); this is so it stops happening. */
    "- Every dynamic route needs `generateStaticParams`, or the export fails on it.",
    '- A ROUTE FILE MAY NOT BE BOTH. `app/x/[id]/page.tsx` cannot have "use client" AND export generateStaticParams — that is a build error, not a warning. When the page needs both, split it: page.tsx stays a server component holding generateStaticParams, and everything interactive goes in a sibling it renders.',
    "- In that split, page.tsx is `async` and its params is a Promise: `export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <IdClient params={await params} />; }`. Await it there so the client half receives plain values.",
    "- Use next/image with width and height. The optimiser is off, so a missing dimension is a layout shift rather than an error, and it will show.",
  ];

  if (manifest.database) {
    rules.push(
      '- Data comes from `@/lib/supabase`, in a client component ("use client"), inside useEffect or an event handler. Never at module scope — it runs at build time and there is no session then.',
      "- A dynamic route's generateStaticParams cannot query the database either, for the same reason. Export the shell and load the record in the browser from the route parameter.",
      "- Every list has the four states and all four are reachable: loading while the query runs, empty when it returns nothing, the rows when it returns some, and the error when it fails. A list that renders nothing while it loads is indistinguishable from an empty one.",
    );
  } else {
    rules.push(
      "- There is no database. Data is typed constants in the file that renders it, or in `lib/data.ts` when two pages share it.",
    );
  }

  if (manifest.authentication) {
    rules.push(
      "- Sign in, sign up and sign out through `supabase.auth`. Session state comes from `onAuthStateChange` and an initial `getSession`, held in one provider — never read from localStorage by hand.",
      "- Signing up writes the profiles row for the new user. Nothing sets `role`: it defaults, and the database refuses a change to it from anyone but an admin.",
      "- A protected page renders nothing until the session has actually loaded. Rendering the signed-out view first and correcting it is a flash of the wrong page on every load.",
    );
  }

  if (manifest.admin) {
    rules.push(
      "- The admin reads and writes THE SAME TABLES the public pages read. That is the whole point of it: a product saved in /admin/products appears on /products because both are that row. An admin holding its own copy of the data is a second website.",
      "- Admin actions are real: create, edit, delete, publish and unpublish are writes that persist and are visible after a reload. Never a local array that resets.",
      "- Do not gate an admin action on a role you read in JavaScript. Attempt the write; the database refuses it if the caller is not an admin. AdminGuard decides what to SHOW, and it is not what decides what is ALLOWED.",
    );
  }

  if (manifest.storage) {
    rules.push(
      "- Uploads go to Supabase Storage with `supabase.storage.from(bucket).upload(...)`, and the row that records them goes in `media`. Store the path, never a URL — build the URL at render time with `getPublicUrl`.",
      "- Never turn an uploaded file into a placeholder or a data URI. If the upload fails, say so.",
    );
  }

  if (manifest.payments) {
    rules.push(
      "- Payment cannot be taken from a static export: there is nowhere to put the secret key. Build the checkout in full, write the order and its items to the database, and at the point of charging show a plainly worded state saying payment connects to a back end that is not attached yet. Never a fake confirmation for a charge that did not happen.",
    );
  }

  rules.push(
    '- No placeholder copy. No lorem ipsum, no "Feature One", no "Your text here". Write what this business would actually say.',
  );

  const parts = [
    `RETURN A FILE TREE, not a single document.

Answer with JSON only: an object whose keys are file paths and whose values are the complete contents of those files. No prose, no markdown fences.

WRITE THESE:
${write.join("\n")}

DO NOT WRITE THESE — they are supplied and yours would be overwritten:
${supplied.join("\n")}

RULES:
${rules.join("\n")}`,
  ];

  const schema = schemaBrief(model);
  if (schema) parts.push(schema);

  return parts.join("\n\n");
}
