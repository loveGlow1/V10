/* Retrieve, then discover what that needs, then retrieve that.
 *
 * The guide's §25, and the reason it is a section of its own: what a change
 * needs is not knowable before the change is understood. "Change the checkout
 * button" retrieves CheckoutButton.tsx, and only once you have that file do you
 * learn it calls a payment client, which has an auth requirement, which has a
 * schema. Loading all of it up front is the thing this whole engine exists not
 * to do; loading only the button is an edit that breaks the payment call.
 *
 * So expansion walks. It starts from what the request matched, follows the
 * edges the index recorded, and stops when the budget is spent or when nothing
 * new is reachable — whichever comes first. Every hop costs less than the one
 * before it, because a dependency of a dependency is usually context rather
 * than the thing being changed.
 *
 * Deterministic and offline: the edges are the imports and symbols indexTree
 * already wrote down. No model decides what to fetch next. */

import type { IndexEntry } from "./project-index";
import { retrieve, termsOf } from "./project-index";

export type Expansion = {
  /** In the order they were reached: the seeds first, then their dependencies. */
  entries: IndexEntry[];
  /** Tokens the whole set would cost if every entry were sent in full. */
  tokens: number;
  /** How the walk reached each one, for the log and for the record. */
  why: Record<string, string>;
  /** True when the walk stopped because it ran out of room rather than edges. */
  truncated: boolean;
};

/* How much a hop is worth compared with the last one. A direct match is the
   thing being changed; its import is why the change compiles; the import's
   import is usually a shared utility that nobody needs to read to make a
   button darker. Three hops is where it stops being context and starts being
   the repository. */
const MAX_HOPS = 3;
const HOP_DECAY = 0.5;

/** Whether an entry defines something the given specifier refers to. */
function defines(entry: IndexEntry, specifier: string): boolean {
  const tail = specifier.replace(/^[./@]*/, "").split("/").pop() ?? specifier;
  if (!tail) return false;
  if (entry.name === tail || entry.name === specifier) return true;
  if (!entry.path) return false;
  const base = entry.path.replace(/\.(tsx?|jsx?)$/, "");
  return base.endsWith(tail) || base.endsWith(specifier.replace(/^[./]*/, ""));
}

/**
 * Everything this request needs, found by following what it first matched.
 *
 * `budgetTokens` is the ceiling on the whole set, not on each entry: an
 * expansion that returns eleven files worth 90,000 tokens has not helped
 * anybody, because the caller then has to throw ten of them away without
 * knowing which.
 */
export function expandContext(
  entries: IndexEntry[],
  request: string,
  budgetTokens: number,
  seedLimit = 4,
): Expansion {
  const seeds = retrieve(entries, request, seedLimit);
  const chosen: IndexEntry[] = [];
  const why: Record<string, string> = {};
  const seen = new Set<string>();
  let spent = 0;
  let truncated = false;

  const key = (entry: IndexEntry) => `${entry.kind}:${entry.path ?? entry.name}`;

  const take = (entry: IndexEntry, reason: string): boolean => {
    const id = key(entry);
    if (seen.has(id)) return false;
    if (spent + entry.tokens > budgetTokens) {
      truncated = true;
      return false;
    }
    seen.add(id);
    chosen.push(entry);
    why[id] = reason;
    spent += entry.tokens;
    return true;
  };

  for (const seed of seeds) {
    take(seed.entry, `matched "${termsOf(request).slice(0, 4).join(" ")}"`);
  }

  /* The frontier: what was taken on the previous hop, whose dependencies are
     the candidates for this one. */
  let frontier = [...chosen];

  for (let hop = 1; hop <= MAX_HOPS && frontier.length > 0; hop += 1) {
    const next: IndexEntry[] = [];

    for (const from of frontier) {
      for (const specifier of from.symbols) {
        /* Only project-local edges. A node_modules import is not something this
           app can retrieve, and following it would fill the budget with names
           that resolve to nothing. */
        if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;

        const target = entries.find(
          (entry) => entry.kind === "file" && defines(entry, specifier) && !seen.has(key(entry)),
        );
        if (!target) continue;

        /* Later hops are cheaper to refuse: a dependency three steps out has to
           be small to earn its place. */
        const allowance = budgetTokens * HOP_DECAY ** hop;
        if (target.tokens > allowance) {
          truncated = true;
          continue;
        }

        if (take(target, `imported by ${from.path ?? from.name}`)) next.push(target);
      }
    }

    frontier = next;
  }

  return { entries: chosen, tokens: spent, why, truncated };
}

/**
 * The expansion as a block for a prompt: what exists and why it is here.
 *
 * Names and one-liners rather than contents. A model told "CheckoutButton.tsx
 * exists, imports payments/client.ts, which reaches the orders table" makes a
 * different change from one told nothing — and it costs a hundred tokens rather
 * than the three files.
 */
export function describeExpansion(expansion: Expansion): string {
  if (expansion.entries.length === 0) return "";

  const lines = expansion.entries.map((entry) => {
    const id = `${entry.kind}:${entry.path ?? entry.name}`;
    return `- ${entry.path ?? entry.name}${entry.summary ? ` — ${entry.summary}` : ""} (${expansion.why[id]})`;
  });

  return [
    "Parts of this project that this change reaches:",
    ...lines,
    expansion.truncated
      ? "(more exist and can be fetched if the change turns out to need them)"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
