/* Putting right a build that Vercel refused, without being asked.
 *
 * A deployment that fails leaves the customer with a project that is finished,
 * paid for, stored, and not on the internet — and a build log, which is
 * evidence rather than an answer. The log names the file and the line. The
 * project's source is right here. Nothing was reading one against the other.
 *
 * ── Cheapest first, and usually free ──────────────────────────────────────
 *
 * Most of what `next build` refuses in generated code is one of a handful of
 * shapes, and next-structure.ts already knows how to fix every one of them
 * deterministically: a component exported from a page module, a page that is
 * both "use client" and statically routed, the JSX namespace React 19 removed.
 * So that runs first, costs nothing, takes no time, and settles the majority.
 *
 * Only what it cannot fix reaches a model, and then only for the ONE FILE the
 * log named. A repair that rewrites a project because one file has a type error
 * is not a repair.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * It does not invent a fix for a failure it cannot locate. A log with no file
 * in it, or naming a file the project does not have, comes back refused — and
 * the customer is told what failed instead, which is what happened before this
 * existed and is not worse than it. Guessing at somebody's source because we
 * would rather not report a failure is how an automatic repair becomes an
 * automatic corruption.
 *
 * It does not touch a file the model was never allowed to write: see
 * PLATFORM_OWNED in scaffold.ts. A build failing inside next.config.mjs is our
 * bug, not theirs, and a model rewriting it would hide it.
 */

import { editSource } from "./edit";
import { blocking, inspectStructure, repairStructure } from "./next-structure";
import { diagnose } from "@/lib/publish/diagnosis";
import type { FileTree } from "./tree";

export type BuildRepair =
  | {
      ok: true;
      tree: FileTree;
      /** Paths this changed, for the sentence the customer reads. */
      changed: string[];
      /** Which half did it. "structural" cost nothing; "model" cost a call. */
      how: "structural" | "model";
      note: string;
    }
  | { ok: false; reason: string };

/* Files this platform writes and the model may not. A failure in one of them is
   a bug in this repository, and a model rewriting it would bury the evidence
   while producing something that looks fixed. */
const PLATFORM_OWNED = new Set([
  "lib/supabase.ts",
  "lib/database.types.ts",
  "next.config.mjs",
  "postcss.config.mjs",
  "tailwind.config.ts",
  "app/tokens.css",
  "package.json",
  "tsconfig.json",
]);

/**
 * The file a build log is about, as a path in this tree.
 *
 * Pure, and separated from everything else here because it is the part that
 * decides whether a repair is attempted at all. A log names a file the way the
 * compiler saw it — `./app/products/page.tsx:13:38`, with a leading dot-slash
 * and a line and column — and the tree holds `app/products/page.tsx`.
 */
export function failingFile(log: string, tree: FileTree): string | null {
  const named = diagnose(log)?.file ?? null;
  if (!named) return null;

  const path = named.replace(/^\.?\//, "").replace(/:\d+(?::\d+)?$/, "");
  if (PLATFORM_OWNED.has(path)) return null;

  if (tree.some((file) => file.path === path)) return path;

  /* A project generated under `src/` names its files that way in the log and
     stores them without it, or the other way round. Tried once, both ways,
     rather than searched for: a fuzzy match on a filename is how a repair
     lands in the wrong file. */
  const stripped = path.replace(/^src\//, "");
  if (tree.some((file) => file.path === stripped)) return stripped;

  const prefixed = `src/${path}`;
  return tree.some((file) => file.path === prefixed) ? prefixed : null;
}

/**
 * One attempt at putting the build right.
 *
 * Never throws: this runs in a worker with nobody watching, and a repair that
 * can take the worker down is worse than a deployment that stays failed.
 */
export async function repairFromLog(log: string, tree: FileTree): Promise<BuildRepair> {
  if (tree.length === 0) return { ok: false, reason: "there are no files to repair" };

  /* ── The free half ──────────────────────────────────────────────────── */
  try {
    const { tree: sound, repairs } = repairStructure(tree);
    if (repairs.length > 0) {
      return {
        ok: true,
        tree: sound,
        changed: repairs.map((repair) => repair.file),
        how: "structural",
        note: repairs[0].what,
      };
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("repair: the structural pass threw:", error);
  }

  /* ── And what it could not reach ────────────────────────────────────── */
  const path = failingFile(log, tree);
  if (!path) {
    return {
      ok: false,
      reason: "the build log does not name a file in this project, so there is nothing specific to fix",
    };
  }

  const target = tree.find((file) => file.path === path);
  if (!target) return { ok: false, reason: `${path} is not in this project` };

  try {
    const edit = await editSource(repairBrief(log, path), target, "named", tree);
    if (edit.applied === 0) {
      return { ok: false, reason: `nothing could be changed in ${path} from what the log says` };
    }

    const repaired = tree.map((file) =>
      file.path === path ? { ...file, content: edit.contents } : file,
    );

    /* The repair is only a repair if it left the project sound. A model handed
       a compiler error can introduce a second one, and shipping that would
       spend the customer's remaining attempt on a build that fails differently.
       Checked against the same rules the deploy gate uses. */
    const stopping = blocking(inspectStructure(repaired));
    if (stopping.length > 0) {
      return {
        ok: false,
        reason: `the change to ${path} left something else the build would refuse: ${stopping[0].problem}`,
      };
    }

    return {
      ok: true,
      tree: repaired,
      changed: [path],
      how: "model",
      note: `${path} was changed to answer what the build reported`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "the repair could not be made",
    };
  }
}

/* What the model is asked. The log, the file, and the one instruction that
   matters: change what the error is about and nothing else. A repair that
   tidies while it is in there is a diff nobody asked for on a project somebody
   is waiting to see online. */
function repairBrief(log: string, path: string): string {
  return [
    `The production build of this project failed. This is what the build server reported:`,
    "",
    log.replace(/\n\nFull build log: https?:\/\/\S+/, "").slice(0, 4000),
    "",
    `Change ${path} so that this build succeeds.`,
    "",
    "Change only what the error is about. Do not reformat, do not rename, do not improve anything else, and do not remove a feature to make an error go away — the page has to still do what it did. If the error is a type error, fix the type; if it is a missing import, add the import.",
  ].join("\n");
}
