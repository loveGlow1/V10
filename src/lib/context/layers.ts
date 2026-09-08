/* What a piece of context IS, so that something other than its position can
 * decide whether it survives.
 *
 * The reduction this app did before was positional: the last six turns, the
 * first thousand words. Both are the same mistake in different units — they
 * keep whatever happens to be at one end of a list, which on a long thread is
 * reliably the small talk and reliably not the architecture decision taken
 * twenty messages ago and never repeated.
 *
 * So every piece of context arrives here labelled with what it is, and the
 * label carries a rank. When there is not room for everything, what goes is
 * decided by rank and relevance rather than by where it sat. */

/* The nine layers, highest priority first. The order IS the ranking: index 0
   is the most protected, index 8 the first to be summarised or deferred.

   Read them as a sentence about what a model needs to make one change: who it
   is and what it is being asked (1-2), the thing being changed (3), the rules
   the change has to respect (4-5), the code around it (6), what it looks like
   (7), what was decided earlier (8), and everything else (9). */
export const LAYERS = [
  /** Instructions this app gives every call. Never dropped, never summarised. */
  "system",
  /** What the person just asked for, in their words. */
  "request",
  /** The page, file or component being changed right now. */
  "target",
  /** Manifest, routes, database, auth — what the project IS. */
  "architecture",
  /** Tokens, type, colour, spacing — how it must look. */
  "design",
  /** Other project files this change reaches. */
  "files",
  /** Screenshots and rendered pages. */
  "visual",
  /** Decisions and instructions from earlier in the conversation. */
  "memory",
  /** Older, lower-relevance material that can be fetched again if needed. */
  "history",
] as const;

export type Layer = (typeof LAYERS)[number];

/** 0 for the most protected layer. Lower survives longer. */
export function rankOf(layer: Layer): number {
  return LAYERS.indexOf(layer);
}

/* The layers a request cannot be answered without.
 *
 * These are never summarised and never dropped: if they do not fit, the task is
 * too big for one call and must be decomposed (see planContext's `overflow`),
 * which is a different and honest answer to "this does not fit" than refusing
 * the person. Everything below this line is negotiable. */
export const CRITICAL_LAYERS: readonly Layer[] = ["system", "request", "target"];

export function isCritical(layer: Layer): boolean {
  return CRITICAL_LAYERS.includes(layer);
}

/* ── What different work needs ─────────────────────────────────────────────
 *
 * One static context package for every request is the thing this replaces. A
 * visual edit lives or dies on the screenshot and the design tokens; a database
 * change needs the schema and could not care less what the hero looks like.
 *
 * A boost is a rank adjustment, not a reordering: negative moves a layer up the
 * priority list for that kind of work. Layers not named keep their rank. The
 * effect is bounded — a boost can promote design above architecture for a
 * restyle, and cannot promote anything above the critical three. */
export type TaskProfile =
  | "build"
  | "edit"
  | "visual-edit"
  | "design-edit"
  | "data-edit"
  | "answer";

const BOOSTS: Record<TaskProfile, Partial<Record<Layer, number>>> = {
  /* A build has no target yet — it is making one — so what matters is the
     brief, the architecture it must fit and the design it must follow. */
  build: { architecture: -1, design: -1, memory: -0.5 },
  edit: {},
  /* The picture IS the instruction here: it outranks everything but the three
     that cannot move, and the design system comes with it because "match this"
     means matching tokens rather than eyeballing a colour. */
  "visual-edit": { visual: -4, design: -1.5 },
  "design-edit": { design: -2, visual: -1 },
  /* Schema, routes and policies. The page's appearance is the least of it. */
  "data-edit": { architecture: -2, files: -1, design: 1, visual: 1 },
  /* Answering a question about the project leans on what was already decided
     rather than on the files that implement it. */
  answer: { memory: -2, architecture: -0.5, files: 0.5 },
};

/** Where this item sits in the queue for room, for this kind of work. Lower
 *  is kept longer. Critical layers keep their rank whatever the profile says. */
export function priorityOf(layer: Layer, profile: TaskProfile): number {
  const base = rankOf(layer);
  if (isCritical(layer)) return base;
  return base + (BOOSTS[profile][layer] ?? 0);
}

/** One piece of context, before anything has decided whether it fits. */
export type ContextItem = {
  /** Stable name, so an omission can be reported and later retrieved by it. */
  id: string;
  layer: Layer;
  /** What would be sent. */
  text: string;
  /** How much this matters to THIS request, 0–1. Ties are broken by it, and it
   *  is what a retrieval step sets when it scores a file against the ask.
   *  Absent reads as 0.5 — present but unranked. */
  relevance?: number;
  /**
   * Never summarise this, at any pressure.
   *
   * The guide's lossless list: ids, file paths, schema, route names, component
   * names, API contracts, explicit user constraints, security rules, exact
   * configuration, exact error messages — and anything the person asked to have
   * modified verbatim. A summary of a schema is not a schema; a summary of the
   * text somebody asked you to rewrite is a different text.
   *
   * Lossless does not mean immortal. A lossless item outside the critical
   * layers can still be DEFERRED — left out of this call and fetched when it is
   * needed — which loses nothing, because it is still exactly itself when it
   * comes back. What it may never be is quietly shortened.
   */
  lossless?: boolean;
  /** True when the system can fetch this again on demand — a file in the tree,
   *  a stored attachment, a message in the thread. Omitting one of these is a
   *  deferral; omitting anything else is a loss and is reported as one. */
  retrievable?: boolean;
};
