/* Visual edits: a change made by pointing at the preview, written straight
 * into the source.
 *
 * The preview tags every element it renders with where it was written —
 * `data-qs-src="app/page.tsx:42:6"`, see preview/runtime.ts — so a click knows
 * its file and line. Changing the words in a heading or the colour of a
 * button is then a precise edit to one element, not a request a model has to
 * interpret: it is instant, it costs nothing, and it cannot touch anything
 * else on the page.
 *
 * What is done here, without a model:
 *   TEXT      the words of an element whose children are only text
 *   CLASSES   one class per group — text colour, background, size, weight,
 *             padding, alignment, corners — swapped for another, on an element
 *             whose className is a plain string (or added where there is none)
 *   IMAGE     the src of an <img> written as a plain string
 *
 * Anything else — text built from data, a className assembled in code, a
 * request like "make this a carousel" — is answered `needsAi`, and the
 * workspace sends it to the ordinary edit path with the exact location.
 *
 * Pure and dependency-free, so the preview can run the same class logic to
 * show a change before it is applied, and so it can be tested offline. */

export type ClassGroup = "textColor" | "background" | "fontSize" | "fontWeight" | "padding" | "align" | "radius";

/* Which classes belong to which group. Base classes only: `md:text-lg` and
   `hover:bg-x` are somebody's responsive and interactive design and are left
   exactly as they are. */
const GROUPS: Record<ClassGroup, RegExp> = {
  textColor: /^text-(?:\[(?!length:)[^\]]+\]|(?:black|white|transparent|current|inherit)|[a-z]+-\d{2,3}(?:\/\d+)?)$/,
  background: /^bg-(?:\[[^\]]+\]|(?:black|white|transparent|current|inherit)|[a-z]+-\d{2,3}(?:\/\d+)?)$/,
  fontSize: /^text-(?:xs|sm|base|lg|xl|[2-9]xl|\[length:[^\]]+\])$/,
  fontWeight: /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
  padding: /^p-(?:\d+(?:\.5)?|px|\[[^\]]+\])$/,
  align: /^text-(?:left|center|right|justify|start|end)$/,
  radius: /^rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\]))?$/,
};

/** The class string with `value` in place of whatever that group had. */
export function applyClassChange(className: string, group: ClassGroup, value: string): string {
  const pattern = GROUPS[group];
  const kept = className.split(/\s+/).filter((name) => name && !pattern.test(name));
  return [...kept, ...(value ? [value] : [])].join(" ");
}

export type VisualChange = {
  text?: string;
  classes?: { group: ClassGroup; value: string }[];
  imageSrc?: string;
};

export type VisualEdit = {
  /** "path:line:col" from data-qs-src — line 1-based, col 0-based. */
  src: string;
  /** The element's tag, lower case. */
  tag: string;
  /** What the element looked like when it was clicked, to find it again if lines have moved. */
  className?: string;
  text?: string;
  change: VisualChange;
};

export type VisualResult =
  | { ok: true; source: string }
  | { ok: false; needsAi: true; reason: string };

export function parseSrc(src: string): { path: string; line: number; col: number } | null {
  const match = src.match(/^(.+):(\d+):(\d+)$/);
  if (!match) return null;
  return { path: match[1], line: Number(match[2]), col: Number(match[3]) };
}

/* ── Reading one element out of the source ─────────────────────────────── */

type Found = {
  start: number;
  /** Index of the `>` that ends the opening tag. */
  openEnd: number;
  selfClosing: boolean;
  /** A className written as a plain string: where its value sits. */
  className?: { valueStart: number; valueEnd: number; value: string } | "expression";
  src?: { valueStart: number; valueEnd: number; value: string } | "expression";
  /** Children that are only text: where they sit. */
  textChildren?: { start: number; end: number; value: string };
};

/* The end of the opening tag that starts at `start`, minding quotes and the
   braces of expressions, so `onClick={() => a > b}` is not its end. */
function readOpening(source: string, start: number): { end: number; selfClosing: boolean } | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return { end: i, selfClosing: source[i - 1] === "/" };
  }
  return null;
}

/* An attribute's value inside an opening tag: a plain string (in quotes, or
   a string literal in braces) with its position, or "expression". */
function readAttribute(source: string, from: number, to: number, name: string): Found["className"] {
  const opening = source.slice(from, to);
  const at = new RegExp(`\\s${name}\\s*=\\s*`).exec(opening);
  if (!at) return undefined;
  let i = from + at.index + at[0].length;
  const quoted = source[i];
  if (quoted === "{") {
    const inner = /^\{\s*(["'])/.exec(source.slice(i, i + 8));
    if (!inner) return "expression";
    const literalStart = i + inner[0].length;
    const close = source.indexOf(inner[1], literalStart);
    if (close < 0 || !/^\s*\}/.test(source.slice(close + 1, close + 4))) return "expression";
    return { valueStart: literalStart, valueEnd: close, value: source.slice(literalStart, close) };
  }
  if (quoted !== '"' && quoted !== "'") return "expression";
  i += 1;
  const close = source.indexOf(quoted, i);
  if (close < 0 || close > to) return "expression";
  return { valueStart: i, valueEnd: close, value: source.slice(i, close) };
}

function readElement(source: string, start: number, tag: string): Found | null {
  const opening = readOpening(source, start);
  if (!opening) return null;
  const found: Found = { start, openEnd: opening.end, selfClosing: opening.selfClosing };
  found.className = readAttribute(source, start, opening.end, "className");
  if (tag === "img") found.src = readAttribute(source, start, opening.end, "src");
  if (!opening.selfClosing) {
    const rest = opening.end + 1;
    const next = source.slice(rest).search(/[<{]/);
    if (next >= 0) {
      const at = rest + next;
      if (source.startsWith(`</${tag}`, at) && source.slice(rest, at).trim().length > 0) {
        found.textChildren = { start: rest, end: at, value: source.slice(rest, at) };
      }
    }
  }
  return found;
}

const decode = (text: string) =>
  text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
const squash = (text: string) => decode(text).replace(/\s+/g, " ").trim();

/**
 * The element the click meant. The line it reported first; when the source
 * has moved under it, the one of the same tag whose classes or words match
 * what was clicked. Refused rather than guessed when two fit equally.
 */
export function locateElement(source: string, edit: Pick<VisualEdit, "src" | "tag" | "className" | "text">): Found | null {
  const where = parseSrc(edit.src);
  if (!where || !/^[a-z][a-z0-9-]*$/.test(edit.tag)) return null;
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (index: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };

  /* Evidence, strongest first: the exact place, the same line, the same
     classes, the same words — and nearness only to break a tie between
     candidates that share the rest. One with no evidence at all is never
     chosen, however near it is. */
  const candidates: { found: Found; score: number; evidence: boolean }[] = [];
  const opener = new RegExp(`<${edit.tag}(?=[\\s/>])`, "g");
  for (const match of source.matchAll(opener)) {
    const found = readElement(source, match.index as number, edit.tag);
    if (!found) continue;
    const line = lineOf(found.start);
    const col = found.start - lineStarts[line - 1];
    const sameLine = line === where.line;
    const sameClasses = edit.className !== undefined && typeof found.className === "object" && squash(found.className.value) === squash(edit.className);
    const sameWords = Boolean(edit.text) && Boolean(found.textChildren) && squash(found.textChildren!.value) === squash(edit.text!);
    let score = 0;
    if (sameLine) score += col === where.col ? 40 : 24;
    if (sameClasses) score += 12;
    if (sameWords) score += 12;
    score -= Math.min(6, Math.abs(line - where.line)) / 2;
    candidates.push({ found, score, evidence: sameLine || sameClasses || sameWords });
  }
  candidates.sort((a, b) => b.score - a.score);
  const [best, next] = candidates;
  if (!best || !best.evidence) return null;
  if (next && next.score === best.score) return null;
  return best.found;
}

/* Words as JSX text, or as a string expression when they hold a character
   JSX would read as markup. The whitespace around the old words is kept, so
   the file's layout does not change. */
function asJsxText(old: string, words: string): string {
  const lead = old.match(/^\s*/)?.[0] ?? "";
  const trail = old.match(/\s*$/)?.[0] ?? "";
  const body = /[{}<>&]/.test(words) || words.trim() !== words ? `{${JSON.stringify(words)}}` : words;
  return `${lead}${body}${trail}`;
}

/** One edit applied to one file's source, or why it needs the model instead. */
export function applyVisualEdit(source: string, edit: VisualEdit): VisualResult {
  const found = locateElement(source, edit);
  if (!found) return { ok: false, needsAi: true, reason: "the element could not be found in its file" };

  /* Collected as [start, end, replacement] and applied last-first, so one
     change does not move the positions of another. */
  const splices: [number, number, string][] = [];
  const { text, classes, imageSrc } = edit.change;

  if (text !== undefined) {
    if (!found.textChildren) return { ok: false, needsAi: true, reason: "its words come from code or data, not from the page" };
    splices.push([found.textChildren.start, found.textChildren.end, asJsxText(found.textChildren.value, text)]);
  }

  if (classes && classes.length > 0) {
    if (found.className === "expression") return { ok: false, needsAi: true, reason: "its classes are built in code" };
    if (found.className) {
      let value = found.className.value;
      for (const change of classes) value = applyClassChange(value, change.group, change.value);
      if (/["'`]/.test(value)) return { ok: false, needsAi: true, reason: "the new class would break its quotes" };
      splices.push([found.className.valueStart, found.className.valueEnd, value]);
    } else {
      let value = "";
      for (const change of classes) value = applyClassChange(value, change.group, change.value);
      const afterTag = found.start + 1 + edit.tag.length;
      splices.push([afterTag, afterTag, ` className="${value.replace(/"/g, "")}"`]);
    }
  }

  if (imageSrc !== undefined) {
    if (edit.tag !== "img") return { ok: false, needsAi: true, reason: "only a picture has an image to swap" };
    if (!/^(?:https:\/\/|\/)[^\s"'`<>{}]+$/.test(imageSrc)) return { ok: false, needsAi: true, reason: "that is not an https address" };
    if (found.src === "expression") return { ok: false, needsAi: true, reason: "its picture is chosen in code" };
    if (found.src) splices.push([found.src.valueStart, found.src.valueEnd, imageSrc]);
    else {
      const afterTag = found.start + 4;
      splices.push([afterTag, afterTag, ` src="${imageSrc}"`]);
    }
  }

  if (splices.length === 0) return { ok: true, source };
  let out = source;
  for (const [start, end, replacement] of splices.sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, start) + replacement + out.slice(end);
  }
  return { ok: true, source: out };
}

/** What a change is, in words for the version history and the chat. */
export function describeChange(edit: VisualEdit): string {
  const parts: string[] = [];
  if (edit.change.text !== undefined) parts.push(`text → "${edit.change.text.slice(0, 40)}"`);
  for (const change of edit.change.classes ?? []) parts.push(`${change.group} → ${change.value || "none"}`);
  if (edit.change.imageSrc) parts.push("image swapped");
  return `<${edit.tag}> in ${parseSrc(edit.src)?.path ?? "?"}: ${parts.join(", ")}`;
}
