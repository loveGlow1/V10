/* Pages that are interactive AND statically routed.
 *
 * Next.js forbids one file from being both:
 *
 *     [Error: Page "/[section]/page" cannot use both "use client"
 *      and export function "generateStaticParams()".]
 *
 * and a generated project walks into it every single time it has a dynamic
 * route. Not occasionally — structurally. `output: "export"` REQUIRES
 * generateStaticParams on a dynamic route or the build fails for the opposite
 * reason ("missing generateStaticParams"), and a page that lists stories a
 * person can search and filter is interactive, so the model marks it
 * "use client". Both decisions are correct. Together they do not compile.
 *
 * It is not a model that misunderstood its brief. Asked for a newsroom with
 * /[section] and /article/[slug], it produced twenty-seven files of which
 * twenty-five were fine and two were this, and no amount of asking more
 * nicely changes a rule of the framework. So it is repaired here, the way the
 * viewport meta tag and `width: 1200px` are repaired in the page pipeline: a
 * defect with exactly one correct fix is not worth a model call.
 *
 * THE ONE CORRECT FIX is the split Next.js documents. The route file becomes a
 * server component holding generateStaticParams, and everything that made it
 * interactive moves to a client component beside it, which the route renders.
 * Nothing about the page changes for whoever opens it.
 *
 * Idempotent: a tree that has already been split has no file with both
 * markers, so running this again finds nothing to do.
 */

import type { FileTree, ProjectFile } from "./tree";

/* The directive, however it was quoted, as the FIRST thing in the file. A
   "use client" further down is a string in somebody's code, not a directive,
   and Next.js does not treat it as one either. */
const DIRECTIVE = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']\s*;?[^\S\n]*\n?/;

/** Whether this file is the thing that will not compile. */
function conflicted(file: ProjectFile): boolean {
  return (
    /\.tsx?$/.test(file.path) &&
    DIRECTIVE.test(file.content) &&
    /export\s+(?:async\s+)?function\s+generateStaticParams\b/.test(file.content)
  );
}

/* ── Reading one function out of a file without parsing the file ───────────
 *
 * Brace counting, with enough of a scanner to not be fooled by the things
 * generated React is full of: a `{` inside a string, a regex, a comment, or a
 * template literal. It does not need to understand the code — only to find
 * where this one function ends.
 */
function blockAfter(source: string, from: number): number {
  const open = source.indexOf("{", from);
  if (open === -1) return -1;

  let depth = 0;
  let quote: string | null = null;
  let line = false;
  let block = false;

  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (line) {
      if (ch === "\n") line = false;
      continue;
    }
    if (block) {
      if (ch === "*" && next === "/") { block = false; i += 1; }
      continue;
    }
    if (quote) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { line = true; i += 1; continue; }
    if (ch === "/" && next === "*") { block = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }

    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }

  return -1;
}

/** The generateStaticParams declaration, and the text without it. */
function liftStaticParams(source: string): { block: string; rest: string } | null {
  const match = source.match(/export\s+(?:async\s+)?function\s+generateStaticParams\b/);
  if (!match || match.index === undefined) return null;

  const end = blockAfter(source, match.index);
  if (end === -1) return null;

  return {
    block: source.slice(match.index, end),
    rest: (source.slice(0, match.index) + source.slice(end)).replace(/\n{3,}/g, "\n\n"),
  };
}

/* The imports the lifted function actually uses, copied rather than moved:
   the client half still needs all of them, and generateStaticParams usually
   needs one or two (the newsroom's reads `BEATS` from a components module).
 *
 * Filtered rather than copied wholesale, and the difference matters. Copying
 * every line would put `useState` and `useEffect` in a server component —
 * legal, since importing a hook is not calling one, but it reads like a
 * mistake and invites somebody to "fix" it by adding back the directive that
 * caused all this. What is left is the short, obvious list. */
function bindings(statement: string): string[] {
  const names: string[] = [];
  const body = statement.replace(/^import\s+type\s+/, "import ").slice("import".length);
  const from = body.search(/\bfrom\b/);
  const clause = from === -1 ? "" : body.slice(0, from);

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
    const binding = part.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(binding)) names.push(binding);
  }

  return names;
}

function importsFor(source: string, used: string): string {
  const statements = source.match(/^import\s[\s\S]*?(?:;|\n)$/gm) ?? [];
  return statements
    .filter((statement) => {
      const names = bindings(statement);
      /* A side-effect import brings no name with it, so nothing in the lifted
         function can depend on it. It belongs to the client half. */
      return names.length > 0 && names.some((name) =>
        new RegExp(`\\b${name.replace(/[$]/g, "\\$&")}\\b`).test(used),
      );
    })
    .join("\n");
}

/* ── What the route's params are called ────────────────────────────────────
 *
 * Read from the PATH, which is where Next.js reads them from too:
 * app/article/[slug]/page.tsx has one param named slug. A catch-all collects
 * an array, and an optional catch-all may collect nothing.
 */
function paramsType(path: string): string | null {
  const fields = path
    .split("/")
    /* `[slug]`, `[...slug]` and `[[...slug]]`, and the three have to be told
       apart in one pass. An earlier version ate the dots with `\.{0,3}` before
       the capture group could see them, so every catch-all typed as a plain
       string — which the check tool caught and a build would not have, since a
       wrong type still compiles until somebody indexes it. */
    .map((segment) => segment.match(/^\[(\[)?(\.\.\.)?([^[\].]+)\](\])?$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(([, optional, spread, name]) =>
      spread ? `${name}${optional ? "?" : ""}: string[]` : `${name}: string`,
    );

  return fields.length > 0 ? `{ ${fields.join("; ")} }` : null;
}

/** A name for the client half that nothing in the tree is already using. */
function clientPath(path: string, taken: Set<string>): string {
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  for (const name of ["PageClient", "RouteClient", "PageClientView"]) {
    const candidate = `${dir}${name}.tsx`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${dir}PageClient.${taken.size}.tsx`;
}

/**
 * The tree with every "use client" + generateStaticParams page split in two.
 *
 * A page with the conflict but NO dynamic segment in its path is a different
 * case and gets a different answer: generateStaticParams does nothing on a
 * static route, so it is dropped and the page stays one client component.
 * Splitting it would be ceremony around a function with no reason to exist.
 */
export function splitClientRoutes(tree: FileTree): FileTree {
  if (!tree.some(conflicted)) return tree;

  const taken = new Set(tree.map((file) => file.path.toLowerCase()));
  const out: FileTree = [];

  for (const file of tree) {
    if (!conflicted(file)) {
      out.push(file);
      continue;
    }

    const lifted = liftStaticParams(file.content);
    if (!lifted) {
      /* The marker is there but the function could not be read — an unbalanced
         brace, or a shape this does not understand. Left exactly as it is:
         a build that fails with the framework's own error message is better
         than one that fails inside a file this rewrote by guessing. */
      out.push(file);
      continue;
    }

    const shape = paramsType(file.path);
    if (!shape) {
      out.push({ path: file.path, content: lifted.rest.trimStart() });
      continue;
    }

    const client = clientPath(file.path, taken);
    taken.add(client.toLowerCase());
    const component = client.slice(client.lastIndexOf("/") + 1, -".tsx".length);

    /* The client half keeps the directive, the imports, the hooks and the
       markup — everything that made it a client component in the first
       place. Only generateStaticParams leaves. */
    out.push({ path: client, content: lifted.rest.trimStart() });

    /* `await params` rather than passing the promise down, because params is
       a Promise in Next 15 and the component below it reads `params.slug`
       synchronously. Awaiting here is what makes that true again. */
    out.push({
      path: file.path,
      content:
        `${importsFor(lifted.rest, lifted.block)}\n` +
        `import ${component} from "./${component}";\n\n` +
        `${lifted.block.trim()}\n\n` +
        `export default async function Page({ params }: { params: Promise<${shape}> }) {\n` +
        `  return <${component} params={await params} />;\n` +
        `}\n`,
    });
  }

  return out;
}
