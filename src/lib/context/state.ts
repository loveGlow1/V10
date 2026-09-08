/* What a project IS, kept between messages — versioned, checkpointed, cached,
 * and invalidated when it stops being true.
 *
 * Four sections of the guide that turn out to be one object. Every message
 * rebuilt the architecture brief, the design summary and the route list from
 * scratch, which cost nothing in tokens the first time and cost them again on
 * every message after; and nothing recorded that the project had CHANGED, so a
 * prompt assembled from a stale reading could describe a database the project
 * no longer had.
 *
 *   §31  version      Bumped when something structural changes. A cached block
 *                     written under v3 is not valid under v4.
 *   §32  cache        The stable blocks, stored as text so they are byte-identical
 *                     between messages — which is also what makes a provider-side
 *                     prompt cache hit rather than miss.
 *   §33  invalidation Per-kind, so a schema change does not throw away the design
 *                     summary. Precision here is the difference between a cache
 *                     and a cache that is always cold.
 *   §17  checkpoints  The state at the points worth continuing from.
 *
 * Nothing in this file reaches a database — see store.ts for that. This is the
 * shape and the rules, so both the writer and the reader agree on them and so a
 * checker can hold them without a connection. */

/** What the project is, as the next message needs to know it. */
export type ContextState = {
  /** landing | ecommerce | blog | news | webapp. */
  kind?: string;
  /** The architecture layers, as the build decided them. */
  manifest?: Record<string, boolean>;
  /** Which of the design systems, by name. */
  designSystem?: string;
  /** "standalone-html" | "nextjs". */
  stack?: string;
  /** The addresses this project answers on. */
  routes?: string[];
  /** What was decided and must not be quietly undone — §15's important
   *  decisions. Lines, in the order they were taken. */
  decisions?: string[];
  /** One paragraph about what this project is, for a prompt that needs the
   *  gist rather than the manifest. */
  summary?: string;
};

/** The blocks worth keeping built. Each is derived from a different slice of
 *  the state, which is what lets them be invalidated separately. */
export type CacheKind = "architecture" | "design" | "routes" | "summary" | "index";

export type CacheEntry = { text: string; fingerprint: string; writtenAt: string };
export type ContextCache = Partial<Record<CacheKind, CacheEntry>>;

/* Which parts of the state each cached block is built from.
 *
 * This table IS the invalidation rule (§33). A block is stale exactly when the
 * fields it was built from have changed — not when anything at all has changed,
 * which is what makes "the schema moved, so rebuild the design summary" the
 * wrong behaviour and a cache that never hits. */
const DEPENDS_ON: Record<CacheKind, (keyof ContextState)[]> = {
  architecture: ["kind", "manifest", "stack"],
  design: ["designSystem"],
  routes: ["routes", "stack"],
  summary: ["kind", "manifest", "designSystem", "summary"],
  index: ["routes", "stack"],
};

/* A hash, written out rather than imported.
 *
 * FNV-1a: small, deterministic, and — the point — dependency-free, so this
 * module runs unchanged in a route, in a script and in the checker. It is not a
 * cryptographic hash and does not need to be: it answers "is this the same
 * state as last time", where the adversary is a forgetful programmer rather
 * than an attacker. */
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * A stable short digest of a piece of text.
 *
 * Exported because the requirement ledger needs exactly this and for the same
 * reason: the same sentence, sent twice, has to be recognised as one
 * requirement rather than stored as two. Same hash, same properties — not a
 * security primitive, and not used as one.
 */
export function digest(value: string): string {
  return hash(value.replace(/\s+/g, " ").trim().toLowerCase());
}

/** Keys sorted, so two states that differ only in key order hash the same. A
 *  cache that misses on JSON key order is a cache that never hits. */
function stable(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${key}:${stable(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The fingerprint of one cached block, given the state it would be built from.
 *
 * The version is part of it, so a structural change invalidates every block
 * whether or not this module knows why — the safe direction, and cheap: a
 * version only moves when the project really changed.
 */
export function fingerprintFor(kind: CacheKind, state: ContextState, version: number): string {
  const slice = Object.fromEntries(
    DEPENDS_ON[kind].map((field) => [field, state[field] ?? null]),
  );
  return `${version}:${hash(stable(slice))}`;
}

/**
 * The cached text for this block, or null when it must be rebuilt.
 *
 * Null on a miss rather than a stale value: a caller that gets null rebuilds,
 * which is exactly what it did before there was a cache, so a cold cache is
 * only ever slower and never wrong.
 */
export function readCache(
  cache: ContextCache | null | undefined,
  kind: CacheKind,
  state: ContextState,
  version: number,
): string | null {
  const entry = cache?.[kind];
  if (!entry) return null;
  return entry.fingerprint === fingerprintFor(kind, state, version) ? entry.text : null;
}

/** The cache with this block written into it. Pure: returns a new object. */
export function writeCache(
  cache: ContextCache | null | undefined,
  kind: CacheKind,
  text: string,
  state: ContextState,
  version: number,
  now = new Date().toISOString(),
): ContextCache {
  return {
    ...(cache ?? {}),
    [kind]: { text, fingerprint: fingerprintFor(kind, state, version), writtenAt: now },
  };
}

/**
 * Which blocks a change makes stale, without having to compare state.
 *
 * The comparison above is the authority — a fingerprint cannot lie. This is for
 * the caller that knows what it just did and wants to drop the affected entries
 * immediately rather than leave them to be found stale later.
 */
export type ChangeKind =
  | "schema"
  | "auth"
  | "routes"
  | "design"
  | "content"
  | "architecture";

export function invalidatedBy(change: ChangeKind): CacheKind[] {
  switch (change) {
    /* A schema change moves what the project IS and what its pages can do; it
       does not touch how anything looks. That distinction is the whole reason
       this is per-kind. */
    case "schema":
    case "auth":
    case "architecture":
      return ["architecture", "summary", "index"];
    case "routes":
      return ["routes", "index", "summary"];
    case "design":
      return ["design", "summary"];
    /* Words on a page. Nothing derived from the state changes at all. */
    case "content":
      return [];
  }
}

/** The cache with those entries dropped. */
export function invalidate(cache: ContextCache | null | undefined, change: ChangeKind): ContextCache {
  const dropped = new Set<string>(invalidatedBy(change));
  return Object.fromEntries(
    Object.entries(cache ?? {}).filter(([kind]) => !dropped.has(kind)),
  ) as ContextCache;
}

/* ── Versioning ────────────────────────────────────────────────────────────
 *
 * A version is not a counter of edits. It moves when the project becomes a
 * different thing to reason about — a table added, auth turned on, the stack
 * changed — because that is when everything assembled from the old reading
 * stops being safe. Text changes on a page do not move it, and if they did the
 * cache below would be worthless. */
export function isStructuralChange(before: ContextState, after: ContextState): boolean {
  const structural: (keyof ContextState)[] = ["kind", "manifest", "designSystem", "stack", "routes"];
  return structural.some((field) => stable(before[field] ?? null) !== stable(after[field] ?? null));
}

/** The version the project should be on after this state was recorded. */
export function nextVersion(
  before: ContextState,
  after: ContextState,
  currentVersion: number,
): number {
  return isStructuralChange(before, after) ? currentVersion + 1 : currentVersion;
}

/* ── Checkpoints ───────────────────────────────────────────────────────────
 *
 * Named for what was achieved rather than for when it happened: "Checkout
 * implemented" is something to continue from, and "build 7" is a row in a
 * table. */
export function checkpointLabel(state: ContextState, what: "built" | "published" | "qa"): string {
  const name = state.kind ? `${state.kind} project` : "project";
  switch (what) {
    case "built":
      return `${name} built${state.routes?.length ? ` — ${state.routes.length} routes` : ""}`;
    case "published":
      return `${name} published`;
    case "qa":
      return `${name} passed visual QA`;
  }
}

/**
 * The state as a block for a prompt.
 *
 * This is what §15 asks for and what the app was doing the expensive way: a
 * structured account of the project instead of a replayed conversation. Ten
 * lines that say what a hundred messages would.
 */
export function describeState(state: ContextState): string {
  const lines: string[] = [];

  if (state.kind) lines.push(`Kind: ${state.kind}${state.stack ? ` (${state.stack})` : ""}`);
  if (state.designSystem) lines.push(`Design system: ${state.designSystem}`);

  const on = Object.entries(state.manifest ?? {})
    .filter(([, enabled]) => enabled === true)
    .map(([layer]) => layer);
  if (on.length > 0) lines.push(`Has: ${on.join(", ")}`);

  if (state.routes?.length) lines.push(`Routes: ${state.routes.slice(0, 20).join(", ")}`);
  if (state.summary) lines.push(`About: ${state.summary}`);

  if (state.decisions?.length) {
    lines.push("Decisions already taken, which this change must not undo:");
    for (const decision of state.decisions.slice(0, 12)) lines.push(`- ${decision}`);
  }

  return lines.length > 0 ? `What this project is:\n${lines.join("\n")}` : "";
}
