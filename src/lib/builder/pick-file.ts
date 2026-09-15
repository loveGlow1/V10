/* Which file an instruction is about.
 *
 * The edit pipeline has always had exactly one answer to this, because there
 * has always been exactly one file. "Make the header darker" meant the page,
 * because the page was the project. On a file tree it means app/layout.tsx, or
 * components/Nav.tsx, or app/globals.css depending on where the header actually
 * lives — and getting it wrong is not a near miss. Editing the wrong file
 * produces search blocks that match nothing, which the pipeline reports as "I
 * couldn't place that change in the page": a sentence about the person's words
 * describing a fault in our routing.
 *
 * SO IT IS DECIDED BEFORE ANY OF THAT, and decided cheaply. The listing is a
 * few hundred characters — see describeTree — against a project that might be
 * forty files and a hundred thousand tokens. Sending all of it to find out
 * which fifth of it matters would cost more than the edit.
 *
 * The order below is deliberate: everything that can be settled from the words
 * is settled from the words, and the model is asked only about what is left.
 * Most edits name their file without meaning to.
 */

import type { FileTree } from "./tree";

/** Where a file was chosen, which is worth reporting when one is chosen wrong. */
export type FilePick = {
  path: string;
  why: "named" | "only-one" | "convention" | "model";
};

/* What somebody means when they say a part of a page, and where that part
 * lives in a Next.js project.
 *
 * This is a routing table, not an understanding of English. Each entry earns
 * its place by being a thing people say constantly and a place the thing
 * reliably is: a nav is in the layout because the layout is what wraps every
 * page, a colour is in globals.css because that is where the design system is
 * written. Where a project puts something somewhere else, the model decides —
 * this only skips asking when the answer is not in doubt. */
const CONVENTIONS: { says: RegExp; prefer: RegExp[] }[] = [
  /* The shell — present on every page, so it lives in the thing that wraps
     every page rather than in any one of them.
   *
     Split by which part was named rather than written as one rule for all of
     them, and that is not tidiness. The first version matched footer, nav,
     header and logo together and then preferred the SHORTEST matching
     component path — so "the footer needs the year updating" chose
     components/Nav.tsx, because Nav is shorter than Footer. A rule that knows
     a message is about the shell but not which part of it will pick the wrong
     file roughly half the time, and confidently. */
  {
    says: /\bfooters?\b/i,
    prefer: [/^components\/.*footer/i, /^app\/layout\.tsx$/],
  },
  {
    says: /\b(nav|navbar|navigation|menu|header|logo|top ?bar|site ?wide)\b/i,
    prefer: [/^components\/.*(nav|header|menu|logo)/i, /^app\/layout\.tsx$/],
  },
  {
    /* The design system. "Make it darker", "change the accent", "more spacing"
       are about the tokens, not about any one page's markup. */
    says: /\b(colou?rs?|palette|theme|font|typography|spacing|dark mode|css|styles?)\b/i,
    prefer: [/^app\/globals\.css$/, /^tailwind\.config\.[tj]s$/],
  },
  {
    /* The home page, which is what "the page" means when nobody says which. */
    says: /\b(home ?page|landing|hero|above the fold|first screen)\b/i,
    prefer: [/^app\/page\.tsx$/],
  },
  {
    says: /\b(pricing|plans?|tiers?)\b/i,
    prefer: [/^app\/pricing\/page\.tsx$/, /^components\/.*pricing/i],
  },
  {
    says: /\b(metadata|title tag|favicon|seo|open ?graph)\b/i,
    prefer: [/^app\/layout\.tsx$/],
  },
];

/** The file a path-shaped word in the message names, if it names one. */
function namedIn(message: string, tree: FileTree): string | null {
  /* An exact path, which is what somebody types once they have seen the file
     list. Longest first so `app/blog/[slug]/page.tsx` wins over `app/page.tsx`
     when both appear — the longer match is the more specific statement. */
  const byLength = [...tree].sort((a, b) => b.path.length - a.path.length);
  for (const file of byLength) {
    if (message.includes(file.path)) return file.path;
  }

  /* A bare filename — "in Nav.tsx", "the globals file". Only when it picks out
     exactly one file, because `page.tsx` in a project with six routes names all
     of them and therefore none. */
  const words = message.match(/[\w.-]+\.[a-z]{2,4}\b/gi) ?? [];
  for (const word of words) {
    const matches = tree.filter((file) => file.path.toLowerCase().endsWith(`/${word.toLowerCase()}`)
      || file.path.toLowerCase() === word.toLowerCase());
    if (matches.length === 1) return matches[0].path;
  }

  return null;
}

/**
 * The file to edit, decided without a model call, or null when it needs one.
 *
 * Exported separately from the model path so it can be tested exhaustively and
 * so the caller can see how the decision was reached — a change that landed in
 * the wrong file is a great deal easier to explain when the reason is recorded.
 */
export function pickFileLocally(message: string, tree: FileTree): FilePick | null {
  if (tree.length === 0) return null;
  if (tree.length === 1) return { path: tree[0].path, why: "only-one" };

  const named = namedIn(message, tree);
  if (named) return { path: named, why: "named" };

  for (const convention of CONVENTIONS) {
    if (!convention.says.test(message)) continue;

    for (const prefer of convention.prefer) {
      /* Among several matches the shortest path wins: components/Nav.tsx over
         components/marketing/nav/NavItem.tsx, which is the container rather
         than a detail inside it. */
      const matches = tree.filter((file) => prefer.test(file.path)).sort((a, b) => a.path.length - b.path.length);
      if (matches.length > 0) return { path: matches[0].path, why: "convention" };
    }
  }

  return null;
}

/** What the model is asked, when the words did not settle it. */
export const PICK_SYSTEM = `You are choosing which ONE file in a project a change belongs in.

You are given the file list and the request. Answer with the path and nothing else — no prose, no explanation, no markdown, no quotes. Exactly one line, exactly one path, copied character-for-character from the list.

- Choose where the thing being changed IS, not where it is used. A header that appears on every page lives in the layout or in its own component, not in the page somebody happened to be looking at.
- Prefer the most specific file that fully contains the change. If a change touches two files, choose the one carrying the part the request actually names.
- Design tokens — colours, fonts, spacing — live in the stylesheet, not in the markup that uses them.
- If nothing fits, answer with the home page's path.`;

export function pickPrompt(message: string, listing: string): string {
  return `${listing}\n\nTHE REQUESTED CHANGE: ${message}\n\nWhich single file?`;
}

/**
 * The model's answer, checked against the project.
 *
 * A path that is not in the tree is the failure worth guarding: a model asked
 * for a path will occasionally invent a plausible one, and an edit against a
 * file that does not exist fails in a way that reads as the person's fault. The
 * near-miss is recovered — a trailing slash, a leading ./, a case difference —
 * and anything else is refused so the caller can fall back rather than proceed
 * against nothing.
 */
export function readPick(answer: string, tree: FileTree): string | null {
  const said = answer.trim().split("\n")[0].trim().replace(/^["'`]|["'`]$/g, "").replace(/^\.\//, "").replace(/\/$/, "");
  if (!said) return null;

  const exact = tree.find((file) => file.path === said);
  if (exact) return exact.path;

  const insensitive = tree.find((file) => file.path.toLowerCase() === said.toLowerCase());
  if (insensitive) return insensitive.path;

  /* It answered with a filename rather than a path, which is a near miss and
     only recoverable when one file has that name. */
  const byName = tree.filter((file) => file.path.toLowerCase().endsWith(`/${said.toLowerCase()}`));
  if (byName.length === 1) return byName[0].path;

  return null;
}

/** The file an edit falls back to when nothing else decided: the home page. */
export function homePageOf(tree: FileTree): string | null {
  for (const candidate of ["app/page.tsx", "index.html", "app/layout.tsx"]) {
    if (tree.some((file) => file.path === candidate)) return candidate;
  }
  return tree[0]?.path ?? null;
}

/* What else in the project reaches this file.
 *
 * Paths and exported names only, never contents. The point of a tree is that
 * changing one component does not require reading forty others — but the
 * commonest way to break a project from inside one file is to rename or remove
 * something another file still imports, and a model that cannot see who is
 * asking has no way to know. A list of names is enough to stop that and costs
 * a few dozen tokens.
 */
export function neighbourBrief(tree: FileTree, path: string): string {
  const base = path.replace(/\.[jt]sx?$/, "");
  const importers = tree
    .filter((file) => file.path !== path && file.content.includes(base.replace(/^app\//, "@/app/")))
    .map((file) => file.path);

  const alsoImporting = tree
    .filter((file) => {
      if (file.path === path) return false;
      const name = base.split("/").pop();
      return Boolean(name) && new RegExp(`from\\s+["'][^"']*${name}["']`).test(file.content);
    })
    .map((file) => file.path);

  const reaching = [...new Set([...importers, ...alsoImporting])];
  if (reaching.length === 0) return "";

  return `WHAT ELSE REACHES THIS FILE — ${reaching.join(", ")}.
Whatever this file exports, those files are importing. Renaming or removing an export breaks every one of them, and a broken import is a build that does not deploy rather than a page that looks wrong.`;
}
