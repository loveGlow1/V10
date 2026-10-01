/* Adding a feature to a project that already exists.
 *
 * Two paths existed and neither was right for "add a user dashboard":
 *
 *   - An EDIT patches one file that is already there, inside one sixty-second
 *     request. It cannot create app/dashboard/page.tsx, let alone the eight
 *     files a dashboard is, and it cannot wire them into the header.
 *   - A BUILD writes the whole project again from nothing, through the
 *     orchestrator, and charges for all of it. Worse, the message router sent
 *     "build a user dashboard with login" there as a NEW PROJECT, so asking to
 *     add a room got you a new house.
 *
 * A person adding a dashboard to a site does neither. They read what is there
 * — the layout, the header, the design, the tables in the database — write the
 * new pages, and change the two or three existing files that need to know
 * about them. That is what this is: a build that is handed the project it is
 * adding to, returns ONLY the files it creates or changes, and is merged over
 * the existing project when it lands (see the save route). It is priced on the
 * files it wrote, not on the size of the project.
 *
 * Pure: no SDK and no database, so it can be checked offline. */

import type { FileTree } from "./tree";

export type FeatureAsk = {
  /** What is being added, in the words of the request: "a dashboard", "sign-in". */
  areas: string[];
  /** The phrase that decided it, for the step list. */
  because: string;
};

/* Asking for something to be made, rather than changed. */
const ADDS =
  /\b(add|adding|build|create|set up|setup|implement|integrate|include|introduce|make (?:me |us |it )?(?:a|an|new)|give (?:it|me|us|the site) (?:a|an)|i (?:need|want)|we (?:need|want)|can (?:you|it) (?:have|get)|needs? (?:a|an|to have))\b/i;

/* The areas a project gains as NEW ROUTES — each one is files that do not
   exist yet, which is precisely what an edit cannot write. `routes` is how to
   tell whether the project already has it. Ordered so the most specific
   reading wins: "admin dashboard" is the admin, not a member dashboard. */
const AREAS: { label: string; says: RegExp; routes: RegExp }[] = [
  {
    label: "an admin area",
    says: /\b(admin(?: panel| area| side| dashboard)?|back ?office|cms|manage (?:the )?(?:listings|products|posts|orders|content|bookings))\b/i,
    routes: /^app\/admin\//,
  },
  {
    label: "a dashboard",
    says: /\b(dashboard|members?(?:'s)? area|member portal|client portal|customer portal|user portal|portal|account area|my account)\b/i,
    routes: /^app\/(?:dashboard|account|portal|members?)\//,
  },
  {
    label: "sign-in and accounts",
    says: /\b(log ?in|sign[- ]?(?:in|up)|auth(?:entication)?|user accounts?|customer accounts?|accounts? for (?:users|customers|members))\b/i,
    routes: /^app\/(?:login|signin|sign-in|signup|sign-up|auth)\//,
  },
  {
    label: "bookings",
    says: /\b(booking(?: system| flow| page)?|appointments?|reservations?|schedul(?:e|ing) (?:a )?(?:viewing|visit|call|appointment)s?)\b/i,
    routes: /^app\/(?:book|bookings?|appointments?|reservations?|schedule)\b/,
  },
  {
    label: "a cart and checkout",
    says: /\b(checkout|shopping cart|cart|basket)\b/i,
    routes: /^app\/(?:cart|checkout|basket)\//,
  },
  {
    label: "a blog",
    says: /\b(blog|articles? section|news section)\b/i,
    routes: /^app\/(?:blog|news|articles?)\//,
  },
  {
    label: "messaging",
    says: /\b(messag(?:es|ing)|inbox|live chat|chat (?:feature|system|page))\b/i,
    routes: /^app\/(?:messages|inbox|chat)\//,
  },
  {
    label: "saved items",
    says: /\b(favou?rites|wish ?list|saved (?:items|properties|listings|products|searches))\b/i,
    routes: /^app\/(?:(?:dashboard|account)\/)?(?:favou?rites|saved|wishlist)\//,
  },
  {
    label: "analytics",
    says: /\b(analytics|reports?|reporting|insights)\b/i,
    routes: /^app\/(?:(?:admin|dashboard)\/)?(?:analytics|reports?|insights)\//,
  },
];

/* "a pricing page", "a new FAQ page", "another page for our team". A named
   page is a route of its own. */
const NAMED_PAGE = /\b(?:a|an|the|new|another)\s+(?:new\s+)?([a-z][a-z-]{2,20})\s+page\b/i;

/* Not pages: a word in front of "page" that names a part of one. */
const NOT_A_PAGE = new Set(["landing", "home", "single", "whole", "entire", "same", "this", "that", "web", "one"]);

/* A route counts as built only when its page has something in it. The stub the
   staged builds used to leave — a heading and "will be built out in a later
   stage" — is a route that exists and a feature that does not. */
const STUB_BELOW = 1200;

function hasRoute(tree: FileTree, routes: RegExp): boolean {
  return tree.some(
    (file) => routes.test(file.path) && /\/page\.tsx$/.test(file.path) && file.content.length >= STUB_BELOW,
  );
}

/**
 * What new area this message asks a multi-file project to gain, or null when
 * it is an ordinary change to something already there.
 *
 * Null for anything that is not asking for something to be made, and for an
 * area the project already has in full — "make the dashboard darker" and "add
 * a chart to the dashboard" are edits to a page that exists.
 */
export function featureFor(message: string, tree: FileTree): FeatureAsk | null {
  const m = message.trim();
  if (!m || tree.length === 0 || !ADDS.test(m)) return null;

  const areas: string[] = [];
  let because = "";
  let claimed = m;

  for (const area of AREAS) {
    const said = claimed.match(area.says);
    if (!said) continue;
    /* Taken out once matched, so "admin dashboard" is not also a member one. */
    claimed = claimed.replace(area.says, " ");
    if (hasRoute(tree, area.routes)) continue;
    areas.push(area.label);
    because ||= said[0];
  }

  /* Read from what is left, so "a booking page" is the bookings area above
     rather than that and a page called "booking" as well. */
  const page = claimed.match(NAMED_PAGE);
  if (page && !NOT_A_PAGE.has(page[1].toLowerCase())) {
    const slug = page[1].toLowerCase();
    if (!hasRoute(tree, new RegExp(`^app/${slug}/`))) {
      areas.push(`a ${slug} page`);
      because ||= page[0];
    }
  }

  return areas.length > 0 ? { areas, because } : null;
}

/* ── What the generator is shown of the project it is adding to ───────────
 *
 * The files that decide whether a new page looks and behaves like it belongs:
 * the shell, the header, the data client and its types, the design tokens, and
 * the home page as a worked example of the house style. Everything else is a
 * path in the listing — enough to link to it, and to know not to rewrite it. */
const CONTEXT_FILES = [
  /^app\/layout\.tsx$/,
  /^components\/(?:Nav|Navbar|Header|SiteHeader|TopBar)\.tsx$/i,
  /^components\/(?:Footer)\.tsx$/i,
  /^components\/(?:AuthProvider|SessionProvider|Providers|AdminGuard|AuthGuard|AuthPrompt)\.tsx$/i,
  /^lib\/supabase\.ts$/,
  /^lib\/database\.types\.ts$/,
  /^lib\/schema\.sql$/,
  /^app\/login\/page\.tsx$/,
  /^app\/page\.tsx$/,
];

/* A ceiling on the shown source, so a large project cannot crowd the brief out
   of the context window. The listing is never cut: knowing a file exists is
   what stops it being written twice. */
const CONTEXT_BUDGET = 60_000;

/**
 * The instruction for a feature build: the ordinary file-tree brief, turned
 * into an addition by what follows it.
 *
 * `base` is treeBrief's output, kept whole — its rules about the client
 * directive, Tailwind, auth, data and the dashboard are exactly as true for a
 * new page as for a new project. What changes is which files to write.
 */
export function featureBrief(base: string, ask: FeatureAsk, request: string, tree: FileTree): string {
  const listing = tree
    .map((file) => `- ${file.path} (${file.content.length.toLocaleString("en")} chars)`)
    .join("\n");

  let budget = CONTEXT_BUDGET;
  const shown: string[] = [];
  for (const pattern of CONTEXT_FILES) {
    for (const file of tree.filter((entry) => pattern.test(entry.path))) {
      if (budget <= 0) break;
      if (shown.some((block) => block.startsWith(`--- ${file.path}\n`))) continue;
      const body = file.content.length > budget ? `${file.content.slice(0, budget)}\n/* …cut for length */` : file.content;
      shown.push(`--- ${file.path}\n${body}`);
      budget -= body.length;
    }
  }

  return `${base}

════════════════════════════════════════
THIS IS AN ADDITION TO AN EXISTING PROJECT — NOT A NEW ONE
════════════════════════════════════════

The person asked: ${request.trim()}

What it adds: ${ask.areas.join(", ")}.

The project below already exists and is live for its owner. Treat the WRITE THESE list above as the shape a complete project has, not as files to produce: write ONLY

1. the files this feature needs that do not exist yet, and
2. the existing files that must change to connect it — the header or nav gets its links (and, where the feature has accounts, the signed-in avatar menu), a page gains the button that leads into it, lib/database.types.ts gains any new table.

Return each of those in FULL. Do NOT return any existing file you did not need to change: whatever you leave out is kept exactly as it is, and whatever you return replaces it. Never remove a route, a link or a section that is there now.

It must look like it was always part of this project: the same design tokens, the same components (import them, do not copy them), the same header and footer, the same tone of copy, and the same Supabase client and tables. Read the database types and schema below before inventing a table — use what is there, and add only what the feature genuinely needs.

THE PROJECT AS IT IS — every file:
${listing}

THE FILES THAT DECIDE HOW IT LOOKS AND WHERE ITS DATA LIVES:
${shown.join("\n\n")}`;
}

/**
 * The project after a feature lands: every existing file, with the returned
 * ones written over or added.
 *
 * Nothing is ever removed here. A model that leaves a file out of its answer
 * has not asked for it to be deleted — that is the whole contract of the
 * feature brief — and a merge that dropped absent files would delete the
 * project a page at a time.
 */
export function mergeFeature(
  base: FileTree,
  returned: FileTree,
): { tree: FileTree; created: string[]; changed: string[] } {
  const byPath = new Map(base.map((file) => [file.path, file]));
  const created: string[] = [];
  const changed: string[] = [];

  for (const file of returned) {
    const before = byPath.get(file.path);
    if (!before) created.push(file.path);
    else if (before.content !== file.content) changed.push(file.path);
    byPath.set(file.path, file);
  }

  const tree: FileTree = [
    ...base.map((file) => byPath.get(file.path) as FileTree[number]),
    ...returned.filter((file) => !base.some((entry) => entry.path === file.path)),
  ];
  return { tree, created, changed };
}
