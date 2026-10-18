/* Undo, Redo and "go back to version N" on work whose versions are kept
 * whole — a video's cuts, a flier's sets of images — where going back is
 * pointing at a version already made rather than making one again.
 *
 *   Undo      the version before the one showing
 *   Redo      the version after it
 *   a number  that exact version
 *
 * Neither loops: Undo stops at the first, Redo at the newest. Pure — the
 * video (lib/video/versions.ts) and the flier (lib/flyers/versions.ts) each
 * move their own pointer. */

import { parseTarget, readVersionRequest, REDO_ASK } from "@/lib/builder/versions";

/* A bare "undo" — the one phrasing parseTarget leaves to its caller. */
export const UNDO_ASK = /^\s*(?:please\s+)?(?:undo|revert)(?:\s+(?:it|that|this|the last change|the last edit|my last change))?[.!\s]*$/i;

export type Move =
  | { kind: "go"; to: number; how: "undo" | "redo" | "pick" }
  | { kind: "list" }
  | { kind: "refuse"; message: string };

/** What the versions are called: a video's "cut", a flier's "set". */
export type Words = { one: string; thing: string };

/** Whether a message is a move between versions rather than a change. Pure. */
export function isVersionMove(prompt: string, explicit: boolean): boolean {
  return explicit || REDO_ASK.test(prompt) || UNDO_ASK.test(prompt) || readVersionRequest(prompt) !== null;
}

/** Where a move goes, given the version showing and every version there is. Pure. */
export function resolveMove(prompt: string, current: number, versions: number[], words: Words): Move {
  const all = [...new Set(versions)].sort((a, b) => a - b);
  if (!all.length) return { kind: "refuse", message: `This ${words.thing} has no versions yet — describe it and the first is made.` };
  const newest = all[all.length - 1];

  if (REDO_ASK.test(prompt)) {
    const next = all.find((version) => version > current);
    return next === undefined
      ? { kind: "refuse", message: `There's nothing to redo — version ${current} is the newest ${words.one}. To pick any version, open Versions.` }
      : { kind: "go", to: next, how: "redo" };
  }
  if (readVersionRequest(prompt)?.kind === "list") return { kind: "list" };

  const target = UNDO_ASK.test(prompt) ? { kind: "back" as const, steps: 1 } : parseTarget(prompt, new Date(), "UTC");
  let to: number;
  let how: "undo" | "pick" = "pick";
  if (!target || target.kind === "back") {
    const steps = target?.kind === "back" ? target.steps : 1;
    const earlier = all.filter((version) => version < current);
    if (earlier.length === 0) return { kind: "refuse", message: `There's nothing to undo — version ${current} is the first ${words.one} of this ${words.thing}.` };
    to = earlier[Math.max(0, earlier.length - steps)];
    how = "undo";
  } else if (target.kind === "number") {
    if (!all.includes(target.number)) {
      return { kind: "refuse", message: `There's no version ${target.number} — this ${words.thing} has versions ${all[0]}–${newest}. Open Versions to see them all.` };
    }
    to = target.number;
  } else if (target.kind === "latest") {
    to = newest;
  } else {
    return { kind: "refuse", message: `For a ${words.thing}, name the version — say "go back to version 2", or open Versions and pick one.` };
  }
  if (to === current) return { kind: "refuse", message: `Version ${current} is already the one showing.` };
  return { kind: "go", to, how };
}
