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
 * The artifact here is one HTML document, so a patch names no file.
 *
 * ── The failure this file is shaped around ──────────────────────────────────
 *
 * The delimiters below are not escapable. A block says where it ends by writing
 * `=======` on a line, so a block can never carry a line that is `=======`, and
 * the parser has no way to be told which one was meant. That is a property of
 * the format, not a bug in any one regex, and it has one consequence that has
 * to be designed for rather than hoped against:
 *
 *   if delimiter text ever reaches the page, the page cannot be repaired by
 *   editing it.
 *
 * Every SEARCH written to find that text contains delimiters, mis-parses, and
 * writes more delimiter text into the document. It is a loop that gets worse
 * each time someone asks for it to be cleaned up — observed on a real project,
 * where six attempts to delete the markers took the page from one stray
 * `=======` to eighteen.
 *
 * So delimiters are kept out of the document by construction, in three places
 * that each assume the other two are absent:
 *
 *   1. Parsing is strict (`parseBlocks`). Output that does not consist of
 *      well-formed blocks is refused whole rather than half-read. The old
 *      regex scanned for the next delimiter it could find, which let one
 *      malformed block swallow the next block's markers into its replacement.
 *   2. A replacement carrying a delimiter line is refused (`applyPatches`).
 *      Belt to the parser's braces: whatever a model emits, the text written
 *      into the page is checked before it is written.
 *   3. A page that has already been poisoned is repaired in code and never by
 *      the model (`stripConflictMarkers`), because the model cannot express
 *      that repair in this format.
 */

export type PatchFailure = { reason: string; search: string };

export type PatchResult = {
  html: string;
  applied: number;
  failures: PatchFailure[];
};

/* The three delimiter lines, matched whole. Leading and trailing whitespace is
   tolerated because a model that has been reading indented HTML will sometimes
   indent them; anything else on the line means it is content that merely looks
   like a marker, and content is left alone. */
const SEARCH_LINE = /^\s*<{7} SEARCH\s*$/;
const DIVIDER_LINE = /^\s*={7,}\s*$/;
const REPLACE_LINE = /^\s*>{7} REPLACE\s*$/;

function isMarkerLine(line: string): boolean {
  return SEARCH_LINE.test(line) || DIVIDER_LINE.test(line) || REPLACE_LINE.test(line);
}

/** Whether a document carries edit-format delimiters — always a bug, never content. */
export function hasConflictMarkers(text: string): boolean {
  return text.split("\n").some(isMarkerLine);
}

export type ParsedPatches =
  | { ok: true; blocks: { search: string; replace: string }[] }
  | { ok: false; reason: string };

/**
 * Reads model output as a list of search/replace blocks.
 *
 * A state machine over lines rather than a regex over the whole string, and the
 * difference is the point: a regex looks for the next delimiter that lets it
 * match, so a block missing its divider quietly borrows the divider of the
 * block after it and captures everything between as replacement text. A state
 * machine has nowhere to borrow from — the line after a SEARCH marker is either
 * the next thing in this block or a malformed document, and it says which.
 *
 * Malformed output is refused whole. Applying the blocks that happen to parse
 * out of a reply the model got wrong means writing a fragment of an edit into
 * someone's page, and a half-applied edit is harder to see and harder to undo
 * than one that was refused.
 */
export function parseBlocks(modelOutput: string): ParsedPatches {
  const lines = modelOutput.split("\n");
  const blocks: { search: string; replace: string }[] = [];

  /* Where we are in a block, and what has been collected for it so far. */
  let state: "outside" | "search" | "replace" = "outside";
  let search: string[] = [];
  let replace: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const where = `line ${i + 1}`;

    if (SEARCH_LINE.test(line)) {
      if (state !== "outside") {
        return { ok: false, reason: `a block opened inside another block at ${where}` };
      }
      state = "search";
      search = [];
      replace = [];
      continue;
    }

    if (DIVIDER_LINE.test(line)) {
      /* Outside a block this is prose the model wrote as a rule, or the
         wreckage of an earlier bad edit quoted back. Either way there is no
         block it belongs to. */
      if (state !== "search") {
        return { ok: false, reason: `a divider with no SEARCH above it at ${where}` };
      }
      state = "replace";
      continue;
    }

    if (REPLACE_LINE.test(line)) {
      if (state !== "replace") {
        return { ok: false, reason: `a block ended before its divider at ${where}` };
      }
      blocks.push({ search: search.join("\n"), replace: replace.join("\n") });
      state = "outside";
      continue;
    }

    if (state === "search") search.push(line);
    else if (state === "replace") replace.push(line);
    /* Outside a block, anything else is prose. The prompt asks for none, but a
       sentence of explanation around a good block is not worth refusing an
       edit over. */
  }

  if (state !== "outside") {
    return { ok: false, reason: "the last block was never closed with a REPLACE marker" };
  }

  return { ok: true, blocks };
}

/** Whether the output contains anything that looks like a patch at all. */
export function hasPatches(modelOutput: string): boolean {
  const parsed = parseBlocks(modelOutput);
  return parsed.ok && parsed.blocks.length > 0;
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
  const parsed = parseBlocks(modelOutput);

  if (!parsed.ok) {
    /* Nothing is applied and the reason is handed back for the retry to read.
       The search field is empty because there is no one block at fault — the
       reply as a whole did not parse. */
    return {
      html,
      applied: 0,
      failures: [{ reason: `the reply was not well-formed: ${parsed.reason}`, search: "" }],
    };
  }

  let current = html;
  let applied = 0;
  const failures: PatchFailure[] = [];

  for (const { search, replace } of parsed.blocks) {
    /* The guard that keeps the format's one unfixable failure out of the page.
       A replacement carrying a delimiter line would render as `=======` in the
       middle of someone's site and could never be edited out afterwards, so it
       is refused here whatever the model intended by it. */
    if (hasConflictMarkers(replace)) {
      failures.push({
        reason: "the replacement text contained an edit marker, which cannot be written into a page",
        search,
      });
      continue;
    }

    /* An empty SEARCH matches at position zero and would prepend the
       replacement to the document. Not an edit anyone asked for. */
    if (search === "") {
      failures.push({ reason: "the SEARCH text was empty", search });
      continue;
    }

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

export type RepairResult = {
  html: string;
  /** Marker lines removed. Zero means the page was already clean. */
  removed: number;
};

/**
 * Takes edit-format delimiters back out of a document.
 *
 * This exists because the model cannot do it. Asking for it produces a SEARCH
 * containing delimiters, which mis-parses into more delimiters, which is how a
 * page goes from one stray marker to eighteen across six attempts to clean it.
 * So it is arithmetic over lines here, costs nothing, calls nothing, and cannot
 * make the situation worse.
 *
 * Which side survives: the REPLACE half. Leaked markers are the wreckage of an
 * edit that was trying to happen, and the half after the divider is what the
 * edit was trying to say — keeping it is the difference between a page that
 * reads `$0` and one that reads the `₦0` the person actually asked for.
 *
 * What it will not do is guess backwards. A divider with no SEARCH marker above
 * it gives no way to know where the discarded half began, so the lines before
 * it are kept: at worst a line of content appears twice, which someone can see
 * and edit, whereas deleting it takes away content nobody agreed to lose.
 */
export function stripConflictMarkers(html: string): RepairResult {
  if (!hasConflictMarkers(html)) return { html, removed: 0 };

  const kept: string[] = [];
  let removed = 0;
  /* Inside the discarded half of a leaked block: after a SEARCH marker and
     before the divider that ends it. */
  let dropping = false;

  for (const line of html.split("\n")) {
    if (SEARCH_LINE.test(line)) {
      dropping = true;
      removed += 1;
      continue;
    }
    if (DIVIDER_LINE.test(line)) {
      dropping = false;
      removed += 1;
      continue;
    }
    if (REPLACE_LINE.test(line)) {
      /* The closing marker of a leaked block, or an orphan. Either way the line
         itself is never content. */
      dropping = false;
      removed += 1;
      continue;
    }
    if (!dropping) kept.push(line);
  }

  return { html: kept.join("\n"), removed };
}

/** The failures, written for the model to correct rather than for a person. */
export function describeFailures(failures: PatchFailure[]): string {
  return failures
    .map((failure, index) => {
      /* Only the first line of the SEARCH: enough to say which block is meant,
         short enough that a long failed patch does not crowd out the document
         it has to be corrected against. */
      const head = failure.search.split("\n")[0].slice(0, 120);
      return `${index + 1}. ${failure.reason}${head ? ` — block beginning: ${head}` : ""}`;
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
