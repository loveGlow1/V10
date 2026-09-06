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

/* ── Finding the text a block is about ─────────────────────────────────────
 *
 * A patch used to require the SEARCH text to appear byte for byte. That rule
 * exists for a good reason — a patch applied to the wrong place is worse than
 * one refused, because the refusal is visible and the misapplication is not —
 * and it was costing people edits they had asked for perfectly clearly.
 *
 * The failure that made the case: somebody quoted the exact sentence off their
 * own page, "$4,000–$12,000 before a single visitor arrives", asked for that
 * part to go, and was told it could not be placed. The words were in the
 * document. What did not match was the whitespace around them — a model
 * re-indents a block it is copying, or joins two lines, and every one of those
 * is a rejection under a byte-for-byte rule.
 *
 * So the search gets more forgiving in stages, and the SAFETY comes from
 * somewhere else: every stage still has to find exactly ONE place. Ambiguity is
 * refused at every level, so nothing here can ever pick between two candidates.
 * What changes is only how much irrelevant difference is forgiven on the way to
 * a single answer.
 *
 *   1. exactly, as written
 *   2. with any run of whitespace matching any other — the indentation case
 *   3. with whitespace ignored entirely — the model that joined two lines
 *
 * A match at any stage is one location, or it is a failure.
 */

type Found = { start: number; end: number } | null;

/** Where `needle` sits in `haystack`, if it sits in exactly one place. */
function findExactlyOnce(haystack: string, needle: string): Found | "many" {
  const first = haystack.indexOf(needle);
  if (first === -1) return null;
  if (haystack.indexOf(needle, first + 1) !== -1) return "many";
  return { start: first, end: first + needle.length };
}

/** The same, allowing any whitespace to stand for any other. */
function findByShape(haystack: string, needle: string): Found | "many" {
  const trimmed = needle.trim();
  if (!trimmed) return null;

  const pattern = trimmed
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");

  let found: Found = null;
  const matcher = new RegExp(pattern, "g");

  for (let match = matcher.exec(haystack); match; match = matcher.exec(haystack)) {
    if (found) return "many";
    found = { start: match.index, end: match.index + match[0].length };
  }

  return found;
}

/** The same again, ignoring whitespace altogether.
 *
 * The index map is what makes this safe to act on: the collapsed copy is only
 * used to locate, and the offsets handed back are into the real document. */
function findByContent(haystack: string, needle: string): Found | "many" {
  const wanted = needle.replace(/\s+/g, "");
  if (!wanted) return null;

  let collapsed = "";
  const offsets: number[] = [];

  for (let index = 0; index < haystack.length; index += 1) {
    if (/\s/.test(haystack[index])) continue;
    collapsed += haystack[index];
    offsets.push(index);
  }

  const first = collapsed.indexOf(wanted);
  if (first === -1) return null;
  if (collapsed.indexOf(wanted, first + 1) !== -1) return "many";

  /* The end offset is one past the last non-space character it covers, so the
     replacement lands exactly over the matched text and no further. */
  return { start: offsets[first], end: offsets[first + wanted.length - 1] + 1 };
}

/**
 * Where this SEARCH block is in the document, however it can be found — and
 * only ever if there is one answer.
 *
 * Tried in order of how much they forgive. The first stage that finds a single
 * place wins; a stage that finds several stops the search rather than falling
 * through to a looser one, because a block that is ambiguous when read strictly
 * does not become unambiguous by reading it more loosely.
 */
export function locate(haystack: string, needle: string): Found | "many" {
  const exact = findExactlyOnce(haystack, needle);
  if (exact) return exact;

  const shaped = findByShape(haystack, needle);
  if (shaped) return shaped;

  return findByContent(haystack, needle);
}

/**
 * Applies search/replace blocks to a document, in the order given.
 *
 * A SEARCH that matches nowhere is a hard failure, and so is one that matches
 * more than once. Never "closest match" and never a guess between candidates —
 * but whitespace is not a difference worth refusing an edit over. See locate.
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
    const inOriginal = locate(html, search);
    if (inOriginal === "many") {
      failures.push({ reason: "the SEARCH text appears more than once", search });
      continue;
    }
    if (!inOriginal) {
      failures.push({ reason: "the SEARCH text is not in the page", search });
      continue;
    }

    /* Unique in the original, but gone from the copy: an earlier block in this
       same reply has already rewritten this text. Refused rather than resolved
       — two blocks fighting over one region is the model contradicting itself,
       and the page should not be the place that gets settled. */
    const here = locate(current, search);
    if (here === "many" || !here) {
      failures.push({ reason: "an earlier block in this reply already changed that text", search });
      continue;
    }

    /* Sliced by the offsets the match reported rather than by the length of the
       SEARCH text: where the match was found by shape or by content, the region
       it covers in the page is not the same length as the block that named
       it. */
    current = current.slice(0, here.start) + replace + current.slice(here.end);
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
