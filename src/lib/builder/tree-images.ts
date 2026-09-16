/* Real photographs in a generated PROJECT, rather than only on a generated page.
 *
 * images.ts has filled the single-page stack's pictures since it was written:
 * the model declares a slot — an `<img data-shot="…">` carrying art direction
 * and no src — and a pass after generation puts real pixels in it. That split
 * exists because a language model cannot emit a photograph, and the module
 * beside this one argues it at length.
 *
 * The file tree never got that pass. `fillImages` is called once, on the single
 * HTML document, and a project build skips it entirely — the flag that skips it
 * is named for the SUMMARY the route writes for a tree, which genuinely has no
 * slots in it, and the tree's own files were never offered to it. So a project's
 * photographs could only ever come from the asset pipeline that runs BEFORE
 * generation and hands URLs to the model in its prompt.
 *
 * When that pipeline came back with nothing, nothing else ever ran. The model
 * was still told "the photographs for this build are listed further up",
 * found nothing listed, and did the reasonable thing: it drew a neutral panel
 * where a photograph belonged. That is the grey rounded rectangle customers
 * report as "images show as blank placeholders" — and there was no second
 * chance for it anywhere, because the safety net the single page has was never
 * strung under the tree.
 *
 * This is that net. Same slots, same provider, same rules; a tree instead of a
 * document.
 *
 * ── Why the budget is smaller here ────────────────────────────────────────
 *
 * A filled slot is a base64 data URI, which is how the single page stays
 * self-contained. A tree has a hard ceiling of its own — MAX_TREE_BYTES in
 * tree.ts, three megabytes, checked when it is stored — and a build that
 * fetches beautiful photographs and is then refused for being too large has
 * cost somebody their whole build. So the spend here is well under that, with
 * the source itself allowed for.
 */

import { type FillResult, type ImageProvider, IMAGE_BUDGET_BYTES, fillImages } from "./images";
import type { PhotoId } from "./images";
import { MAX_FILE_BYTES, type FileTree } from "./tree";

/* Under MAX_TREE_BYTES with room for the project itself.
 *
 * A generated project is twenty to forty files and rarely more than 200KB of
 * source, so this leaves better than a megabyte of headroom against the three
 * the tree may occupy. Deliberately below images.ts's own budget: that one is
 * sized for a document that is nothing but the page, and this one has a project
 * to fit around. */
export const TREE_IMAGE_BUDGET_BYTES = Math.min(1_600_000, IMAGE_BUDGET_BYTES);

/* Which files can hold a slot. A slot is an `<img>` tag, so it lives wherever
   markup does — which in a Next.js project is the components and the pages. */
const RENDERS = /\.(?:tsx|jsx)$/;

export type TreeFill = {
  tree: FileTree;
  filled: number;
  skipped: number;
  bytes: number;
  credits: FillResult["credits"];
  used: PhotoId[];
};

/**
 * The tree with its declared photograph slots filled.
 *
 * Runs file by file, threading ONE exclusion set through all of them. That is
 * the part that would be wrong if each file were filled independently: within a
 * page, images.ts already stops two slots getting the same photograph, and
 * across a project the same rule has to hold or a four-page site shows the same
 * hero four times. The budget is threaded for the same reason — it is a budget
 * for the project, not for each file that happens to contain a picture.
 *
 * Never throws. A provider that is unconfigured, rate-limited or offline leaves
 * every slot with the neutral placeholder it shipped with, which is exactly
 * what images.ts guarantees for a page and is the reason photographs are a
 * deployment decision rather than a dependency.
 */
export async function fillTreeImages(
  tree: FileTree,
  provider: ImageProvider | null,
  options: {
    budget?: number;
    timeoutMs?: number;
    context?: string;
    seed?: string;
    exclude?: Iterable<PhotoId>;
  } = {},
): Promise<TreeFill> {
  const credits: FillResult["credits"] = [];
  const used: PhotoId[] = [];
  const exclude = new Set<PhotoId>(options.exclude ?? []);

  let remaining = options.budget ?? TREE_IMAGE_BUDGET_BYTES;
  let filled = 0;
  let skipped = 0;
  let bytes = 0;
  let touched = false;

  const out: FileTree = [];

  for (const file of tree) {
    /* Not markup, or nothing declared in it. The second test is what keeps this
       from being a pass over every file in the project: readSlots would find
       nothing, but the work of asking is avoided for the common case. */
    if (!RENDERS.test(file.path) || !file.content.includes("data-shot")) {
      out.push(file);
      continue;
    }

    /* What this ONE file can still take.
     *
     * The budget above is the tree's, and spending it is not evenly spread:
     * the first file with slots in it is offered the whole remaining amount,
     * so a single page could be handed a megabyte of pictures. The tree stayed
     * inside its own ceiling and the file blew through project_files' per-file
     * CHECK, which readTree had cleared before any of this ran — and because
     * the tree is stored in one statement, that one file cost the project
     * every other file with it. Seen in production twice in one day: a build
     * that generated fine and reported "its files could not be stored". */
    const headroom = MAX_FILE_BYTES - Buffer.byteLength(file.content, "utf8");
    if (headroom <= 0) {
      out.push(file);
      continue;
    }

    let result: FillResult;
    try {
      result = await fillImages(file.content, provider, {
        budget: Math.min(remaining, headroom),
        timeoutMs: options.timeoutMs,
        context: options.context,
        seed: options.seed,
        exclude,
      });
    } catch {
      /* One file's fetch failing must not cost the project its other pictures,
         and must never cost it the file. */
      out.push(file);
      continue;
    }

    /* Measured rather than trusted. The budget is counted in image bytes and
       what lands in the file is text, so the two are close but not the same
       number — and "close" is not what a CHECK constraint enforces. A fill
       that would not fit is dropped and the file kept as it was: a page with
       fewer pictures is a page, where a project that will not store is
       nothing. */
    if (Buffer.byteLength(result.html, "utf8") > MAX_FILE_BYTES) {
      out.push(file);
      continue;
    }

    filled += result.filled;
    skipped += result.skipped;
    bytes += result.bytes;
    remaining = Math.max(0, remaining - result.bytes);

    for (const credit of result.credits) credits.push(credit);
    for (const id of result.used) {
      used.push(id);
      exclude.add(id);
    }

    if (result.html !== file.content) touched = true;
    out.push({ ...file, content: result.html });
  }

  /* Identity when nothing changed, so a caller can tell a fill that did work
     from one that had none to do without comparing forty files. */
  return { tree: touched ? out : tree, filled, skipped, bytes, credits, used };
}

/** Whether this tree declares any photograph slots at all. */
export function declaresPhotographs(tree: FileTree): boolean {
  return tree.some((file) => RENDERS.test(file.path) && file.content.includes("data-shot"));
}
