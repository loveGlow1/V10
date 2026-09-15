/* Whether a generated project is a Next.js project, before Vercel says it is not.
 *
 * `next build` is the strictest reader this code ever meets, and until now it
 * was the FIRST reader: a project went from the model straight to a deployment,
 * and the way a customer found out that a page module exported a component was
 * a hundred lines of build log with a type error in the middle of it. The
 * failure was minutes late, expensive, and phrased for somebody who knows what
 * a Next.js page type is.
 *
 * Every rule here is one `next build` enforces. Nothing is style, nothing is
 * preference, and nothing is this file having an opinion about how a project
 * should be laid out — each one is a build that fails, checked here, in
 * milliseconds, before anything is uploaded.
 *
 * ── The one that keeps happening ──────────────────────────────────────────
 *
 *     app/admin/page.tsx
 *     export function AdminNav() { ... }        // ← the build dies here
 *     export default function AdminPage() { ... }
 *
 * A page module may export a default and a short list of framework fields, and
 * nothing else. A model writing an admin screen puts the nav beside the page
 * that uses it, which is what anybody would do in any other framework, and
 * Next.js rejects the file:
 *
 *     Type error: Page "app/admin/page.tsx" does not match the required types
 *     of a Next.js Page. "AdminNav" is not a valid Page export field.
 *
 * It has exactly one correct fix — the component belongs in `components/` and
 * the page imports it — so, like the client-route split beside it, it is
 * repaired here rather than sent back to a model. See repairStructure.
 *
 * ── Blocking versus advisory ──────────────────────────────────────────────
 *
 * Blocking means `next build` fails and a deployment is wasted. Advisory means
 * it builds and something is likely wrong anyway. Only the first kind stops a
 * publish; the second is shown and moved past, because a validator that refuses
 * to ship a working project over a suspicion is the failure this codebase has
 * had twice — right in principle, wrong about the documents it actually meets.
 *
 * Pure: a tree in, findings out, no SDK and no network. See
 * tools/check-next-structure.mjs.
 */

import { blockAfter, statementAfter } from "./source-scan";
import type { FileTree, ProjectFile } from "./tree";

export type Severity = "blocking" | "advisory";

export type Finding = {
  severity: Severity;
  /** The file it is about. */
  file: string;
  /** What it is, in a sentence somebody who did not write Next.js can act on. */
  problem: string;
  /** The framework's own reason, for the technical panel behind the summary. */
  detail: string;
  /** Whether repairStructure can fix this without asking a model. */
  repairable: boolean;
};

/* ── What a page module is allowed to export ───────────────────────────────
 *
 * Next.js's own list. A page or layout exports its component as the default,
 * plus any of these framework fields, and a build fails on anything else. Kept
 * as data rather than as a regex because it is a list somebody will need to
 * extend when Next.js adds to it, and a list is a thing you can extend. */
const FRAMEWORK_EXPORTS = new Set([
  "metadata",
  "generateMetadata",
  "viewport",
  "generateViewport",
  "generateStaticParams",
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "experimental_ppr",
  "config",
]);

/** The verbs a route handler may answer on. */
const HTTP_VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/* The directive, however it was quoted, as the FIRST thing in the file. A
   "use client" further down is a string in somebody's code and Next.js does not
   treat it as a directive either. Same rule as client-routes.ts. */
const CLIENT = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']\s*;?/;

const PAGE = /^app\/(?:.*\/)?page\.tsx?$/;
const LAYOUT = /^app\/(?:.*\/)?layout\.tsx?$/;
const ROUTE = /^app\/(?:.*\/)?route\.tsx?$/;

function isClient(source: string): boolean {
  return CLIENT.test(source);
}

/* Comments and string bodies blanked, so a regex cannot match inside one.
 *
 * LENGTH-PRESERVING, and that is the whole reason this is a scanner rather than
 * a chain of replaces. The offsets this produces are used to cut a declaration
 * out of the ORIGINAL source, so a blanking pass that shortened the text — as
 * replacing `"next/link"` with `""` does — would hand the repair an index
 * pointing nine characters before the thing it meant to move. A file with an
 * import at the top of it would be cut in the wrong place, which is the same
 * class of damage as the truncation source-scan.ts exists to avoid.
 *
 * Newlines survive too, so a line number taken from this is a line number in
 * the file.
 */
function code(source: string): string {
  const out = source.split("");
  let quote: string | null = null;
  let line = false;
  let block = false;

  const blankAt = (i: number) => {
    if (out[i] !== "\n") out[i] = " ";
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (line) {
      if (ch === "\n") line = false;
      else blankAt(i);
      continue;
    }
    if (block) {
      if (ch === "*" && next === "/") {
        blankAt(i);
        blankAt(i + 1);
        block = false;
        i += 1;
      } else blankAt(i);
      continue;
    }
    if (quote) {
      if (ch === "\\") {
        blankAt(i);
        blankAt(i + 1);
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      blankAt(i);
      continue;
    }
    if (ch === "/" && next === "/") {
      blankAt(i);
      blankAt(i + 1);
      line = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      blankAt(i);
      blankAt(i + 1);
      block = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
  }

  return out.join("");
}

export type NamedExport = {
  name: string;
  /** Where the declaration starts in the ORIGINAL source. */
  at: number;
  kind: "function" | "const" | "class" | "list";
};

/**
 * The value exports of a module, with type-only exports left out.
 *
 * Types are erased before Next.js sees the file, so `export type Props = …` in
 * a page is not an invalid page export and must never be reported as one —
 * reporting it would send somebody chasing a build error that does not exist.
 */
export function namedExports(source: string): NamedExport[] {
  const text = code(source);
  const found: NamedExport[] = [];

  const declaration =
    /\bexport\s+(?!default\b|type\b|interface\b)(?:async\s+)?(function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of text.matchAll(declaration)) {
    const kind = match[1] === "class" ? "class" : match[1] === "function" ? "function" : "const";
    found.push({ name: match[2], at: match.index ?? 0, kind });
  }

  /* `export { Nav, Card }` and `export { Nav as Sidebar }`. The exported name
     is what Next.js checks, so it is the one after `as`. */
  const list = /\bexport\s*\{([^}]*)\}/g;
  for (const match of text.matchAll(list)) {
    for (const part of match[1].split(",")) {
      const clause = part.trim();
      if (clause.length === 0 || /^type\s/.test(clause)) continue;
      const name = clause.split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name) && name !== "default") {
        found.push({ name, at: match.index ?? 0, kind: "list" });
      }
    }
  }

  return found;
}

/** Whether the module exports a default at all. */
export function hasDefaultExport(source: string): boolean {
  return /\bexport\s+default\b/.test(code(source));
}

/* A component, as opposed to a constant that happens to be exported. The
   capital is the whole signal and it is a reliable one in generated React:
   `AdminNav` is a component and `NAV_LINKS` is not. */
function looksLikeComponent(entry: NamedExport): boolean {
  return /^[A-Z]/.test(entry.name) && entry.kind !== "list" && !/^[A-Z0-9_]+$/.test(entry.name);
}

/* Hooks and handlers, which only run in a client component. Matched on the
   blanked source so a hook named in a comment or a string is not a finding. */
const HOOKS = /\b(useState|useEffect|useLayoutEffect|useReducer|useRef|useContext|useCallback|useMemo|useSyncExternalStore|useTransition|useOptimistic|useFormState)\s*\(/;
const HANDLERS = /\son(?:Click|Change|Submit|Input|Focus|Blur|KeyDown|KeyUp|MouseEnter|MouseLeave)\s*=\s*\{/;
const BROWSER = /\b(?:window|document|localStorage|sessionStorage|navigator)\s*\./;

function describe(path: string): string {
  return path.replace(/^app\//, "").replace(/\/(page|layout|route)\.tsx?$/, "") || "the home page";
}

/**
 * Everything wrong with this project that `next build` would refuse.
 *
 * Ordered blocking first, because that is the order somebody fixes them in and
 * the order the publish flow reports them in.
 */
/**
 * Whether these files are a Next.js project at all.
 *
 * NOTHING IN THIS FILE APPLIES TO ANYTHING ELSE, and that has to be true by
 * construction rather than by where the callers happen to be. The single-page
 * stack stores one file — `index.html` — and it is most of what this platform
 * builds: a landing page, a restaurant site, a portfolio. None of the rules
 * here mean anything about such a page, and the one that would fire is the
 * worst of them, because `index.html` is not `app/page.tsx` and the absence of
 * a Next.js page reads as "this project has no pages — there is nothing for a
 * visitor to open". That is a BLOCKING finding, so a validator asked the wrong
 * question would refuse to publish a landing page that is completely fine.
 *
 * It does not fire today, because the deploy route returns early on a tree with
 * no files in it. That is an ordering accident in one caller, not a property of
 * this module, and this branch has already been bitten twice by a defect living
 * in the seam between two layers that were each individually correct. So the
 * question is asked here, once, where the answer cannot be forgotten by the
 * next caller.
 *
 * Deliberately generous about what counts as Next.js: anything under `app/`, or
 * a next.config, or a package.json that depends on it. A half-written scaffold
 * IS a Next.js project and its missing page is a real finding — that case is
 * the reason the "no pages" rule exists, and it must survive this guard.
 */
export function isNextProject(tree: FileTree): boolean {
  for (const file of tree) {
    if (/^app\//.test(file.path)) return true;
    if (/^next\.config\./.test(file.path)) return true;
    if (file.path === "package.json" && /"next"\s*:/.test(file.content)) return true;
  }
  return false;
}

export function inspectStructure(tree: FileTree): Finding[] {
  /* Not a Next.js project: none of this is about it. See isNextProject. */
  if (!isNextProject(tree)) return [];

  const findings: Finding[] = [];
  const paths = new Set(tree.map((file) => file.path));

  const pages = tree.filter((file) => PAGE.test(file.path));
  const layouts = tree.filter((file) => LAYOUT.test(file.path));
  const routes = tree.filter((file) => ROUTE.test(file.path));

  /* A Next.js project with no page has no pages. It compiles to nothing and
     deploys to a 404 on every address. */
  if (pages.length === 0) {
    findings.push({
      severity: "blocking",
      file: "app/page.tsx",
      problem: "This project has no pages — there is nothing for a visitor to open.",
      detail: "No file matching app/**/page.tsx exists. The App Router builds routes from those files.",
      repairable: false,
    });
  }

  for (const file of [...pages, ...layouts]) {
    const source = file.content;
    const kind = PAGE.test(file.path) ? "page" : "layout";
    const client = isClient(source);

    if (!hasDefaultExport(source)) {
      findings.push({
        severity: "blocking",
        file: file.path,
        problem: `The ${kind} for ${describe(file.path)} never says what to render.`,
        detail: `${file.path} has no default export. A ${kind} must export its component as the default.`,
        repairable: false,
      });
    }

    for (const entry of namedExports(source)) {
      if (FRAMEWORK_EXPORTS.has(entry.name)) continue;

      const component = looksLikeComponent(entry);
      findings.push({
        severity: "blocking",
        file: file.path,
        problem: component
          ? `${entry.name} is a component living inside the ${kind} for ${describe(file.path)}. It belongs in its own file.`
          : `The ${kind} for ${describe(file.path)} exports ${entry.name}, which a ${kind} is not allowed to export.`,
        detail: `Type error: ${file.path} does not match the required types of a Next.js ${kind === "page" ? "Page" : "Layout"}. "${entry.name}" is not a valid ${kind === "page" ? "Page" : "Layout"} export field.`,
        /* Only the component case has one obviously correct fix. Moving an
           exported constant would change what other files import it from, and
           a repair that rewrites somebody's imports to guess at intent is the
           kind of clever this codebase keeps deciding against. */
        repairable: component,
      });
    }

    /* Two directives that cannot both be true of one file. */
    if (client && /\bexport\s+(?:const|async\s+function|function)\s+(?:metadata|generateMetadata)\b/.test(code(source))) {
      findings.push({
        severity: "blocking",
        file: file.path,
        problem: `The ${kind} for ${describe(file.path)} is interactive and also sets the page title. Those cannot be in the same file.`,
        detail: `You are attempting to export "metadata" from a component marked with "use client", which is disallowed.`,
        repairable: false,
      });
    }

    if (client && /\bexport\s+(?:async\s+)?function\s+generateStaticParams\b/.test(code(source))) {
      findings.push({
        severity: "blocking",
        file: file.path,
        problem: `The ${kind} for ${describe(file.path)} is both interactive and statically routed, which Next.js does not allow in one file.`,
        detail: `Page "${file.path}" cannot use both "use client" and export function "generateStaticParams()".`,
        /* client-routes.ts performs exactly this split, and runs before this. */
        repairable: true,
      });
    }

    /* Interactivity without the directive. The build error is real and its
       wording is famously unhelpful, so it is worth catching by name. */
    if (!client) {
      const body = code(source);
      if (HOOKS.test(body)) {
        findings.push({
          severity: "blocking",
          file: file.path,
          problem: `The ${kind} for ${describe(file.path)} is interactive but is not marked as a client component.`,
          detail: `${file.path} uses React hooks without the "use client" directive. Hooks only run in client components.`,
          repairable: true,
        });
      } else if (HANDLERS.test(body)) {
        findings.push({
          severity: "blocking",
          file: file.path,
          problem: `The ${kind} for ${describe(file.path)} has buttons that do something, but is not marked as a client component.`,
          detail: `${file.path} passes an event handler without the "use client" directive. Event handlers cannot be passed to server components.`,
          repairable: true,
        });
      } else if (BROWSER.test(body)) {
        findings.push({
          severity: "advisory",
          file: file.path,
          problem: `The ${kind} for ${describe(file.path)} reads the browser directly, which is empty while the page is being built.`,
          detail: `${file.path} touches window/document outside a client component. This builds, and is undefined during prerendering.`,
          repairable: false,
        });
      }
    }
  }

  /* The root layout, which is the one layout Next.js requires to exist and
     requires to be shaped a particular way. */
  const root = tree.find((file) => /^app\/layout\.tsx?$/.test(file.path));
  if (pages.length > 0 && !root) {
    findings.push({
      severity: "blocking",
      file: "app/layout.tsx",
      problem: "This project has no root layout, so there is no page shell to render into.",
      detail: "app/layout.tsx is required by the App Router and must render <html> and <body>.",
      repairable: false,
    });
  } else if (root && !(/<html/.test(root.content) && /<body/.test(root.content))) {
    findings.push({
      severity: "blocking",
      file: root.path,
      problem: "The page shell is missing its <html> or <body>, so nothing will render inside it.",
      detail: "The root layout must render both an <html> and a <body> tag.",
      repairable: false,
    });
  }

  /* Route handlers. Rare in a static export and wrong in a particular way when
     they appear: a default export where verbs were wanted. */
  for (const file of routes) {
    const body = code(file.content);
    const verbs = HTTP_VERBS.filter((verb) =>
      new RegExp(`\\bexport\\s+(?:async\\s+)?(?:function\\s+${verb}\\b|const\\s+${verb}\\b)`).test(body),
    );
    if (verbs.length === 0) {
      findings.push({
        severity: "blocking",
        file: file.path,
        problem: `${file.path} answers no requests — a route file has to say which methods it handles.`,
        detail: `Route handlers must export at least one of ${HTTP_VERBS.join(", ")}.`,
        repairable: false,
      });
    }
    if (hasDefaultExport(file.content)) {
      findings.push({
        severity: "blocking",
        file: file.path,
        problem: `${file.path} is written as if it were a page, but it sits where a route handler goes.`,
        detail: "A route.ts may not have a default export. Export the HTTP methods it answers instead.",
        repairable: false,
      });
    }

    const folder = file.path.replace(/route\.tsx?$/, "");
    if (paths.has(`${folder}page.tsx`) || paths.has(`${folder}page.ts`)) {
      findings.push({
        severity: "blocking",
        file: file.path,
        problem: `Two different things both claim the address ${describe(file.path)}.`,
        detail: `A page and a route handler cannot both exist in ${folder}.`,
        repairable: false,
      });
    }
  }

  return findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "blocking" ? -1 : 1;
    return a.file.localeCompare(b.file);
  });
}

/** Whether anything here would fail a build. */
export function blocking(findings: readonly Finding[]): Finding[] {
  return findings.filter((finding) => finding.severity === "blocking");
}

/* ── Repair ────────────────────────────────────────────────────────────────
 *
 * Only the defects with exactly one correct fix, the same bar client-routes.ts
 * sets. Everything else is reported and left alone.
 */

/** The import statements at the top of a module, as whole lines. */
function importsOf(source: string): string[] {
  return source.match(/^\s*import\s[^\n]*?(?:from\s*["'][^"']+["'])?\s*;?\s*$/gm) ?? [];
}

/** The names an import statement binds. */
function bindings(statement: string): string[] {
  const names: string[] = [];
  const body = statement.replace(/^\s*import\s+type\s+/, "import ").trim().slice("import".length);
  const from = body.search(/\bfrom\b/);
  const clause = from === -1 ? body : body.slice(0, from);

  const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespace) names.push(namespace[1]);

  const named = clause.match(/\{([\s\S]*?)\}/);
  if (named) {
    for (const part of named[1].split(",")) {
      const binding = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (binding) names.push(binding);
    }
  }

  const fallback = clause.replace(/\{[\s\S]*?\}/, "").replace(/\*\s+as\s+[\w$]+/, "");
  for (const part of fallback.split(",")) {
    const binding = part.trim().replace(/["';]/g, "");
    if (/^[A-Za-z_$][\w$]*$/.test(binding)) names.push(binding);
  }

  return names;
}

/** A path under components/ that nothing else has taken. */
function freePath(name: string, folder: string, taken: Set<string>): { path: string; name: string } {
  const base = folder ? `components/${folder}` : "components";
  let candidate = `${base}/${name}.tsx`;
  let chosen = name;
  let n = 2;
  while (taken.has(candidate)) {
    chosen = `${name}${n}`;
    candidate = `${base}/${chosen}.tsx`;
    n += 1;
  }
  return { path: candidate, name: chosen };
}

export type Repair = {
  /** What was done, for the step list. */
  what: string;
  file: string;
};

/**
 * The tree with the mechanically-fixable defects fixed.
 *
 * Today that is the one in the header: a component exported from a page or
 * layout module, moved into `components/` and imported back. The imports it
 * uses are COPIED rather than moved, for the reason client-routes.ts gives
 * about the same problem — the file it came from usually still needs them, and
 * a repair that removes an import somebody else was using has turned one build
 * error into two.
 *
 * Idempotent, and conservative to a fault: anything it cannot read cleanly is
 * left exactly as it was, so running it twice is safe and running it on a tree
 * it does not understand changes nothing.
 */
export function repairStructure(tree: FileTree): { tree: FileTree; repairs: Repair[] } {
  /* Same guard, and it matters more here: this one REWRITES somebody's files.
     A single page is returned by identity, untouched. See isNextProject. */
  if (!isNextProject(tree)) return { tree, repairs: [] };

  const repairs: Repair[] = [];
  const byPath = new Map(tree.map((file) => [file.path, { ...file }]));
  const taken = new Set(byPath.keys());

  for (const file of tree) {
    if (!PAGE.test(file.path) && !LAYOUT.test(file.path)) continue;

    let source = byPath.get(file.path)?.content ?? file.content;
    /* The folder the page sits in, so an admin component lands in
       components/admin rather than in one flat pile. */
    const folder = file.path
      .replace(/^app\//, "")
      .replace(/\/?(page|layout)\.tsx?$/, "")
      .replace(/\([^)]*\)\/?/g, "")
      .replace(/\[[^\]]*\]\/?/g, "")
      .replace(/\/+$/, "");

    /* Re-read each time: every move rewrites the source, so the offsets from a
       single pass would be stale after the first one. */
    for (;;) {
      const offenders = namedExports(source).filter(
        (entry) => !FRAMEWORK_EXPORTS.has(entry.name) && looksLikeComponent(entry),
      );
      if (offenders.length === 0) break;

      const entry = offenders[0];
      /* `at` is the index of the `export` keyword itself, and it is an index
         into the real source because code() preserves length. */
      const start = entry.at;
      if (start < 0 || !source.startsWith("export", start)) break;

      const end = entry.kind === "function" || entry.kind === "class"
        ? blockAfter(source, start)
        : statementAfter(source, start);
      if (end <= start) break;

      const declaration = source.slice(start, end);
      /* A sanity check before anything is rewritten: the slice has to actually
         be the thing we were looking at. */
      if (!declaration.includes(entry.name)) break;

      const { path, name } = freePath(entry.name, folder, taken);
      taken.add(path);

      const used = importsOf(source).filter((statement) =>
        bindings(statement).some((binding) => new RegExp(`\\b${binding}\\b`).test(declaration)),
      );

      /* `export function Nav` becomes `export default function Nav` in the file
         it now owns, which is what the page will import. */
      const moved = declaration.replace(/^export\s+/, "export default ");
      const body = `${used.join("\n")}${used.length > 0 ? "\n\n" : ""}${moved.trim()}\n`;

      byPath.set(path, { path, content: body });

      const importLine = `import ${name} from "@/${path.replace(/\.tsx$/, "")}";`;
      const withoutDeclaration = (source.slice(0, start) + source.slice(end)).replace(/\n{3,}/g, "\n\n");

      /* The import goes after the last existing one, or after the directive
         when there is one, so "use client" stays the first thing in the file. */
      const existing = importsOf(withoutDeclaration);
      let next: string;
      if (existing.length > 0) {
        const last = withoutDeclaration.lastIndexOf(existing[existing.length - 1]);
        const cut = last + existing[existing.length - 1].length;
        next = `${withoutDeclaration.slice(0, cut)}\n${importLine}${withoutDeclaration.slice(cut)}`;
      } else {
        const directive = withoutDeclaration.match(CLIENT);
        const cut = directive ? directive[0].length : 0;
        next = `${withoutDeclaration.slice(0, cut)}\n${importLine}\n${withoutDeclaration.slice(cut)}`;
      }

      /* The name may have had to change to avoid a collision. */
      source = name === entry.name
        ? next
        : next.replace(new RegExp(`<${entry.name}\\b`, "g"), `<${name}`)
             .replace(new RegExp(`</${entry.name}>`, "g"), `</${name}>`);

      repairs.push({
        what: `${entry.name} moved out of ${file.path} into ${path}`,
        file: path,
      });
    }

    const held = byPath.get(file.path);
    if (held) held.content = source;
  }

  if (repairs.length === 0) return { tree, repairs };

  const out: FileTree = [];
  for (const file of tree) out.push(byPath.get(file.path) as ProjectFile);
  for (const [path, file] of byPath) {
    if (!tree.some((entry) => entry.path === path)) out.push(file);
  }

  return { tree: out, repairs };
}
