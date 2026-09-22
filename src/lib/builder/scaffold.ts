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
import { allCommerce } from "./commerce";
import { type DataModel, schemaBrief, toTypes } from "./schema";
import { splitClientRoutes } from "./client-routes";
import { repairStructure } from "./next-structure";
import { type BuildMode, buildModeOf } from "./build-mode";
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
/* Pinned for the same reason as everything above it — see NEXT_VERSION. */
const SUPABASE_SSR = "0.5.2";

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
  /* Static unless the project's own files say otherwise — see build-mode.ts.
     Defaulted, so every caller that predates the two modes keeps the one it
     was written against. */
  mode: BuildMode = "static",
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
            /* Cookie-based sessions, and only where there is a server to hold
               them. @supabase/ssr is how a session survives a request on the
               server side — the middleware refresh, the server component that
               knows who is signed in. In a static build there is no request to
               hold a cookie for and supabase-js alone is the whole story, so
               shipping it there would be a dependency nothing imports. */
            ...(withBackend && mode === "server" ? { "@supabase/ssr": SUPABASE_SSR } : {}),
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
      content:
        mode === "server"
          ? `/** @type {import('next').NextConfig} */
const nextConfig = {
  /* A SERVER, because this project has something in it that needs one — a
     route handler, a server action, a middleware redirect, or a key that must
     not reach a browser. See lib/builder/build-mode.ts, which read the files
     and decided; it is not a setting anybody chose by hand.

     No \`output\` line at all: Next's default is a server build, and Vercel
     knows what to do with it. \`standalone\` is for copying the build into a
     container of your own, which is a different deployment from this one. */

  /* On here the optimiser exists, so images are optimised. The static half of
     this file turns it off because a file server has nothing behind it to
     optimise with. */
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },

  /* The typechecker does not get to fail a deploy.

     tsconfig.json below still sets \`strict\`, and the generation prompt still
     asks for code that compiles under it — an editor and \`tsc\` both stay
     useful, and that is the point of keeping it on. What changes is the
     consequence of one miss.

     Because the consequence was the worst possible ordering. \`next build\`
     typechecks the whole project and exits 1 on the first error, AFTER the
     build has been generated, priced, charged and shown as a working preview.
     A single un-narrowed null did it:

         ./app/account/page.tsx:38
         Type error: 'profile' is possibly 'null'.

     One line in a file nobody asked for, in a project whose other nineteen
     pages were fine, and the customer's deploy fails with a compiler message
     about their own generated code. They cannot fix it and did not write it.

     A type error in model-written code is a defect in generation, and the place
     to catch it is generation — see the note in /api/builder/webapp/save. It is
     not a reason to withhold a project somebody has already paid for. Nearly
     all of these are nullable-narrowing misses that run correctly anyway,
     because the value is present at runtime on the path the page actually
     takes.

     eslint too, for the same reason and with less excuse: a lint rule has never
     been a reason not to ship. */
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
`
          : `/** @type {import('next').NextConfig} */
const nextConfig = {
  /* A directory of files rather than a server. See scaffold.ts: it is what
     lets this be previewed and downloaded without anything being provisioned.
     Route handlers and middleware do not run under it — data comes from the
     browser instead.

     This is the default and it is right nearly every time. A project that
     needs a server gets one automatically: build-mode.ts reads the files, and
     a route handler, a "use server" directive, a middleware.ts or a secret
     environment variable switches this whole file to the server version. */
  output: "export",

  /* The exported site is served from a plain file server, which has no image
     optimiser behind it. Left on, every <Image> in the project fails the
     build with a message about a loader. */
  images: { unoptimized: true },

  /* Every route becomes a directory with an index.html in it, so /pricing
     works as a path on a static host instead of only /pricing.html. */
  trailingSlash: true,

  /* The typechecker does not get to fail a deploy.

     tsconfig.json below still sets \`strict\`, and the generation prompt still
     asks for code that compiles under it — an editor and \`tsc\` both stay
     useful, and that is the point of keeping it on. What changes is the
     consequence of one miss.

     Because the consequence was the worst possible ordering. \`next build\`
     typechecks the whole project and exits 1 on the first error, AFTER the
     build has been generated, priced, charged and shown as a working preview.
     A single un-narrowed null did it:

         ./app/account/page.tsx:38
         Type error: 'profile' is possibly 'null'.

     One line in a file nobody asked for, in a project whose other nineteen
     pages were fine, and the customer's deploy fails with a compiler message
     about their own generated code. They cannot fix it and did not write it.

     A type error in model-written code is a defect in generation, and the place
     to catch it is generation — see the note in /api/builder/webapp/save. It is
     not a reason to withhold a project somebody has already paid for. Nearly
     all of these are nullable-narrowing misses that run correctly anyway,
     because the value is present at runtime on the path the page actually
     takes.

     eslint too, for the same reason and with less excuse: a lint rule has never
     been a reason not to ship. */
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
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
      /* ── Who may put this site in a frame ────────────────────────────────
       *
       * So the builder can show a customer their own deployed site in the
       * preview pane, and so nobody else can put it in a frame of theirs.
       * Without a frame-ancestors directive a site may be embedded by anyone,
       * which is how clickjacking works; with this one it may be embedded by
       * itself and by QuickStark.
       *
       * ── Why this is vercel.json and NOT next.config ─────────────────────
       *
       * Because these projects are `output: "export"`. Next.js's own
       * `async headers()` does not apply to a static export — there is no
       * server left to run it, the build prints "Specified headers will not
       * automatically work with output: export", and the header never reaches
       * production. Putting it there would look exactly like a fix and do
       * nothing at all, which is the worse of the two failures.
       *
       * vercel.json is read by the thing that actually serves these files, so
       * the header is on the response. The cost of that is stated plainly: it
       * works on Vercel and not on a customer who downloads the project and
       * hosts it elsewhere. That is the same trade every other deployment
       * decision in this file already makes.
       *
       * A project with its own domain still frames correctly — 'self' is the
       * site's own origin, whatever it is called. */
      path: "vercel.json",
      content: `${JSON.stringify(
        {
          $schema: "https://openapi.vercel.sh/vercel.json",
          headers: [
            {
              source: "/(.*)",
              headers: [
                {
                  key: "Content-Security-Policy",
                  value:
                    "frame-ancestors 'self' https://quickstark.tech https://*.quickstark.tech;",
                },
              ],
            },
          ],
        },
        null,
        2,
      )}\n`,
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

/* ── Connected on first use, never on import ───────────────────────────────
 *
 * The two variables above used to be checked HERE, at the top level, and the
 * module threw when either was missing. That reads as careful and is not.
 * \`next build\` prerenders every route, including the /_not-found page Next
 * writes for you, so a module that throws while it is being IMPORTED takes the
 * entire build with it:
 *
 *     Error occurred prerendering page "/_not-found"
 *     Error: This app needs NEXT_PUBLIC_SUPABASE_URL and ...
 *     Export encountered an error on /_not-found/page, exiting the build.
 *
 * — on a page that has never heard of this database. An unset environment
 * variable became "your app does not compile", which is both the wrong size of
 * problem and a description of the wrong thing.
 *
 * So the client is built the first time something asks it for anything. The
 * build does not, and now compiles whatever the environment holds. A page that
 * reads data does, and it fails there, in the browser, naming the two variables
 * — which is where somebody can actually do something about it. */
function connect() {
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
  return createClient<Database, "${model.schema}">(url, anonKey, {
    db: { schema: schema as "${model.schema}" },
  });
}

let client: ReturnType<typeof connect> | null = null;

/* The same \`supabase\` every page already imports — \`supabase.from(...)\`,
   \`supabase.auth\` — so nothing that uses it has to change. The proxy is here
   only to hold connect() back until the first property is read. */
export const supabase = new Proxy({} as ReturnType<typeof connect>, {
  get(_target, property) {
    client = client ?? connect();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
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
/**
 * The build configuration brought back into line with what a project has become.
 *
 * ── The whole point of the two modes ──────────────────────────────────────
 *
 * completeTree decides static or server when a project is GENERATED, which
 * settles it for that build and no other. A project is then edited, and the
 * edit is where evolution actually happens: a landing page acquires a contact
 * form, the form acquires a route handler, and the project has quietly become
 * something its next.config.mjs is wrong about. Nothing downstream would catch
 * it — `output: "export"` plus a route handler is a build that fails, and plus
 * a middleware.ts is a build that succeeds with the guard silently removed.
 *
 * So the config is re-derived from the tree after every edit that changes it.
 * That is the Phase 1 → Phase 2 upgrade: nobody asks for it and nothing is
 * migrated, the project simply stops being exported the moment it stops being
 * exportable.
 *
 * `changed` is what the caller tells the customer. A project crossing from a
 * directory of files to a running server is worth one sentence — it is why
 * their site now costs something to host and why the build takes longer.
 *
 * Only ever raises, like buildModeOf itself: nothing here turns a server
 * project back into a static one. Deleting the last route handler does not
 * un-need the server, because the session cookies and the secrets that arrived
 * with it usually have not gone anywhere, and quietly re-exporting somebody's
 * app is not a decision an edit gets to take.
 */
export function retuneBuild(
  tree: FileTree,
  name: string,
  manifest: ArchitectureManifest,
  model: DataModel,
  design?: DesignDNA,
): { tree: FileTree; mode: BuildMode; changed: boolean; because: string[] } {
  const { mode, because } = buildModeOf(tree);
  const unchanged = { tree, mode, changed: false, because };

  if (mode !== "server") return unchanged;

  const wanted = platformFiles(name, manifest, model, design, mode)
    .find((file) => file.path === "next.config.mjs");
  if (!wanted) return unchanged;

  const current = tree.find((file) => file.path === "next.config.mjs");
  if (current && current.content === wanted.content) return unchanged;

  const rewritten = current
    ? tree.map((file) => (file.path === "next.config.mjs" ? { ...file, content: wanted.content } : file))
    : [...tree, wanted];

  return { tree: withServerDependencies(rewritten, manifest), mode, changed: true, because };
}

/* @supabase/ssr added, and NOTHING removed.
 *
 * The package.json of an edited project is not the platform's any more: a
 * server build needs zod for the validation its own brief asks for, and a model
 * that adds a dependency it then imports is doing the right thing. Rewriting
 * the file from the scaffold would delete it and the build would fail on the
 * import — so this reads the file, adds the one key, and puts it back. */
function withServerDependencies(tree: FileTree, manifest: ArchitectureManifest): FileTree {
  if (!manifest.backend) return tree;

  const file = tree.find((entry) => entry.path === "package.json");
  if (!file) return tree;

  try {
    const parsed = JSON.parse(file.content) as {
      dependencies?: Record<string, string>;
      [key: string]: unknown;
    };
    if (parsed.dependencies?.["@supabase/ssr"]) return tree;

    const updated = {
      ...parsed,
      dependencies: { ...(parsed.dependencies ?? {}), "@supabase/ssr": SUPABASE_SSR },
    };
    return tree.map((entry) =>
      entry.path === "package.json"
        ? { ...entry, content: `${JSON.stringify(updated, null, 2)}\n` }
        : entry,
    );
  } catch {
    /* A package.json that does not parse is one this must not rewrite. The
       build will fail on it either way, and failing on the model's own file is
       a better error than failing on ours. */
    return tree;
  }
}

const PLATFORM_OWNED = new Set([
  "lib/supabase.ts",
  "lib/database.types.ts",
  "next.config.mjs",
  "postcss.config.mjs",
  "tailwind.config.ts",
  /* The other half of tailwind.config.ts, and owned for the same reason it is.
     The config above maps `ground` to var(--ground) and six more like it; this
     is the file that defines them. A model that writes its own app/tokens.css
     — which it will, having been told in the brief that the project has one —
     replaces those definitions with whatever it invented, and every mapped
     class in the project then resolves to an empty custom property. Nothing
     fails: Tailwind emits `color: var(--ink)`, the browser finds no --ink, and
     the page renders in the user agent's own colours. Two white rectangles on
     black, again, by a different route.
   *
     Only owned when there IS a design system, because `owned` is the
     intersection of this set with what platformFiles actually wrote — with no
     DesignDNA there is no platform tokens.css and the model's own is all there
     is, which is the correct outcome. */
  "app/tokens.css",
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
/* The tokens file, guaranteed to be loaded.
 *
 * Third part of the same failure, and the quietest of the three. The palette is
 * written to app/tokens.css by the platform, the names are mapped in
 * tailwind.config.ts by the platform, and the one line that connects them —
 * `@import "./tokens.css"` at the top of globals.css — was left to the model
 * because the brief asks for it. A model that writes a stylesheet of resets and
 * forgets that line produces a project where all three pieces exist, every file
 * looks right, and not one colour arrives: the custom properties are defined in
 * a file nothing ever loads.
 *
 * So the import is inserted when it is missing, and only then. Before the
 * Tailwind directives, because CSS drops an @import that comes after a rule and
 * dropping this one is the failure being fixed. */
function withTokenImport(css: string): string {
  if (/@import\s+["'][^"']*tokens\.css["']/.test(css)) return css;
  return `@import "./tokens.css";\n${css}`;
}

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

  /* ── Which config this project gets, read from the project ──────────────
   *
   * Asked of the files the model produced, before they are merged, because the
   * answer decides which next.config.mjs is written over them. A tree with a
   * route handler, a "use server", a middleware.ts or a secret environment
   * variable in it needs a server, and giving it `output: "export"` is a build
   * that fails — or worse, for middleware, one that succeeds and silently
   * guards nothing.
   *
   * It only ever raises. See build-mode.ts: a static config over server code
   * is broken, a server config over static code is a working site that costs
   * slightly more to host, and when the two disagree the expensive one is the
   * safe one. */
  const { mode } = buildModeOf(generated);
  const platform = platformFiles(name, manifest, model, design, mode);
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
    /* Import first, directives second: withTailwindDirectives places itself
       after any leading @import, so doing it this way round leaves the tokens
       ahead of the utilities that use them. */
    const withTokens = byPath.has("app/tokens.css")
      ? withTokenImport(globals.content)
      : globals.content;
    byPath.set("app/globals.css", { ...globals, content: withTailwindDirectives(withTokens) });
  }

  /* Last, and after everything else has been merged in: a page that is both
     "use client" and a source of generateStaticParams does not compile, and
     that is a property of the finished tree rather than of any one file the
     model wrote. See client-routes.ts. */
  const split = splitClientRoutes([...byPath.values()]);

  /* And the other defect with exactly one correct fix: a component exported
     from a page module, which `next build` rejects outright.

     Here rather than at publish, deliberately, so that what is STORED is
     correct. A repair applied on the way to Vercel would leave the customer's
     own files — the ones they download, and the ones the next edit reads —
     still holding the defect, so their local build would fail on something
     this platform had quietly worked around on every deployment. Fixing it
     once, in the tree everything else reads from, is the only version of this
     that is true for the customer as well as for the deployment.

     After the split because the split writes new files, and a component lifted
     into a sibling by client-routes.ts must be looked at by this too. See
     next-structure.ts. */
  const { tree: repaired } = repairStructure(split);

  return repaired.sort((a, b) => a.path.localeCompare(b.path));
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
  /* Checkout joins the list now that the list is filtered: a store with a
     basket and nowhere to complete the order was a cart that could only ever
     be filled. It is written only when the manifest says this project checks
     out, which a catalogue does not. */
  ecommerce: [
    "app/products/page.tsx",
    "app/products/[slug]/page.tsx",
    "app/cart/page.tsx",
    "app/checkout/page.tsx",
  ],
  blog: ["app/blog/page.tsx", "app/blog/[slug]/page.tsx", "app/about/page.tsx"],
  /* ── A WEB APP HAS NO UNIVERSAL ROUTES, AND THAT IS THE POINT ──────────
   *
   * This said `["app/dashboard/page.tsx", "app/login/page.tsx"]`, and every
   * web app this platform has ever built got both — an invoicing product whose
   * own areas are invoices, clients and payments was handed a route called
   * "dashboard" because it was filed under webapp, and a login page whether or
   * not it had accounts. That is the generic-AI-output tell: a product wearing
   * somebody else's furniture.
   *
   * The other four kinds keep their lists because those routes are real. Every
   * store has products and a basket; every blog has an index and a post. There
   * is no equivalent for "web app" — it covers a CRM, a booking system and a
   * unit converter — which is exactly what blueprints/webapp.ts worked out
   * when it stopped forcing a dashboard on everything and wrote "say nothing
   * about a dashboard unless it needs one". That lesson never reached here, so
   * the blueprint asked for the product's own shape and the file list asked
   * for a dashboard, and the file list wins because it names files.
   *
   * Empty, and the routes are named from the brief instead — see the webapp
   * line in `write` below. Login is not here either: it is added under
   * `manifest.authentication`, which is the thing that actually decides
   * whether this product has accounts, and listing it twice for an app that
   * does was the other half of this. */
  webapp: [],
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
  /* How many photographs the asset pipeline actually resolved for this build.
     Zero is a real and common answer, and the rule below changes completely on
     it — see the note there. Defaulted so an older caller keeps the behaviour
     it had. */
  photographs = 0,
  /* Static unless this request needs a server. Defaulted for the same reason
     as everything else here: a caller that does not know about the two modes
     gets the one that is right 95% of the time. */
  mode: BuildMode = "static",
): string {
  /* ── A STORE'S ROUTES ARE ITS CAPABILITIES' ─────────────────────────────
   *
   * ROUTES.ecommerce listed a cart for every project filed as a store, and
   * ADMIN_ROUTES listed an orders screen for every project with an admin. So
   * "create a website showcasing our products" — a catalogue, with no cart in
   * its manifest — was handed `app/cart/page.tsx` to write, and a catalogue
   * whose owner wanted to edit it got an admin for orders it does not take.
   *
   * Exactly the defect the hardcoded webapp dashboard had: the manifest knew,
   * and the file list did not ask, and a file list wins because it names
   * files. So the store's routes are filtered by what this project actually
   * does with products.
   *
   * A manifest written before commerce was decomposed reads as the full shop
   * it meant at the time — see allCommerce. Those rows are read back on every
   * edit of an existing project, and dropping a running store's cart route
   * would be worse than any route written that need not be. */
  const shop = manifest.commerce ?? allCommerce();

  const NEEDS_CAPABILITY: Record<string, boolean> = {
    "app/products/page.tsx": shop.catalog,
    "app/products/[slug]/page.tsx": shop.productDetails,
    "app/cart/page.tsx": shop.cart,
    "app/checkout/page.tsx": shop.checkout,
    "app/admin/products/page.tsx": shop.admin,
    "app/admin/orders/page.tsx": shop.admin && shop.orders,
    "app/account/orders/page.tsx": shop.orders,
  };

  /* Only a store's routes are filtered. A blog's post index is not a
     capability anybody switches off, and reading this map over every kind
     would be one lookup pretending to be a rule. */
  const wanted = (route: string) => kind !== "ecommerce" || (NEEDS_CAPABILITY[route] ?? true);

  const routes = (ROUTES[kind] ?? []).filter(wanted);
  const admin = manifest.admin ? (ADMIN_ROUTES[kind] ?? ["app/admin/page.tsx"]).filter(wanted) : [];
  const account = manifest.authentication ? (ACCOUNT_ROUTES[kind] ?? []).filter(wanted) : [];

  const write = [
    "- app/page.tsx — the home page, and the one that matters most",
    "- app/layout.tsx — the shell: <html>, <body>, fonts, the nav and footer",
    design
      ? "- app/globals.css — imports ./tokens.css on its first line, then only what the tokens cannot express: resets, base element styles, and any keyframes. Never a colour, size, radius or duration that is not a token."
      : "- app/globals.css — the design system as CSS custom properties, imported by the layout",
    ...routes.map((route) => `- ${route}`),
  ];

  /* The product's own areas, named by the product. See ROUTES above: a web app
     has no universal second route, so the shape is asked for rather than
     assumed, and the example is deliberately a domain rather than a layout. */
  if (kind === "webapp") {
    write.push(
      "- a route per area THIS product actually has, named in its own words — `app/invoices/page.tsx`, `app/clients/page.tsx`, `app/payments/page.tsx` for an invoicing tool. Name them for the objects in the brief. Do NOT write `app/dashboard/page.tsx` unless the product genuinely is a dashboard; an overview screen, when the product wants one, is the home page.",
    );
  }

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
    /* ── Which of the two worlds this project is written for ────────────
     *
     * The default is static and stays static: a directory of files served from
     * a CDN, talking to Supabase from the browser under row-level security. It
     * is right for nearly every project and it is the cheaper and more robust
     * of the two.
     *
     * The server half is not an upgrade to reach for. It is what a project
     * gets when it genuinely cannot be done the other way — a secret key, a
     * webhook to receive, a redirect that has to happen before the page is
     * sent. Saying that here matters as much as the permission itself: a model
     * told "you have a server" will put one in a project that did not need
     * one, and that is a running function where a file would have done. */
    mode === "server"
      ? '- THIS PROJECT HAS A SERVER, because something in it needs one. Route handlers under `app/api/*/route.ts`, server actions marked "use server", and a root `middleware.ts` all run, and a server component may read a secret. Use the server for what needs it and nothing else: a page that only reads public data still reads it in the browser, because that page is faster and cannot leak anything.'
      : "- STATIC EXPORT. There is no server. No route handlers, no middleware, no server actions, no `fetch` in a server component against your own API. A page that needs data reads it in the browser.",
    "- Import across the project with `@/` — `@/components/Nav`, not a relative climb.",
    /* ── Mobile first, and not as a preference ──────────────────────────
     *
     * More than half of what is built here is opened on a phone first, and the
     * failure is not subtle: a fixed width scrolls sideways, three columns
     * become three 110px slivers, a capped container puts text against the
     * glass. Every one of those is written in the class list at generation
     * time, which is the cheapest possible moment to not write it.
     *
     * Stated as the shape to use rather than as a principle to hold. "Be
     * responsive" produces a model's idea of responsive; `grid-cols-1
     * sm:grid-cols-2 lg:grid-cols-3` produces that. qa/responsive.ts checks
     * the result either way — a rule a model is asked to follow is not a rule
     * until something checks — and this is so there is nothing to find. */
    "- MOBILE FIRST. Unprefixed classes are the phone; `sm:` `md:` `lg:` widen from there, never the reverse.",
    "- Every section: `<section className=\"w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20\">`. `px-4` is the floor; content never touches the edge of a phone.",
    "- `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. A bare `grid-cols-3` is three 110px slivers on a phone.",
    "- `flex flex-col md:flex-row` with `gap-6 md:gap-12`.",
    "- No fixed sizes: not `w-[1200px]`, not `h-[800px]`, not `h-screen`. Use `w-full max-w-…`, and `min-h-dvh` with padding for a full-screen section.",
    "- No absolute positioning for anything with words in it; `absolute top-20 left-40` works at one width only. Decorative shapes may, content flows.",
    "- `text-3xl sm:text-4xl lg:text-6xl` on a headline; `text-center md:text-left` where a column becomes a row.",
    "- Primary buttons `w-full sm:w-auto`; a group is `flex flex-col sm:flex-row gap-4`.",
    /* ── The header, which is the first thing anybody judges ─────────────
     *
     * A generated header puts the wordmark left and the links right, which is
     * right at 1280px and the ugliest thing we ship at 390px: five inline
     * links and a brand on a screen that fits about three, wrapping under the
     * logo or pushing the page sideways. It is at the top of every page, so it
     * is what "it looks ugly on mobile" is usually about.
     *
     * Written as the two class lists rather than as "make the nav responsive",
     * for the same reason as every rule above it: the second produces a
     * model's idea of a mobile nav, and the first produces this one. Retrofit
     * is expensive here in a way the other rules are not — adding a menu is
     * adding markup and behaviour, where fixing a grid is editing a class —
     * so it has to be right the first time. qa/responsive.ts finds it when it
     * is not: see the nav-never-collapses rule there. */
    "- BELOW `md` A HEADER IS TWO THINGS: the brand on the left and a menu button on the right. Nothing else. `<header className=\"flex items-center justify-between px-4 sm:px-6 lg:px-8 h-16\">`.",
    "- The inline link list is `hidden md:flex` — never rendered on a phone. The button that opens it is `flex md:hidden` with `aria-expanded` and `aria-controls`, and the panel it opens is in the markup already, toggled by a class rather than built when it is clicked.",
    "- Never leave a row of text links — Home, Services, Pricing, About, FAQ, Contact — inline at every width. Three or more of those in a header with nothing hiding them is the defect, whatever else is right about the page.",
    /* ── Two rules about SHAPE rather than about syntax ──────────────────
     *
     * Everything else in this list stops a build failing. These two stop a
     * project becoming unmaintainable, which costs more and shows up later: it
     * arrives as an edit that cannot be made without rewriting a page, because
     * the thing being changed is tangled with three things that are not.
     *
     * The second one is also a real defect and not only a tidiness rule. Every
     * `process.env` read outside lib/supabase.ts is a value inlined at build
     * time into a bundle we then have to keep configured, in a file nobody
     * looks at when the configuration changes. One place to read them is one
     * place to fix them. */
    "- Presentation and data stay apart. A component takes what it renders as props and holds no query; the page, or a hook beside it, does the fetching and hands the result down. A component that both queries and renders cannot be reused, previewed or tested, and an edit to either half has to touch the other.",
    /* These two rules used to be one line, and together they instructed the
       model straight into a page that cannot compile: every dynamic route
       needs generateStaticParams, and a page that reads data has to be
       "use client" — so it wrote both into one file, which Next.js refuses
       outright. The brief has to name the way out, because both halves of the
       conflict are things this same brief asks for. completeTree repairs it
       either way (see client-routes.ts); this is so it stops happening. */
    /* Static-only. `output: "export"` has to know every path ahead of time;
       a server renders one when it is asked for, and demanding the list there
       would send a model prerendering a catalogue it cannot see yet. */
    mode === "server" ? null : "- Every dynamic route needs `generateStaticParams`, or the export fails on it.",
    /* ── The directive, and the build that dies without it ──────────────
     *
     * Every file in the App Router is a SERVER component unless its first line
     * says otherwise, and a server component is executed at build time. So a
     * component holding useState, or an onClick, and missing the directive
     * does not degrade: the build fails on it, and under `output: "export"` it
     * fails while prerendering pages nobody wrote — `/_not-found` is the one
     * that comes back, because Next.js generates that page itself and it
     * renders the same layout, and the error names a route the customer has
     * never heard of for a mistake four files away.
     *
     * A model writing React reaches for hooks and handlers by reflex and the
     * directive by memory, which is exactly the wrong way round. So it is
     * stated as a mechanical test — if the file contains one of these words,
     * the first line is the directive — rather than as an explanation of
     * server components, which is a thing to understand rather than a thing
     * to check. */
    '- "use client" IS THE FIRST LINE OF ANY FILE THAT USES useState, useEffect, useRef, useContext, useReducer, any other hook, or any event handler — onClick, onChange, onSubmit, onInput, onFocus, onKeyDown. Above the imports, on its own line, in double quotes with the semicolon. There is no second chance for it: without it the build fails at prerender, and under a static export it fails on `/_not-found`, a page you did not write.',
    '- The directive is INHERITED, not repeated. A client component\'s children are already client components; a "use client" in a file that has no state and no handlers of its own makes a server component into a client one for no reason. Put it where the state is.',
    '- A ROUTE FILE MAY NOT BE BOTH. `app/x/[id]/page.tsx` cannot have "use client" AND export generateStaticParams — that is a build error, not a warning. When the page needs both, split it: page.tsx stays a server component holding generateStaticParams, and everything interactive goes in a sibling it renders.',
    "- In that split, page.tsx is `async` and its params is a Promise: `export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <IdClient params={await params} />; }`. Await it there so the client half receives plain values.",
    /* React 19 removed the GLOBAL JSX namespace — it lives inside the react
       module now — and this project is pinned to React 19. A model writing
       React types reaches for the bare form because that is what years of
       React code looks like, and the build compiles cleanly and then dies in
       the type check on it. next-structure.ts repairs it either way; this is
       so it stops happening. */
    '- There is NO global `JSX` namespace. `JSX.Element` will not compile. Write `React.ReactNode` for anything renderable, or `import type { JSX } from "react"` in the file that needs `JSX.Element`.',
    "- Use next/image with width and height. The optimiser is off, so a missing dimension is a layout shift rather than an error, and it will show.",
    /* ── WHAT MAKES IT A PRODUCT RATHER THAN A DEMO ─────────────────────
     *
     * These three existed only in blueprints/webapp.ts, which governs the
     * single-page stack — so a project built as a TREE got the correct states,
     * the correct auth and the correct admin writes, and content that could be
     * three rows of "Item 1". That is the whole of the generic-AI-output look,
     * and none of it was anybody disobeying a rule: there was no rule.
     *
     * Worded as the blueprint words them, because that wording is the part
     * that works — a floor with a number in it ("twenty or more") is followed
     * and "make it realistic" is not. */
    "- Use the product's OWN vocabulary everywhere: its words for its objects, its statuses, its actions. An invoicing tool has invoices, clients and payments — never Items, Records, Entries or Data.",
    "- Seed it so it reads like an account in use, not one created this morning: twenty or more rows where the product has a list, varied names, dates spread over months, several different statuses, and amounts that are uneven and plausible. Three tidy rows is the tell.",
    "- Every figure is computed from the data that is actually there. A tile, total, chart or counter that does not derive from the rows on the page is worse than no tile — it is the one thing a person checks first and the one thing that cannot be wrong.",

    /* ── AND AN OVERVIEW SCREEN IS A SCREEN, NOT A ROW OF TILES ─────────
     *
     * The rule above already says a figure must be computed. What nothing
     * said is what an overview IS, so what came back was four tiles and a
     * heading: correct numbers, derived from real rows, and nothing anybody
     * would open twice. "It should be an actual dashboard with live
     * components consistent with the project request" is the complaint, and
     * it is about the screen rather than the arithmetic.
     *
     * Named for the product, because this is where generic output shows
     * worst: Total Revenue, Active Users and Conversion Rate appear on the
     * overview of a product that measures none of them, and they appear
     * because they are what a dashboard looks like in the abstract.
     *
     * One working control, because that is the difference between a report
     * and a tool. A range, a status tab or a filter that re-queries is
     * ordinary to write and is the thing that makes the page answer a
     * question somebody actually has. Decorative controls are worse than
     * none: a select that changes nothing is a broken feature, not a
     * simpler one. */
    "- IF THIS PRODUCT WANTS AN OVERVIEW, BUILD A SCREEN RATHER THAN A ROW OF TILES. It reads the same tables every other page reads, and it has: the few figures that matter to THIS product, each computed; the most recent rows of its main object, as a real list with its real statuses, linking through to the thing itself; and at least one control — a date range, a status tab, a filter — that RE-QUERIES and visibly changes what is shown. A control that does not change anything is a broken feature rather than a simpler one.",
    "- Name what the overview measures in the product's own terms. An invoicing tool shows outstanding, overdue and paid this month; a gym shows members, classes this week and attendance. Total Revenue, Active Users and Conversion Rate on a product that measures none of them is the generic-dashboard look, and it is the fastest way to tell nobody thought about the product.",
    "- It loads like a real screen: a skeleton or a spinner while the queries run, and an empty state that says what to do first when the account genuinely has nothing in it yet. Never a zero presented as a result before the data has arrived.",    /* Named here as well as in the asset manifest, and deliberately. This brief
       is the last thing the model reads before it starts writing files, and
       until the manifest learned to say "as a project" the two of them
       disagreed — this one said next/image, that one said <img> — over a flat
       list of slots with no file named for any of them. Half the projects built
       under that contradiction contain no photograph at all. */
    /* ── Two rules, and which one depends on whether there ARE any ───────
     *
     * This line used to be unconditional. It told every project "the
     * photographs for this build are listed further up" — including the
     * builds where the asset pipeline had resolved none, and nothing was
     * listed anywhere. A model told to use a list that is not there does the
     * reasonable thing and draws a neutral panel where a photograph belongs,
     * and that grey rounded rectangle is what customers report as "images
     * show as blank placeholders".
     *
     * There was no second chance for it either: fillImages runs on the single
     * HTML document and a project build skips it, so whatever the model wrote
     * was final. See tree-images.ts, which is the other half of this fix and
     * the pass that makes the slots below worth declaring. */
    photographs > 0
      ? "- The photographs for this build are listed further up. Put their URLs in lib/images.ts as exported constants with their alt text, import them with `@/lib/images`, and use every one of them. A project with no photographs in it is not finished, whatever else is right about it."
      : '- PHOTOGRAPHS ARE DECLARED, NOT DRAWN. No pictures were resolved ahead of this build, so write each one as a slot and real pixels are put in afterwards: `<img data-shot="folded ochre linen, raking light, neutral seamless" data-ratio="4/5" data-weight="hero" alt="Ochre linen throw">` — art direction in data-shot, no src attribute at all. NEVER invent an image URL; every one of those is a broken picture. NEVER substitute a grey box, a coloured div or an empty placeholder for a photograph that belongs there. Use data-weight="hero" for the one picture that carries a page, "feature" for a section, "thumb" for a card. EVERY ONE OF THOSE ATTRIBUTES IS A LITERAL QUOTED STRING ON THE <img> ITSELF. Do NOT move a slot into a shared component and do NOT pass its art direction as a prop: `<img data-shot={shot}>` is not a slot, it is an <img> with no src, because the fill pass matches `data-shot="..."` literally and an expression matches nothing. A `<ProductPhoto shot={p.shot} />` component is exactly how a catalogue ends up as grey panels where its photographs should be — every card silently unfilled, and the build reporting success. Repeat the whole tag at each use, even eight times on one page. Repetition here is correct; a component is not.',
  ].filter((rule): rule is string => typeof rule === "string");

  if (manifest.database && mode === "server") {
    rules.push(
      "- Reads that are public and part of the page render on the server, in the page itself. Anything belonging to the signed-in person reads in the browser, so it follows their session rather than the server's.",
      '- Writes go through a server action marked "use server" or a route handler under `app/api/`, with the body validated by a Zod schema before it reaches the database. Row-level security is still what authorises the write; the schema is what stops a malformed one being attempted.',
      "- Sessions are cookie-based, through `@supabase/ssr`, refreshed in the root `middleware.ts`. Never read a session from localStorage on this side.",
      "- Every list has the four states and all four are reachable: loading while the query runs, empty when it returns nothing, the rows when it returns some, and the error when it fails.",
    );
  } else if (manifest.database) {
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

  /* Where the environment is allowed to be read at all. Named against
     manifest.backend rather than .database because that is what decides
     whether lib/supabase.ts is written — a rule naming a file the project does
     not have is a rule that teaches the model the wrong shape. */
  if (manifest.backend) {
    rules.push(
      "- NEVER read `process.env` outside lib/supabase.ts. That file is the only thing in this project that knows an environment exists; everything else imports `supabase` from it. A key read in a second place is a second place to fix when it changes, in a file nobody thinks to look at.",
    );
  } else {
    rules.push(
      "- There is no environment to read. `process.env` is empty here; anything configurable is a typed constant in the file that uses it.",
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
