/* Editing a page without rewriting it.
 *
 * An edit used to hand the whole document back to the model and ask for the
 * whole document again. That is three to five minutes for "make the header
 * darker", and every one of those rewrites is a chance for the model to quietly
 * restyle something nobody asked about.
 *
 * A patch is a pair: the exact text to find, and what to put in its place. The
 * model emits a few hundred tokens instead of thirty thousand, the edit lands
 * in seconds, and everything it did not name is byte-identical afterwards —
 * which is the property that actually matters.
 *
 * The artifact here is one HTML document, so a patch names no file. */

export type PatchFailure = { reason: string; search: string };

export type PatchResult = {
  html: string;
  applied: number;
  failures: PatchFailure[];
};

/* The block the edit prompt asks for. Tolerant of \r\n, because a model that
   has been reading a document full of them will sometimes write them back. */
const BLOCK =
  /<{7} SEARCH\r?\n([\s\S]*?)\r?\n={7}\r?\n([\s\S]*?)\r?\n>{7} REPLACE/g;

/** Whether the output contains anything that looks like a patch at all. */
export function hasPatches(modelOutput: string): boolean {
  BLOCK.lastIndex = 0;
  return BLOCK.test(modelOutput);
}

/**
 * Applies search/replace blocks to a document, in the order given.
 *
 * A SEARCH that does not match exactly is a hard failure, and so is one that
 * matches more than once. Never fuzzy, never "closest match": a patch applied
 * to the wrong place is worse than a patch refused, because the refusal is
 * visible and the misapplication is not.
 */
export function applyPatches(html: string, modelOutput: string): PatchResult {
  let current = html;
  let applied = 0;
  const failures: PatchFailure[] = [];

  BLOCK.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = BLOCK.exec(modelOutput)) !== null) {
    const search = match[1];
    const replace = match[2];

    /* Uniqueness is judged against the ORIGINAL page, not the page as it has
       been changed so far — and this is the whole subtlety of applying more
       than one block.

       The model wrote every block against the document it was shown, so that
       is the document its claim of uniqueness is about. Checking against the
       evolving copy instead lets an ambiguous block quietly become unique once
       an earlier patch has consumed one of its matches, and then it applies to
       whichever occurrence happened to survive. That is guessing, and it looks
       exactly like success. Judged against the original it is refused every
       time, whatever order the blocks arrive in. */
    const firstInOriginal = html.indexOf(search);
    if (firstInOriginal === -1) {
      failures.push({ reason: "the SEARCH text is not in the page", search });
      continue;
    }
    if (html.indexOf(search, firstInOriginal + 1) !== -1) {
      failures.push({ reason: "the SEARCH text appears more than once", search });
      continue;
    }

    /* Unique in the original, but gone from the copy: an earlier block in this
       same reply has already rewritten this text. Refused rather than resolved
       — two blocks fighting over one region is the model contradicting itself,
       and the page should not be the place that gets settled. */
    const at = current.indexOf(search);
    if (at === -1) {
      failures.push({ reason: "an earlier block in this reply already changed that text", search });
      continue;
    }

    current = current.slice(0, at) + replace + current.slice(at + search.length);
    applied += 1;
  }

  return { html: current, applied, failures };
}

/** The failures, written for the model to correct rather than for a person. */
export function describeFailures(failures: PatchFailure[]): string {
  return failures
    .map((failure, index) => {
      /* Only the first line of the SEARCH: enough to say which block is meant,
         short enough that a long failed patch does not crowd out the document
         it has to be corrected against. */
      const head = failure.search.split("\n")[0].slice(0, 120);
      return `${index + 1}. ${failure.reason} — block beginning: ${head}`;
    })
    .join("\n");
}

/* The one optional line the edit prompt allows after the last block.
 *
 * Read from what follows the final REPLACE marker rather than from the whole
 * output, which matters: a page can contain the word NEXT, and a replacement
 * block containing it would otherwise be mistaken for the model's own note.
 *
 * Everything about it is optional. A model that ignores the instruction, or
 * writes something rambling instead of a line, costs nothing — the note is
 * dropped and the edit is unaffected, because the patches were parsed before
 * this was ever looked at. */
const NOTE_LIMIT = 240;

export function noteAfterPatches(modelOutput: string): string | null {
  const end = modelOutput.lastIndexOf(">>>>>>> REPLACE");
  if (end === -1) return null;

  const tail = modelOutput.slice(end + ">>>>>>> REPLACE".length).trim();
  const line = tail.split(/\r?\n/).find((candidate) => /^NEXT:/i.test(candidate.trim()));
  if (!line) return null;

  const note = line.trim().replace(/^NEXT:\s*/i, "").trim();
  return note && note.length <= NOTE_LIMIT ? note : null;
}
