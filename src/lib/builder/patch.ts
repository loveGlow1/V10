import type { ProjectFile } from "./store";

/* Applying an edit as search/replace blocks rather than as rewritten files.
 *
 * This is what makes "change the hero background" change the hero background
 * and nothing else: the model returns the lines it wants replaced and the lines
 * to put there, and every other byte of the project is carried across
 * untouched. A whole-file rewrite cannot make that promise — it reformats,
 * renames and drops things nobody asked about. */

export type PatchResult = {
  files: ProjectFile[];
  applied: string[];
  failures: { path: string; reason: string }[];
};

const BLOCK =
  /FILE:\s*(.+?)\r?\n<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;

const NEW_FILE = /NEW FILE:\s*(.+?)\r?\n```[a-zA-Z]*\r?\n([\s\S]*?)\r?\n```/g;

/**
 * Applies search/replace blocks. A SEARCH string that does not match exactly,
 * or matches in more than one place, is a hard failure — never fuzzy match,
 * never guess which one was meant. A wrong edit applied silently is worse than
 * an edit refused out loud.
 */
export function applyPatches(files: ProjectFile[], modelOutput: string): PatchResult {
  const map = new Map(files.map((file) => [file.path, file.content]));
  const applied: string[] = [];
  const failures: { path: string; reason: string }[] = [];

  let match: RegExpExecArray | null;

  // New files first: a block may then edit something created in the same turn.
  NEW_FILE.lastIndex = 0;
  while ((match = NEW_FILE.exec(modelOutput)) !== null) {
    const path = match[1].trim();
    map.set(path, match[2]);
    applied.push(path);
  }

  BLOCK.lastIndex = 0;
  while ((match = BLOCK.exec(modelOutput)) !== null) {
    const path = match[1].trim();
    const search = match[2];
    const replace = match[3];

    const current = map.get(path);
    if (current === undefined) {
      failures.push({ path, reason: "file not found in project" });
      continue;
    }
    const at = current.indexOf(search);
    if (at === -1) {
      failures.push({ path, reason: "SEARCH block did not match file content" });
      continue;
    }
    if (current.indexOf(search, at + 1) !== -1) {
      failures.push({ path, reason: "SEARCH block matched more than once" });
      continue;
    }
    map.set(path, current.slice(0, at) + replace + current.slice(at + search.length));
    applied.push(path);
  }

  return {
    files: Array.from(map, ([path, content]) => ({ path, content })),
    applied: Array.from(new Set(applied)),
    failures,
  };
}

/** Parses a full-project build response into files. */
export function parseFullBuild(modelOutput: string): ProjectFile[] {
  const out: ProjectFile[] = [];
  const re = /FILE:\s*(.+?)\r?\n```[a-zA-Z]*\r?\n([\s\S]*?)\r?\n```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(modelOutput)) !== null) {
    out.push({ path: match[1].trim(), content: match[2] });
  }
  return out;
}
