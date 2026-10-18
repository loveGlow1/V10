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
  /* Take the element out altogether. */
  remove?: boolean;
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
  if (edit.change.remove) parts.push("removed");
  return `<${edit.tag}> in ${parseSrc(edit.src)?.path ?? "?"}: ${parts.join(", ")}`;
}

/* ── Typed straight into a single page ──────────────────────────────────
 *
 * A single-page build is one HTML document, tagged for the preview by
 * tagSourceLines with `index.html:line:col` — col 1-based, at the element's
 * `<`. Typing into a heading in the preview lands here: the element is found
 * at exactly that place (or, if the page has moved under it, the one element
 * of that tag on that line still holding the old words), its text — and only
 * its text — is replaced, escaped for HTML. Refused rather than guessed when
 * the element holds anything but text or the old words are not there. Pure. */
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function applySinglePageText(
  html: string,
  edit: { src: string; tag: string; before: string; text: string },
): VisualResult {
  const where = parseSrc(edit.src);
  const tag = edit.tag.toLowerCase();
  if (!where || !/^[a-z][a-z0-9-]*$/.test(tag)) return { ok: false, needsAi: true, reason: "the element could not be placed" };
  const words = edit.text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
  if (!words) return { ok: false, needsAi: true, reason: "the text is empty" };

  const lineStarts = [0];
  for (let i = 0; i < html.length; i += 1) if (html.charCodeAt(i) === 10) lineStarts.push(i + 1);
  if (where.line < 1 || where.line > lineStarts.length) return { ok: false, needsAi: true, reason: "the page has changed" };
  const lineStart = lineStarts[where.line - 1];
  const lineEnd = where.line < lineStarts.length ? lineStarts[where.line] : html.length;

  const opensHere = (at: number) => html.slice(at, at + tag.length + 2).toLowerCase().match(new RegExp(`^<${tag}[\\s>/]`)) !== null;
  const textOf = (at: number) => {
    const opening = readOpening(html, at);
    if (!opening || opening.selfClosing) return null;
    const close = html.toLowerCase().indexOf(`</${tag}`, opening.end + 1);
    if (close < 0) return null;
    const inner = html.slice(opening.end + 1, close);
    if (inner.includes("<")) return null;
    return { start: opening.end + 1, end: close, inner };
  };
  const before = squash(edit.before);
  const matches = (found: { inner: string } | null) => found !== null && (!before || squash(found.inner) === before);

  let found: ReturnType<typeof textOf> = null;
  const exact = lineStart + where.col - 1;
  if (opensHere(exact) && matches(textOf(exact))) found = textOf(exact);
  if (!found) {
    const candidates: NonNullable<ReturnType<typeof textOf>>[] = [];
    for (let at = html.indexOf("<", lineStart); at >= 0 && at < lineEnd; at = html.indexOf("<", at + 1)) {
      if (!opensHere(at)) continue;
      const one = textOf(at);
      if (one && matches(one)) candidates.push(one);
    }
    /* The page moved under it — the agent changed something above, say: the
       one element of that tag anywhere still holding the old words. */
    if (candidates.length === 0 && before) {
      for (let at = html.indexOf("<"); at >= 0; at = html.indexOf("<", at + 1)) {
        if (!opensHere(at)) continue;
        const one = textOf(at);
        if (one && matches(one)) candidates.push(one);
        if (candidates.length > 1) break;
      }
    }
    if (candidates.length !== 1) return { ok: false, needsAi: true, reason: "the element could not be found as it was" };
    found = candidates[0];
  }
  if (!found) return { ok: false, needsAi: true, reason: "the element holds more than text" };

  /* Keep the whitespace around the words exactly as it was written. */
  const lead = found.inner.match(/^\s*/)?.[0] ?? "";
  const trail = found.inner.match(/\s*$/)?.[0] ?? "";
  return { ok: true, source: html.slice(0, found.start) + lead + escapeHtml(words) + trail + html.slice(found.end) };
}

/* ── A style picked in the preview, on a single page ────────────────────
 *
 * Colour, size, weight, alignment chosen from the editor's quick controls:
 * one class per group swapped in the element's class attribute (Tailwind,
 * which single pages are built with), or a class attribute added where there
 * is none. Found the way typed words are — at its line and column, else the
 * one element of that tag on the line (then anywhere) with the same classes
 * — and refused rather than guessed. Pure. */
export function applySinglePageClasses(
  html: string,
  edit: { src: string; tag: string; className: string; classes: { group: ClassGroup; value: string }[] },
): VisualResult {
  const where = parseSrc(edit.src);
  const tag = edit.tag.toLowerCase();
  if (!where || !/^[a-z][a-z0-9-]*$/.test(tag)) return { ok: false, needsAi: true, reason: "the element could not be placed" };
  if (!edit.classes.length) return { ok: true, source: html };

  const lineStarts = [0];
  for (let i = 0; i < html.length; i += 1) if (html.charCodeAt(i) === 10) lineStarts.push(i + 1);
  if (where.line < 1 || where.line > lineStarts.length) return { ok: false, needsAi: true, reason: "the page has changed" };
  const lineStart = lineStarts[where.line - 1];
  const lineEnd = where.line < lineStarts.length ? lineStarts[where.line] : html.length;

  const norm = (value: string) => value.split(/\s+/).filter(Boolean).sort().join(" ");
  const want = norm(edit.className);
  const opensHere = (at: number) => new RegExp(`^<${tag}[\\s>/]`, "i").test(html.slice(at, at + tag.length + 2));
  const read = (at: number) => {
    const opening = readOpening(html, at);
    if (!opening) return null;
    const attr = readAttribute(html, at, opening.end, "class");
    if (attr === "expression") return null;
    return { at, end: opening.end, attr };
  };
  const fits = (one: ReturnType<typeof read>) => one !== null && norm(one.attr ? one.attr.value : "") === want;

  let found: ReturnType<typeof read> = null;
  const exact = lineStart + where.col - 1;
  if (opensHere(exact) && fits(read(exact))) found = read(exact);
  if (!found) {
    const scan = (from: number, to: number) => {
      const out: NonNullable<ReturnType<typeof read>>[] = [];
      for (let at = html.indexOf("<", from); at >= 0 && at < to; at = html.indexOf("<", at + 1)) {
        if (!opensHere(at)) continue;
        const one = read(at);
        if (one && fits(one)) out.push(one);
        if (out.length > 1) break;
      }
      return out;
    };
    let candidates = scan(lineStart, lineEnd);
    if (candidates.length === 0 && want) candidates = scan(0, html.length);
    if (candidates.length !== 1) return { ok: false, needsAi: true, reason: "the element could not be found as it was" };
    found = candidates[0];
  }
  if (!found) return { ok: false, needsAi: true, reason: "the element could not be found as it was" };

  let value = found.attr ? found.attr.value : "";
  for (const change of edit.classes) value = applyClassChange(value, change.group, change.value);
  if (/["'<>]/.test(value)) return { ok: false, needsAi: true, reason: "the new class would break the page" };
  if (found.attr) return { ok: true, source: html.slice(0, found.attr.valueStart) + value + html.slice(found.attr.valueEnd) };
  const afterTag = found.at + 1 + tag.length;
  return { ok: true, source: html.slice(0, afterTag) + ` class="${value}"` + html.slice(afterTag) };
}

/* ── Removing what was picked, on a single page ─────────────────────────
 *
 * "Remove it" is not a request a model needs to interpret: the element is
 * known to the line and column. Its whole extent — opening tag to the
 * matching close, nested elements of the same tag counted — is cut, and the
 * lines it stood on go with it when nothing else was written on them.
 *
 * Refused (needsAi, so the agent does it and tidies up) when something left
 * on the page still uses an id inside it — a script's getElementById, a
 * selector, a link to it — because cutting it by hand would break that
 * silently. Also refused for the page's frame (html, head, body) and for
 * anything holding a script. Pure. */
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/* Where the element that opens at `start` ends (exclusive), or null. */
function elementEnd(html: string, start: number, tag: string): number | null {
  const opening = readOpening(html, start);
  if (!opening) return null;
  if (opening.selfClosing || VOID_TAGS.has(tag)) return opening.end + 1;
  const pattern = new RegExp(`<(/?)${tag}(?=[\\s>/])`, "gi");
  pattern.lastIndex = opening.end + 1;
  let depth = 1;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    if (match[1]) {
      depth -= 1;
      if (depth === 0) {
        const close = html.indexOf(">", match.index);
        return close < 0 ? null : close + 1;
      }
    } else {
      const inner = readOpening(html, match.index);
      if (inner && !inner.selfClosing) depth += 1;
      if (inner) pattern.lastIndex = inner.end + 1;
    }
  }
  return null;
}

/** Ids inside `fragment` that something in `rest` still uses. Pure. */
export function idsStillUsed(fragment: string, rest: string): string[] {
  const ids = [...fragment.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  const scripts = [...rest.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).join("\n");
  const esc = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return ids.filter((id) => {
    const e = esc(id);
    return (
      new RegExp(`getElementById\\(\\s*["'\`]${e}["'\`]`).test(scripts) ||
      new RegExp(`#${e}(?![\\w-])`).test(scripts) ||
      new RegExp(`href\\s*=\\s*["']#${e}["']`, "i").test(rest)
    );
  });
}

export function applySinglePageRemove(
  html: string,
  edit: { src: string; tag: string; className: string; text: string },
): VisualResult {
  const where = parseSrc(edit.src);
  const tag = edit.tag.toLowerCase();
  if (!where || !/^[a-z][a-z0-9-]*$/.test(tag)) return { ok: false, needsAi: true, reason: "the element could not be placed" };
  if (tag === "html" || tag === "head" || tag === "body") return { ok: false, needsAi: true, reason: "that is the page itself" };

  const lineStarts = [0];
  for (let i = 0; i < html.length; i += 1) if (html.charCodeAt(i) === 10) lineStarts.push(i + 1);
  if (where.line < 1 || where.line > lineStarts.length) return { ok: false, needsAi: true, reason: "the page has changed" };
  const lineStart = lineStarts[where.line - 1];
  const lineEnd = where.line < lineStarts.length ? lineStarts[where.line] : html.length;

  const norm = (value: string) => value.split(/\s+/).filter(Boolean).sort().join(" ");
  const want = norm(edit.className);
  const words = squash(edit.text).slice(0, 40);
  const opensHere = (at: number) => new RegExp(`^<${tag}[\\s>/]`, "i").test(html.slice(at, at + tag.length + 2));
  const read = (at: number) => {
    const opening = readOpening(html, at);
    if (!opening) return null;
    const end = elementEnd(html, at, tag);
    if (end === null) return null;
    const attr = readAttribute(html, at, opening.end, "class");
    if (attr === "expression") return null;
    return { at, end, className: attr ? attr.value : "" };
  };
  const fits = (one: ReturnType<typeof read>) => {
    if (!one || norm(one.className) !== want) return false;
    if (!words) return true;
    return squash(html.slice(one.at, one.end).replace(/<[^>]*>/g, " ")).startsWith(words);
  };

  let found: ReturnType<typeof read> = null;
  const exact = lineStart + where.col - 1;
  if (opensHere(exact) && fits(read(exact))) found = read(exact);
  if (!found) {
    const scan = (from: number, to: number) => {
      const out: NonNullable<ReturnType<typeof read>>[] = [];
      for (let at = html.indexOf("<", from); at >= 0 && at < to; at = html.indexOf("<", at + 1)) {
        if (!opensHere(at)) continue;
        const one = read(at);
        if (one && fits(one)) out.push(one);
        if (out.length > 1) break;
      }
      return out;
    };
    let candidates = scan(lineStart, lineEnd);
    if (candidates.length === 0 && (want || words)) candidates = scan(0, html.length);
    if (candidates.length !== 1) return { ok: false, needsAi: true, reason: "the element could not be found as it was" };
    found = candidates[0];
  }
  if (!found) return { ok: false, needsAi: true, reason: "the element could not be found as it was" };

  const fragment = html.slice(found.at, found.end);
  if (/<script\b/i.test(fragment)) return { ok: false, needsAi: true, reason: "it holds a script" };

  /* Whole lines when the element had them to itself. */
  let cutStart = found.at;
  let cutEnd = found.end;
  const before = html.lastIndexOf("\n", cutStart - 1) + 1;
  const afterNewline = html.indexOf("\n", cutEnd);
  const after = afterNewline < 0 ? html.length : afterNewline + 1;
  if (/^[ \t]*$/.test(html.slice(before, cutStart)) && /^[ \t]*\r?\n?$/.test(html.slice(cutEnd, after))) {
    cutStart = before;
    cutEnd = after;
  }
  const rest = html.slice(0, cutStart) + html.slice(cutEnd);
  const used = idsStillUsed(fragment, rest);
  /* A script that finds it by its tag alone — form.querySelector('button')
     — would break as silently as one that finds it by id. */
  const scripts = [...rest.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).join("\n");
  if (new RegExp(`querySelector(?:All)?\\(\\s*["'\`]${tag}["'\`]\\s*\\)|getElementsByTagName\\(\\s*["'\`]${tag}["'\`]`, "i").test(scripts)) used.push(tag);
  if (used.length) return { ok: false, needsAi: true, reason: `a script or link on the page still uses ${used.map((id) => (id === tag ? `<${tag}>` : `#${id}`)).join(", ")}` };
  /* A field's own label goes with it, rather than labelling nothing. */
  let source = rest;
  for (const match of fragment.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)) {
    const id = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    source = source.replace(new RegExp(`(^|\\n)[ \\t]*<label\\b[^>]*\\sfor\\s*=\\s*["']${id}["'][^>]*>[^<]*</label>[ \\t]*(?=\\r?\\n|$)\\r?\\n?`, "i"), "$1");
  }
  return { ok: true, source };
}
