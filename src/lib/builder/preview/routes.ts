/* The addresses a generated project answers on, and what wraps each of them.
 *
 * The App Router's routing rules are conventions over a directory, not
 * configuration: `app/blog/[slug]/page.tsx` is a route because of where it sits
 * and what it is called, and the layouts that wrap it are every `layout.tsx` on
 * the way down to it. Nothing in this codebase read those conventions, because
 * nothing needed to — the tree was uploaded to Vercel and `next build` did the
 * reading. The in-builder preview has to do it here instead.
 *
 * PURE ON PURPOSE, like kinds.ts and architecture.ts beside it: paths in, a
 * route table out, no SDK import and no DOM. The runtime that renders the app
 * is a string of browser JavaScript and cannot be tested; this is the half that
 * decides things, so this is the half that is worth testing on its own. See
 * tools/check-preview-routes.mjs.
 *
 * ── What is deliberately not here ─────────────────────────────────────────
 *
 * Parallel routes (`@slot`), intercepting routes (`(.)photo`) and route
 * handlers (`route.ts`). A generated marketing site or admin app has none of
 * them, and a router that half-implements interception is one that renders the
 * wrong thing confidently. They are reported as unsupported by the caller
 * rather than guessed at.
 */

import type { FileTree } from "../tree";

/** One segment of a route, once the file path has been read. */
export type Segment =
  | { kind: "static"; value: string }
  /** `[slug]` — matches exactly one segment, and names it. */
  | { kind: "dynamic"; param: string }
  /** `[...rest]` — matches one or more. `[[...rest]]` also matches none. */
  | { kind: "catchAll"; param: string; optional: boolean };

export type PreviewRoute = {
  /** The file that renders it. */
  file: string;
  /** The address, as a person would type it: `/`, `/blog/[slug]`. */
  pattern: string;
  segments: Segment[];
  /* Every layout that wraps this page, outermost first. The root layout is
     first when there is one; a project with no app/layout.tsx is malformed for
     Next.js but is still previewed, wrapped in nothing. */
  layouts: string[];
  /** Whether any segment is dynamic. Used to pick what to show first. */
  dynamic: boolean;
};

/* Route groups. `app/(marketing)/pricing/page.tsx` is `/pricing` — the
   parentheses organise files and are not in the URL. */
const GROUP = /^\([^)]*\)$/;

/* `_components` and friends. A leading underscore opts a folder out of routing
   entirely, which is how a generated project keeps helpers beside the pages
   that use them. */
const PRIVATE = /^_/;

const CATCH_ALL = /^\[\.\.\.(.+)\]$/;
const OPTIONAL_CATCH_ALL = /^\[\[\.\.\.(.+)\]\]$/;
const DYNAMIC = /^\[(.+)\]$/;

function segmentOf(raw: string): Segment | null {
  const optional = raw.match(OPTIONAL_CATCH_ALL);
  if (optional) return { kind: "catchAll", param: optional[1], optional: true };

  const rest = raw.match(CATCH_ALL);
  if (rest) return { kind: "catchAll", param: rest[1], optional: false };

  const dynamic = raw.match(DYNAMIC);
  if (dynamic) return { kind: "dynamic", param: dynamic[1] };

  return { kind: "static", value: raw };
}

/** The directory part of a path under `app/`, as segments. `[]` for the root. */
function dirSegments(path: string): string[] {
  const inside = path.replace(/^app\//, "").split("/");
  /* The last entry is the file name. */
  return inside.slice(0, -1);
}

/**
 * Whether this file is routable at all.
 *
 * A page inside a private folder is not a route, and neither is one the caller
 * put somewhere that is not `app/`.
 */
function routable(path: string): boolean {
  if (!/^app\/(?:.*\/)?page\.[jt]sx?$/.test(path)) return false;
  return dirSegments(path).every((segment) => !PRIVATE.test(segment));
}

/** The URL a page file answers on, with groups dropped and params kept. */
export function patternFor(path: string): string {
  const segments = dirSegments(path).filter((segment) => !GROUP.test(segment));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/**
 * The layouts wrapping a page, outermost first.
 *
 * Walked down the REAL directory path rather than the URL, because a route
 * group exists precisely so that `app/(marketing)/layout.tsx` can wrap
 * `/pricing` without appearing in its address. Dropping groups before looking
 * for layouts would lose exactly the layout the group was created for.
 */
export function layoutsFor(path: string, tree: FileTree): string[] {
  const has = new Set(tree.map((file) => file.path));
  const segments = dirSegments(path);
  const layouts: string[] = [];

  for (let depth = 0; depth <= segments.length; depth += 1) {
    const dir = ["app", ...segments.slice(0, depth)].join("/");
    for (const ext of ["tsx", "jsx", "ts", "js"]) {
      const candidate = `${dir}/layout.${ext}`;
      if (has.has(candidate)) {
        layouts.push(candidate);
        break;
      }
    }
  }

  return layouts;
}

/**
 * Every route in the project, shallowest first.
 *
 * Ordered so that the first entry is the one to show when the preview opens:
 * `/` when it exists, and otherwise the shallowest static page, which is the
 * closest thing a project without a home page has to one.
 */
export function routesOf(tree: FileTree): PreviewRoute[] {
  const routes = tree
    .map((file) => file.path)
    .filter(routable)
    .map((file) => {
      const segments = dirSegments(file)
        .filter((segment) => !GROUP.test(segment))
        .map(segmentOf)
        .filter((segment): segment is Segment => segment !== null);

      return {
        file,
        pattern: patternFor(file),
        segments,
        layouts: layoutsFor(file, tree),
        dynamic: segments.some((segment) => segment.kind !== "static"),
      };
    });

  return routes.sort((a, b) => {
    /* The home page first, whatever else exists. */
    if (a.pattern === "/") return -1;
    if (b.pattern === "/") return 1;
    /* Then static before dynamic: a preview that opens on `/blog/[slug]` has
       opened on a page that needs a parameter nobody has supplied. */
    if (a.dynamic !== b.dynamic) return a.dynamic ? 1 : -1;
    if (a.segments.length !== b.segments.length) return a.segments.length - b.segments.length;
    return a.pattern.localeCompare(b.pattern);
  });
}

/**
 * Which route answers an address, and what the dynamic segments were.
 *
 * Static segments beat dynamic ones at the same depth, and a catch-all is the
 * last resort — the same precedence Next.js applies, and for the same reason:
 * `/blog/new` should reach `app/blog/new/page.tsx` when that exists rather than
 * `app/blog/[slug]/page.tsx`, whichever order the files happen to be in.
 */
export function matchRoute(
  routes: readonly PreviewRoute[],
  pathname: string,
): { route: PreviewRoute; params: Record<string, string | string[]> } | null {
  const parts = pathname.split("/").filter(Boolean);

  let best: { route: PreviewRoute; params: Record<string, string | string[]>; score: number } | null =
    null;

  for (const route of routes) {
    const params: Record<string, string | string[]> = {};
    let score = 0;
    let index = 0;
    let ok = true;

    for (const segment of route.segments) {
      if (segment.kind === "static") {
        if (parts[index] !== segment.value) {
          ok = false;
          break;
        }
        /* A literal match is worth more than a parameter that would also have
           accepted it. */
        score += 3;
        index += 1;
        continue;
      }

      if (segment.kind === "dynamic") {
        if (index >= parts.length) {
          ok = false;
          break;
        }
        params[segment.param] = decodeURIComponent(parts[index]);
        score += 2;
        index += 1;
        continue;
      }

      /* Catch-all: everything that is left. */
      const rest = parts.slice(index).map((part) => decodeURIComponent(part));
      if (rest.length === 0 && !segment.optional) {
        ok = false;
        break;
      }
      params[segment.param] = rest;
      score += 1;
      index = parts.length;
    }

    if (!ok || index !== parts.length) continue;
    if (!best || score > best.score) best = { route, params, score };
  }

  return best ? { route: best.route, params: best.params } : null;
}

/**
 * The first address to show when the preview opens.
 *
 * A dynamic route is only ever chosen as a last resort, and when it is, its
 * parameters are filled with something legible rather than left empty: a
 * preview that opens on `/blog/undefined` looks broken in a way the project is
 * not.
 */
export function entryRoute(routes: readonly PreviewRoute[]): string {
  const first = routes[0];
  if (!first) return "/";

  return first.segments
    .map((segment) => {
      if (segment.kind === "static") return segment.value;
      return segment.param.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "item";
    })
    .reduce((path, segment) => `${path}/${segment}`, "") || "/";
}
