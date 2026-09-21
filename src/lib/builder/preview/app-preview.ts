/* The document that runs a generated project inside the builder.
 *
 * Assembles what runtime.ts needs into one self-contained page: the project's
 * source as data, the route table read off its directories, its own stylesheet,
 * and the handful of script tags that make a `.tsx` tree runnable in a browser
 * with no build step.
 *
 * ── Why this exists at all ────────────────────────────────────────────────
 *
 * Because the alternative was deployment. A project build produced `.tsx` and
 * nothing here could compile it, so the preview showed project-summary.ts — a
 * written account of the files — and the only way to see the actual product was
 * to push it to Vercel and wait. That made the production deployment layer
 * responsible for the primary editing experience, which is backwards, and it
 * meant a deployment failure left the customer with no preview at all: the
 * thing they had paid to have built became invisible because a build log
 * somewhere said "type error".
 *
 * So the preview no longer depends on anything outside this document. It
 * renders from source that is already in the database, in the browser, and a
 * Vercel that is down, unconfigured or angry about a type error changes nothing
 * about it.
 *
 * ── What the summary is for now ───────────────────────────────────────────
 *
 * project-summary.ts is still written and still stored — but as DIAGNOSTICS,
 * behind the preview, rather than as the preview. The receipt was always useful
 * and was never a product. See src/app/preview/[projectId]/route.ts, which
 * serves this for the pane and the summary at `?diagnostics=1`.
 */

import type { FileTree } from "../tree";
import { entryRoute, routesOf } from "./routes";
import { PREVIEW_RUNTIME } from "./runtime";

/* Pinned rather than floating. A preview that renders differently this week
   because a CDN shipped a major version is a support ticket nobody can
   reproduce.

   REACT 18 RATHER THAN 19, deliberately, and it is the one version choice here
   that is not simply "the newest". React 19 ships no UMD build at all — the
   global-script bundles were dropped, and there is no <script src> form of it
   to load into a document that has no bundler. A project scaffolded against
   React 19 still renders correctly under 18: what a generated page uses is
   function components, hooks and the JSX runtime, all of which 18 has. What it
   would NOT have is anything 19-only, which scaffold.ts does not emit.

   Getting this wrong is silent and total. A 404 on this tag leaves `React`
   undefined, the runtime throws on its first createElement, and the pane shows
   a failure for every project on the platform at once — so the version here is
   checked against what the CDN actually publishes rather than against
   package.json. See tools/check-preview-document.mjs. */
const REACT = "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js";
const REACT_DOM =
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js";
const BABEL = "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.28.4/babel.min.js";
const LUCIDE = "https://cdnjs.cloudflare.com/ajax/libs/lucide/0.462.0/lucide.min.js";
/* The same play CDN the single-page stack has always styled itself with — see
   lib/standalone-page.ts, which exists because of what it does NOT do offline. */
const TAILWIND = "https://cdn.tailwindcss.com";

/** The file extensions the runtime can compile. Everything else is not source. */
const SOURCE = /\.(?:tsx?|jsx?|mjs|json)$/;

/* Files that would be compiled by the runtime for no purpose, and in one case
   for harm: the config files are read here rather than required, and a
   next.config that gets evaluated in a browser does nothing but throw. */
const NOT_SOURCE = [
  /^next\.config\./,
  /^postcss\.config\./,
  /^tailwind\.config\./,
  /^package(?:-lock)?\.json$/,
  /^tsconfig\.json$/,
  /^\.eslintrc/,
  /^middleware\./,
];

function isSource(path: string): boolean {
  if (!SOURCE.test(path)) return false;
  return !NOT_SOURCE.some((pattern) => pattern.test(path));
}

/* Interpolated into a <script> as JSON. The closing-tag break is the one that
   matters: a project whose source contains the characters `</script>` — a
   landing page about writing HTML, say — would otherwise end the tag early and
   spill the rest of the tree into the document as markup. */
function embed(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The project's Tailwind theme, as something the play CDN will accept.
 *
 * scaffold.ts owns tailwind.config.ts and writes the design tokens into it, so
 * without this every `text-ink` and `bg-surface` in the project resolves to
 * nothing and the app renders unstyled — which, as lib/standalone-page.ts
 * argues at length about the download, looks broken rather than looking plain.
 *
 * A source-level strip rather than a parse: the file is generated from a
 * template this platform controls, so the shapes it comes in are known. When it
 * does not match, the config is dropped rather than guessed at — Tailwind's own
 * defaults still style the page, and the tokens stylesheet still carries the
 * colours as custom properties.
 */
export function tailwindConfigScript(tree: FileTree): string | null {
  const file = tree.find((entry) => /^tailwind\.config\.[jt]s$/.test(entry.path));
  if (!file) return null;

  let source = file.content
    /* `import type { Config } from "tailwindcss"` and any other import. There is
       no module system in the tag this ends up in. */
    .replace(/^\s*import\s[^;]*;?\s*$/gm, "")
    /* `satisfies Config`, `as Config`, and the annotation on a const. */
    .replace(/\bsatisfies\s+\w+/g, "")
    .replace(/\bas\s+(?:const|Config)\b/g, "")
    .replace(/(\bconst\s+\w+)\s*:\s*[A-Za-z_$][\w$<>.\[\]|\s]*=/g, "$1 =");

  /* `export default { ... }` and `const config = {...}; export default config;`
     are the two shapes scaffold.ts produces. Both become an assignment. */
  if (/export\s+default\s+/.test(source)) {
    source = source.replace(/export\s+default\s+/, "window.__qsTailwind = ");
  } else {
    return null;
  }
  /* A trailing `export {}` or named export would be a syntax error here. */
  source = source.replace(/^\s*export\s+(?:\{[^}]*\}|const|let|var|function)[^\n]*$/gm, "");

  return source;
}

/**
 * The project's own stylesheet, with its imports resolved.
 *
 * `app/globals.css` imports `./tokens.css` on its first line — scaffold.ts
 * inserts that line itself, because the tokens are written by the platform and
 * the stylesheet is written by the model. There is no resolver in a browser for
 * a relative CSS import to a file that only exists in a database row, so it is
 * inlined here.
 */
export function stylesheetOf(tree: FileTree): string {
  const byPath = new Map(tree.map((file) => [file.path, file.content]));
  const globals = byPath.get("app/globals.css");
  if (!globals) return byPath.get("app/tokens.css") ?? "";

  return globals.replace(/@import\s+(?:url\()?["']([^"')]+)["']\)?\s*;/g, (whole, href: string) => {
    const target = href.startsWith("./") || href.startsWith("../")
      ? `app/${href.replace(/^\.\//, "")}`
      : href;
    /* A real URL is left alone — a Google Fonts import should still fetch. */
    if (/^https?:/i.test(href)) return whole;
    return byPath.get(target) ?? "";
  });
}

/* ── The same stylesheet, in a block the BROWSER applies ──────────────────
 *
 * A project's whole design system — its tokens, its base element styles, its
 * container rule — went into `<style type="text/tailwindcss">` and nowhere
 * else. A browser does not apply a style element with an unknown type. Only
 * the Tailwind CDN script does, after it loads, by reading that block and
 * compiling it.
 *
 * Which means every generated preview hung its entire appearance on one
 * third-party script. Measured in Chromium against a real project: with that
 * one request failing, the page still RENDERS — the heading, the cards, the
 * footer, all correct — and it renders with no palette, no gutters, Times New
 * Roman, and blue underlined links. Text against the edge of the glass on a
 * phone. Indistinguishable, to the person looking at it, from us having built
 * them something broken.
 *
 * So the project's own CSS is emitted twice: once natively, first, and once in
 * the Tailwind block as before. When the CDN loads, the second block wins on
 * order and nothing changes — this is invisible. When it does not, the design
 * survives. Only Tailwind's own utility classes are lost, which is the part
 * that genuinely needs the compiler.
 *
 * The two directives that are meaningless to a browser come out: `@tailwind`
 * is Tailwind's, and `@import` has already been inlined by stylesheetOf, so
 * what is left of one is a request for a file that is not there. Browsers drop
 * both harmlessly; removing them keeps the devtools console honest. */
function nativeCss(styles: string): string {
  return styles
    .replace(/^[ \t]*@tailwind\s+[^;]+;[ \t]*$/gm, "")
    .replace(/^[ \t]*@import\s+(?:url\()?["'][^"')]+["']\)?\s*;[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* The chrome around the app: a route switcher and the failure states.
 *
 * Deliberately minimal and deliberately OUTSIDE the app's own styling. The
 * project brings Tailwind and its own tokens, and a preview shell that used the
 * same classes would change colour when the customer changed their palette. */
const SHELL = `
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; }
  #qs-root { min-height: 100dvh; }
  .qs-bar {
    position: sticky; top: 0; z-index: 2147483000;
    display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
    padding: 7px 10px;
    background: #0b1120; color: #cbd5f5;
    font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    border-bottom: 1px solid rgba(148,163,184,0.22);
  }
  .qs-bar button {
    appearance: none; border: 1px solid rgba(148,163,184,0.28);
    background: rgba(148,163,184,0.10); color: inherit;
    border-radius: 999px; padding: 3px 10px; font: inherit; cursor: pointer;
  }
  .qs-bar button:hover { background: rgba(148,163,184,0.2); }
  .qs-bar button[aria-current="true"] { background: #e2e8f0; color: #0b1120; border-color: #e2e8f0; }
  .qs-failure {
    margin: 0; min-height: 60dvh; display: grid; align-content: center; justify-items: center;
    gap: 8px; padding: 40px 24px; text-align: center;
    font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #475569; background: #f8fafc;
  }
  .qs-failure-title { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; }
  .qs-failure-body { margin: 0; max-width: 60ch; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; color: #64748b; }
  .qs-failure-hint { margin: 0; max-width: 46ch; font-size: 13px; color: #94a3b8; }
`;

export type AppPreviewInput = {
  tree: FileTree;
  projectName?: string | null;
  /** Whether to draw the page-switcher bar above the app.
   *
   *  False in the workspace pane, where the bar is chrome the customer did not
   *  ask for sitting on top of the thing they did: it is not part of their
   *  project, it does not appear on the deployed site, and in a narrow pane it
   *  is the first row of what should be their own header. The full-screen
   *  preview keeps it, because there the routes are the only way to move
   *  around a project that has no navigation of its own yet. */
  chrome?: boolean;
  /** The `process.env` a generated module sees. See `window.__QS_ENV` below.
   *  NEXT_PUBLIC_ values only — anything else would be handing a secret to a
   *  document built to be untrusted. */
  env?: Record<string, string> | null;
};

/**
 * Whether this tree is something the in-builder renderer can run.
 *
 * A tree with no page is not a Next.js project — it is a scaffold that failed
 * halfway, or a single-page build that belongs in the other renderer entirely.
 * Asked before the document is built so the caller can fall back to the summary
 * rather than serving a shell with nothing in it.
 */
export function canRenderApp(tree: FileTree): boolean {
  return routesOf(tree).length > 0;
}

/**
 * The project, as a document that runs it.
 *
 * Returns null when there is nothing to run — see canRenderApp. Never throws:
 * this is called on the path that serves somebody their own work, and a
 * renderer that can fail to produce a document is one that can take the preview
 * down for the same reason deployment used to.
 */
export function appPreviewDocument(input: AppPreviewInput): string | null {
  const { tree, env, chrome = true } = input;
  const routes = routesOf(tree);
  if (routes.length === 0) return null;

  const files: Record<string, string> = {};
  for (const file of tree) {
    if (isSource(file.path)) files[file.path] = file.content;
  }

  const entry = entryRoute(routes);
  const config = tailwindConfigScript(tree);
  const styles = stylesheetOf(tree);
  const title = escapeHtml(input.projectName?.trim() || "Preview");

  /* The route switcher. A generated project's own nav covers the pages a
     visitor is meant to reach; this covers the ones they are not — an admin
     route, a dynamic page, anything reachable only by typing an address — so
     the customer can check every screen that was built for them. */
  const switcher = routes
    .map((route) => {
      const target = route.dynamic
        ? route.segments
            .map((segment) =>
              segment.kind === "static"
                ? segment.value
                : segment.param.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "item",
            )
            .reduce((path, segment) => `${path}/${segment}`, "") || "/"
        : route.pattern;
      return `<button type="button" data-href="${escapeHtml(target)}">${escapeHtml(route.pattern)}</button>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<!-- What this document is, for anything that reads it back. The workspace
     distinguishes a rendered app from a summary without parsing either. -->
<meta name="quickstark:document" content="app-preview">
<script>window.__qsTailwindReady=false;</script>
${config ? `<script>${config}\nwindow.tailwind = window.tailwind || {}; if (window.__qsTailwind) window.tailwind.config = window.__qsTailwind;</script>` : ""}
<script src="${TAILWIND}"></script>
${config ? `<script>try { if (window.__qsTailwind && window.tailwind) window.tailwind.config = window.__qsTailwind; } catch (e) {}</script>` : ""}
<style>${SHELL}</style>
${styles ? `<style>${nativeCss(styles).replace(/<\/style/gi, "<\\/style")}</style>` : ""}
${styles ? `<style type="text/tailwindcss">${styles.replace(/<\/style/gi, "<\\/style")}</style>` : ""}
</head>
<body>
${chrome ? `<nav class="qs-bar" aria-label="Pages in this project">${switcher}</nav>` : ""}
<div id="qs-root"></div>
<script src="${REACT}" crossorigin></script>
<script src="${REACT_DOM}" crossorigin></script>
<script src="${LUCIDE}"></script>
<script src="${BABEL}"></script>
<script>
window.__QS_FILES = ${embed(files)};
window.__QS_ROUTES = ${embed(
    routes.map((route) => ({
      file: route.file,
      pattern: route.pattern,
      segments: route.segments,
      layouts: route.layouts,
    })),
  )};
window.__QS_ENTRY = ${embed(entry)};
/* What the project's modules get as process.env.
 *
 * lib/supabase.ts reads NEXT_PUBLIC_SUPABASE_URL and its siblings from it —
 * see builder/scaffold.ts. A real build inlines those; nothing here does, so
 * before this existed the identifier "process" reached the browser intact and
 * every screen importing the Supabase client died on
 * "ReferenceError: process is not defined". runtime.ts hands this to each
 * module as a parameter.
 *
 * No backticks in this comment: it sits inside the template literal that
 * builds this document, and one would end it.
 *
 * NEXT_PUBLIC_ only, and that is not a shortcut: those three are compiled into
 * any real build of this project and served to every visitor, so this document
 * learns nothing a deployed copy would not already publish. Empty is a working
 * state too — the generated client then reports itself unconfigured on first
 * use rather than throwing on import. */
window.__QS_ENV = ${embed(env ?? {})};
</script>
<script>${PREVIEW_RUNTIME}</script>
<script>
(function () {
  var bar = document.querySelector('.qs-bar');
  if (!bar) return;
  bar.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-href]');
    if (!button || !window.__qsNavigate) return;
    window.__qsNavigate(button.getAttribute('data-href'));
    var all = bar.querySelectorAll('button[data-href]');
    for (var i = 0; i < all.length; i += 1) all[i].setAttribute('aria-current', String(all[i] === button));
  });
  var first = bar.querySelector('button[data-href]');
  if (first) first.setAttribute('aria-current', 'true');
})();
</script>
</body>
</html>`;
}
