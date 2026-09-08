/* What is in this project, in a form something can search.
 *
 * Retrieval needs an index, and the builder had none. It had a file tree, which
 * is a list of paths and their entire contents — you can send all of it or
 * guess at one file, and both of those are what the app actually did. There was
 * no way to ask "which files does the checkout button touch", because nothing
 * had ever written down what a file contains.
 *
 * So a build indexes what it made: one small row per file, route, component,
 * table and design token, each carrying the identifiers it defines and reaches.
 * That is enough for two things the guide asks for and neither of which needs a
 * model or an embedding — scoring entries against a request (§11, §12), and
 * following a dependency from one entry to the next (§25, expand.ts).
 *
 * DETERMINISTIC. Regex over source, arithmetic over terms. An embedding index
 * would score better on "make it feel calmer" and would cost an API call per
 * file per build, and be wrong in ways nobody can debug. This is wrong in ways
 * anybody can read, and it is exact on the thing that matters most here —
 * names. People edit software by naming the thing they mean. */

import { estimateTokens } from "./budget";

export type IndexKind = "file" | "route" | "component" | "table" | "api" | "token" | "section";

export type IndexEntry = {
  kind: IndexKind;
  /** A component name, a route path, a table name, a token name. */
  name: string;
  /** Where it lives. Absent for a design token, which lives everywhere. */
  path?: string;
  /** What this entry defines and what it reaches. The edges of the graph. */
  symbols: string[];
  summary?: string;
  /** Roughly what sending this entry's source would cost. */
  tokens: number;
};

/* ── Reading a file ────────────────────────────────────────────────────────
 *
 * Everything below is a pattern over source text. None of it parses: pages and
 * components here are written by models and hand-edited by people, and a strict
 * reading fails on files that work perfectly. Each pattern is a signal, and a
 * missed one costs a slightly worse retrieval rather than an error. */

const IMPORT = /import\s+(?:[\w*\s{},]+\s+from\s+)?["']([^"']+)["']/g;
const EXPORTED = /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/g;
const JSX_USE = /<([A-Z][\w.]*)/g;
const TABLE_USE = /\.from\(\s*["']([a-z_][\w]*)["']\s*\)/g;

function uniq(values: string[], limit = 60): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function matches(source: string, pattern: RegExp, group = 1): string[] {
  const found: string[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    found.push(match[group]);
  }
  return found;
}

/** The route a Next.js page file answers on, or null when it is not one. */
export function routeOf(path: string): string | null {
  if (!/^app\/.*page\.tsx$/.test(path)) return null;
  const route = path
    .replace(/^app/, "")
    .replace(/\/page\.tsx$/, "")
    /* Route groups organise the source and are not in the URL. */
    .replace(/\/\([^)]*\)/g, "");
  return route === "" ? "/" : route;
}

/**
 * The index for one project, from its files.
 *
 * A file becomes one `file` entry, plus a `route` entry when it answers on one,
 * plus a `component` entry for each thing it exports that looks like a
 * component. Tables reached through the Supabase client become `table` entries,
 * because "which files touch the orders table" is a question edits ask
 * constantly and nothing could answer.
 */
export function indexTree(files: { path: string; content: string }[]): IndexEntry[] {
  const entries: IndexEntry[] = [];
  const tables = new Map<string, string[]>();

  for (const file of files) {
    const imports = matches(file.content, IMPORT);
    const exported = matches(file.content, EXPORTED);
    const used = matches(file.content, JSX_USE);
    const touched = matches(file.content, TABLE_USE);

    for (const table of touched) {
      tables.set(table, [...(tables.get(table) ?? []), file.path]);
    }

    entries.push({
      kind: "file",
      name: file.path.split("/").pop() ?? file.path,
      path: file.path,
      /* Imports first: they are what a dependency walk follows, and resolving
         them against other entries is how one file leads to another. */
      symbols: uniq([...imports, ...exported, ...used, ...touched]),
      summary: describeFile(file.path, exported, used),
      tokens: estimateTokens(file.content),
    });

    const route = routeOf(file.path);
    if (route) {
      entries.push({
        kind: "route",
        name: route,
        path: file.path,
        symbols: uniq([...exported, ...used]),
        summary: `The page served at ${route}`,
        tokens: estimateTokens(file.content),
      });
    }

    for (const symbol of exported) {
      if (!/^[A-Z]/.test(symbol)) continue;
      entries.push({
        kind: "component",
        name: symbol,
        path: file.path,
        symbols: uniq(used),
        summary: `${symbol}, defined in ${file.path}`,
        /* A component costs its file to send: it is not stored separately. */
        tokens: estimateTokens(file.content),
      });
    }
  }

  for (const [table, paths] of tables) {
    entries.push({
      kind: "table",
      name: table,
      symbols: uniq(paths),
      summary: `The ${table} table, read or written by ${paths.length} file${paths.length === 1 ? "" : "s"}`,
      tokens: 0,
    });
  }

  return entries;
}

function describeFile(path: string, exported: string[], used: string[]): string {
  const what = exported.length > 0 ? `defines ${exported.slice(0, 4).join(", ")}` : "no exports";
  const with_ = used.length > 0 ? `, uses ${uniq(used, 4).join(", ")}` : "";
  return `${path} — ${what}${with_}`;
}

/* ── Indexing a single page ────────────────────────────────────────────────
 *
 * The other stack. A standalone page has no files, but it has sections, ids and
 * a palette, and "the pricing section" is exactly how somebody names the thing
 * they want changed. */
export function indexPage(html: string): IndexEntry[] {
  const entries: IndexEntry[] = [];

  const ids = matches(html, /\sid=["']([^"']+)["']/g);
  const headings = matches(html, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)
    .map((heading) => heading.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const id of uniq(ids, 40)) {
    entries.push({
      kind: "section",
      name: id,
      symbols: [id],
      summary: `The #${id} section of the page`,
      tokens: 0,
    });
  }

  for (const heading of uniq(headings, 40)) {
    entries.push({
      kind: "section",
      name: heading,
      symbols: [],
      summary: `The section headed "${heading}"`,
      tokens: 0,
    });
  }

  for (const color of uniq(matches(html, /(#[0-9a-fA-F]{3,8})\b/g), 12)) {
    entries.push({ kind: "token", name: color, symbols: [], summary: `The colour ${color}`, tokens: 0 });
  }

  return entries;
}

/* ── Finding the relevant ones ─────────────────────────────────────────────
 *
 * Term overlap, with names weighted far above prose. "Change the checkout
 * button" must find CheckoutButton before it finds the file that merely
 * mentions checkout in a comment, and an exact name match must win outright —
 * that is what makes retrieval feel like it understood rather than guessed. */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "to", "for", "of", "in", "on", "at", "it", "its", "this",
  "that", "with", "make", "change", "add", "remove", "please", "can", "you", "my", "our", "is",
  "are", "be", "should", "would", "like", "want", "need", "up", "down", "more", "less", "some",
]);

/** The words worth matching on, lowercased, in the order they were written. */
export function termsOf(text: string): string[] {
  /* Split on the case boundary BEFORE lowercasing, because that boundary is the
     only thing that says where the words in "CheckoutButton" are. Doing it
     after — which the first version of this did — leaves one token nobody
     searches for: a person asking about "the checkout button" then matched the
     route, whose name happens to contain the word, ahead of the component that
     IS the button. */
  const separated = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

  const words = [
    ...(text.toLowerCase().match(/[a-z0-9_./-]{2,}/g) ?? []),
    ...(separated.toLowerCase().match(/[a-z0-9_./-]{2,}/g) ?? []),
  ].filter((word) => !STOPWORDS.has(word));

  /* And the punctuation boundaries too, so "checkout-button", "checkout_button"
     and "checkout/button" all reach the same terms. */
  const split = words.flatMap((word) => word.split(/[-_./]+/)).filter((part) => part.length >= 2);

  return [...new Set([...words, ...split])].filter((word) => !STOPWORDS.has(word));
}

/** How well one entry answers one request. Zero means "no reason to send it". */
export function scoreEntry(entry: IndexEntry, terms: string[]): number {
  if (terms.length === 0) return 0;

  const name = entry.name.toLowerCase();
  const nameTerms = new Set(termsOf(entry.name));
  const pathTerms = new Set(termsOf(entry.path ?? ""));
  const symbolTerms = new Set(entry.symbols.flatMap((symbol) => termsOf(symbol)));
  const summaryTerms = new Set(termsOf(entry.summary ?? ""));

  let score = 0;

  for (const term of terms) {
    /* The whole name, said outright. Nothing else comes close to this as a
       signal of intent. */
    if (name === term) score += 12;
    else if (name.includes(term) && term.length >= 4) score += 5;

    if (nameTerms.has(term)) score += 4;
    if (pathTerms.has(term)) score += 2;
    if (symbolTerms.has(term)) score += 1.5;
    if (summaryTerms.has(term)) score += 0.5;
  }

  /* A route or a component is a thing somebody edits; a design token is
     context around it. Small weights — enough to break a tie, never enough to
     put an unrelated component above a named file. */
  const weight: Record<IndexKind, number> = {
    route: 1.15,
    component: 1.15,
    file: 1,
    section: 1,
    table: 1,
    api: 1,
    token: 0.8,
  };

  return score * weight[entry.kind];
}

export type Retrieved = { entry: IndexEntry; score: number };

/**
 * The entries worth sending for this request, best first.
 *
 * Returns nothing rather than everything when nothing matches, and that is
 * deliberate: an empty retrieval means the caller falls back to what it did
 * before, while a list of irrelevant files means the model is handed noise and
 * told it is relevant.
 */
export function retrieve(entries: IndexEntry[], request: string, limit = 8): Retrieved[] {
  const terms = termsOf(request);
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit);
}
