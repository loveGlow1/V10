/* "Use this as the logo" — done by hand, not by a model.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Swapping a logo is the commonest edit there is and it was the one most
 * likely to fail. On a single page it went through a model call that had to
 * find the mark, write a patch around it and place an attachment token — a
 * minute or more for a change with exactly one right answer, cut off at the
 * time limit with a picture attached. On a project it could not work at all:
 * the source-edit path never passes attachments to the model, so "update the
 * logo" with the logo attached was asked of a model that had never seen it,
 * and came back four times as "I couldn't place that change in
 * components/Logo.tsx".
 *
 * Nothing about it needs judgement. The logo is the element called logo or
 * brand in the header, the nav, the footer and the mobile menu — or, failing a
 * name, the link home at the top of the page. This finds every one of those,
 * swaps the uploaded picture in at a sensible height, and leaves every other
 * byte of the page alone. Seconds, no model, nothing to time out.
 *
 * ── What it deliberately does not touch ─────────────────────────────────────
 *
 * The OTHER logos. "Trusted by" strips, client walls, partner grids and
 * sponsor marquees are full of elements called logo, and replacing all of them
 * with the customer's own mark is the worst outcome available. Anything whose
 * name says plural, clients, partners, sponsors or a logo grid is skipped, and
 * so is anything outside the page's chrome.
 *
 * And requests that are about the logo but are not a swap — "make the logo
 * bigger", "move it left", "change its colour" — go to the model as before,
 * which can do those and this cannot. */

/** The name a logo element carries, in a class, id, alt or label. */
const LOGO_NAME = /logo|brand|wordmark|logotype/i;

/* Elements named like a logo that are somebody else's logo. */
const OTHER_LOGOS =
  /logos|logo-?(cloud|grid|wall|strip|row|list|bar|carousel|marquee|ticker)|clients?|customers?|partners?|sponsors?|brands\b|trusted|as-?seen|featured|press|marquee|ticker/i;

/* Where a site's own logo lives. */
const CHROME_TAGS = ["header", "nav", "footer"] as const;
const MENU_NAME = /mobile-?(menu|nav)|drawer|offcanvas|off-canvas|side-?menu|menu-?panel/i;

/* Elements a logo is drawn as, or wrapped in. */
const LOGO_TAGS = /^(a|div|span|img|svg|picture|figure|p|h1|h2|strong|b|i|em|button|Link)$/;
const WRAPPERS = /^(a|div|span|p|h1|h2|strong|b|i|em|button|figure|Link)$/;
const VOID = /^(img|br|hr|input|meta|link|source)$/i;

/* A link to the top of the site: the logo, when nothing is named as one. */
const HOME_HREF = /^\s*(\/|#|#top|#home|#hero|\.\/|index\.html?|\/#|\/index\.html?)\s*$/i;

const LOGO = /\b(logo|logos|brand ?mark|brandmark|wordmark|logotype|site icon|favicon)\b/i;
const SWAP_VERB =
  /\b(update|change|replace|swap|switch|use|put|set|add|upload(ed)?|insert|apply|attach(ed)?|new|this|my|our|instead|with)\b/i;
/* About the logo, but not a swap: these need the model. */
const NOT_A_SWAP =
  /\b(bigger|smaller|larger|resize|size|shrink|enlarge|move|align|cent(er|re)|left|right|spacing|margin|padding|position|colou?r|animate|animation|hover|remove|delete|hide|round(ed)?|shadow|border)\b/i;

/**
 * Whether this message asks for an attached picture to become the logo.
 *
 * Needs a picture, a logo and a verb that means "this one instead". A size or
 * position word on its own sends it to the model — but "replace the logo with
 * this, it's too big" is still a swap, so an explicit replace wins.
 */
export function asksForLogoSwap(message: string, imageCount: number): boolean {
  if (imageCount < 1) return false;
  const m = message.toLowerCase();
  if (!LOGO.test(m)) return false;
  if (!SWAP_VERB.test(m)) return false;
  if (NOT_A_SWAP.test(m) && !/\b(replace|swap|use this|use my|new logo|this logo|my logo|our logo)\b/.test(m)) {
    return false;
  }
  return true;
}

type Element = {
  tag: string;
  start: number;
  /** Index just past the opening tag. */
  openEnd: number;
  /** Index of the closing tag, or openEnd for a void or self-closed one. */
  closeStart: number;
  /** Index just past the whole element. */
  end: number;
  open: string;
};

/* Every opening tag in a document, in order. Attribute values may hold `>`
   inside quotes or JSX braces, so the scan respects both. */
function openings(source: string): Element[] {
  const found: Element[] = [];
  const re = /<([A-Za-z][\w.]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const start = match.index;
    const openEnd = tagEnd(source, start + match[0].length);
    if (openEnd === -1) break;
    const open = source.slice(start, openEnd);
    const tag = match[1];
    const selfClosed = /\/\s*>$/.test(open) || VOID.test(tag);
    let closeStart = openEnd;
    let end = openEnd;
    if (!selfClosed) {
      const closing = closeOf(source, tag, openEnd);
      if (closing) {
        closeStart = closing.start;
        end = closing.end;
      }
    }
    found.push({ tag, start, openEnd, closeStart, end, open });
    re.lastIndex = openEnd;
  }
  return found;
}

function tagEnd(source: string, from: number): number {
  let quote: string | null = null;
  let braces = 0;
  for (let i = from; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") braces += 1;
    else if (c === "}") braces = Math.max(0, braces - 1);
    else if (c === ">" && braces === 0) return i + 1;
  }
  return -1;
}

/* The matching close tag, counting nested elements of the same name. */
function closeOf(source: string, tag: string, from: number): { start: number; end: number } | null {
  const re = new RegExp(`<(/?)${tag.replace(".", "\\.")}\\b[^>]*?(/?)>`, "g");
  re.lastIndex = from;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    if (match[1] === "/") {
      depth -= 1;
      if (depth === 0) return { start: match.index, end: match.index + match[0].length };
    } else if (match[2] !== "/") {
      depth += 1;
    }
  }
  return null;
}

/* The words an element is named by: class, className, id, alt, aria-label,
   title, data-*. */
function namesOf(open: string): string {
  const names: string[] = [];
  const quoted = /\b(class|className|id|alt|aria-label|title|data-[\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*[`"']([^`"']*)[`"']\s*\})/g;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(open))) names.push(match[2] ?? match[3] ?? match[4] ?? "");
  return names.join(" ");
}

function hrefOf(open: string): string | null {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/.exec(open);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function textOf(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export type LogoSwap = {
  /** The source with the logo swapped in. */
  source: string;
  /** How many places it went. */
  swapped: number;
  /** Where, in words: "header", "footer", "mobile menu", "browser tab". */
  where: string[];
};

/**
 * Puts `src` in place of the site's own logo, everywhere it appears in the
 * page's chrome. Null when no logo could be found with confidence — the
 * caller then lets the model try, rather than this guessing.
 *
 * `jsx` writes the replacement as JSX (className, style object, self-closed)
 * for a .tsx component; otherwise HTML. `maxCopies` bounds how many times the
 * picture is written into the file, because each copy carries the whole image.
 */
export function swapLogo(
  source: string,
  src: string,
  options: { jsx?: boolean; maxCopies?: number; brand?: string | null; favicon?: boolean } = {},
): LogoSwap | null {
  const all = openings(source);
  const maxCopies = Math.max(1, options.maxCopies ?? 4);

  /* The chrome: header, nav, footer, and anything named as a mobile menu. */
  const regions = all
    .filter((el) => (CHROME_TAGS as readonly string[]).includes(el.tag.toLowerCase()) || MENU_NAME.test(namesOf(el.open)))
    .map((el) => ({ start: el.start, end: el.end, label: regionLabel(el) }));
  const regionOf = (el: Element) => regions.find((region) => el.start >= region.start && el.end <= region.end) ?? null;

  /* Named as a logo, in the chrome, and not somebody else's. */
  let candidates = all.filter((el) => {
    if (!LOGO_TAGS.test(el.tag)) return false;
    const names = namesOf(el.open);
    if (!LOGO_NAME.test(names) || OTHER_LOGOS.test(names)) return false;
    /* Inside a region named as other people's logos is not ours either. */
    const inOthers = all.some(
      (outer) => outer.start < el.start && outer.end >= el.end && OTHER_LOGOS.test(namesOf(outer.open)),
    );
    if (inOthers) return false;
    return regionOf(el) !== null || isHomeLink(el);
  });

  /* Nothing named: the link home, first in the header or nav. */
  if (candidates.length === 0) {
    const home = all.find((el) => isHomeLink(el) && regionOf(el) !== null && regionOf(el)!.label !== "footer");
    if (home) candidates = [home];
  }
  if (candidates.length === 0) return null;

  /* The outermost of nested matches: `<a class="logo"><svg class="logo-mark">`
     is one logo, swapped once, at the link. */
  const outermost = candidates.filter(
    (el) => !candidates.some((other) => other !== el && other.start <= el.start && other.end >= el.end && other.start !== el.start),
  );

  const brand = (options.brand ?? "").trim() || brandFrom(source, outermost);
  const alt = brand ? `${brand} logo` : "Logo";

  const chosen = outermost.slice(0, maxCopies);
  const where: string[] = [];

  /* Applied back to front, so earlier indices stay valid. */
  let out = source;
  for (const el of [...chosen].sort((a, b) => b.start - a.start)) {
    const region = regionOf(el);
    const label = region?.label ?? "header";
    const height = label === "footer" ? 32 : 36;
    out = out.slice(0, el.start) + replacement(out, el, src, alt, height, options.jsx === true) + out.slice(el.end);
    where.unshift(label);
  }

  /* The browser tab, on a page: the same picture as the favicon. Only when it
     is small enough not to double the weight of the page. */
  if (!options.jsx && options.favicon !== false) {
    const withIcon = setFavicon(out, src);
    if (withIcon !== out) {
      out = withIcon;
      where.push("browser tab");
    }
  }

  return { source: out, swapped: chosen.length, where: [...new Set(where)] };
}

function regionLabel(el: Element): string {
  const tag = el.tag.toLowerCase();
  if (tag === "footer") return "footer";
  if (MENU_NAME.test(namesOf(el.open))) return "mobile menu";
  return "header";
}

function isHomeLink(el: Element): boolean {
  if (el.tag !== "a" && el.tag !== "Link") return false;
  const href = hrefOf(el.open);
  return href !== null && HOME_HREF.test(href);
}

/* What the logo said, for the alt text: the words inside the first logo, or
   the page title before its separator. */
function brandFrom(source: string, logos: Element[]): string {
  for (const el of logos) {
    const words = textOf(source.slice(el.openEnd, el.closeStart));
    if (words && words.length <= 60) return words;
  }
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(source)?.[1] ?? "";
  return title.split(/\s[|—–-]\s/)[0]?.trim() ?? "";
}

function replacement(source: string, el: Element, src: string, alt: string, height: number, jsx: boolean): string {
  const open = el.open;
  const isImg = /^img$/i.test(el.tag);

  /* An <img> already: only its picture changes, so its own sizing stays. */
  if (isImg) {
    let next = open.replace(/\s+srcSet\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')|\s+srcset\s*=\s*("[^"]*"|'[^']*')/g, "");
    const srcAttr = jsx ? `src="${escapeAttribute(src)}"` : `src="${escapeAttribute(src)}"`;
    next = /\bsrc\s*=/.test(next)
      ? next.replace(/\bsrc\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')/, srcAttr)
      : next.replace(/^<img\b/i, `<img ${srcAttr}`);
    if (!/\balt\s*=/.test(next)) next = next.replace(/^<img\b/i, `<img alt="${escapeAttribute(alt)}"`);
    return next;
  }

  const img = imageTag(src, alt, height, jsx, classOf(open, jsx));

  /* A wrapper — the link, the div, the span — keeps its tag, so the link still
     goes home and the layout around it still holds; what was inside it is the
     old logo, and the picture replaces it. */
  if (WRAPPERS.test(el.tag) && el.closeStart > el.openEnd) {
    return open + imageTag(src, alt, height, jsx, null) + source.slice(el.closeStart, el.end);
  }

  /* A drawn mark — an <svg>, a <picture> — is replaced outright, keeping its
     classes so whatever positioned it positions the picture. */
  return img;
}

function classOf(open: string, jsx: boolean): string | null {
  const match = jsx
    ? /\bclassName\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*[`"']([^`"']*)[`"']\s*\})/.exec(open)
    : /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(open);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

function imageTag(src: string, alt: string, height: number, jsx: boolean, className: string | null): string {
  const cls = className ? (jsx ? ` className="${escapeAttribute(className)}"` : ` class="${escapeAttribute(className)}"`) : "";
  if (jsx) {
    return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}"${cls} style={{ height: ${height}, width: "auto", maxWidth: 220, display: "block", objectFit: "contain" }} data-qs-logo="" />`;
  }
  return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}"${cls} style="height:${height}px;width:auto;max-width:220px;display:block;object-fit:contain" data-qs-logo>`;
}

function setFavicon(html: string, src: string): string {
  if (!/<head\b/i.test(html)) return html;
  const link = `<link rel="icon" href="${escapeAttribute(src)}">`;
  const existing = /<link\b[^>]*\brel\s*=\s*["'](?:shortcut\s+)?icon["'][^>]*>/i;
  if (existing.test(html)) return html.replace(existing, link);
  return html.replace(/<\/head>/i, `${link}\n</head>`);
}

/* ── Projects ──────────────────────────────────────────────────────────────── */

type File = { path: string; content: string };

/* A component that IS the logo, by its file name. */
const LOGO_FILE = /(^|\/)(logo|brand|brandmark|brand-mark|wordmark|site-?logo)[^/]*\.(tsx|jsx)$/i;
/* The chrome, where a logo is drawn inline when it has no component. */
const CHROME_FILE = /(^|\/)(header|navbar|nav|site-?header|top-?bar|footer|site-?footer|mobile-?(menu|nav))[^/]*\.(tsx|jsx)$/i;

export type TreeLogoSwap = { files: File[]; paths: string[]; where: string[] };

/**
 * The same swap across a project. A logo component is rewritten to draw the
 * picture — every place that imports it changes with it — and a header or
 * footer that draws its logo inline has that element swapped. Null when no
 * logo was found in either, so the caller can say so rather than guess.
 */
export function swapLogoInTree(tree: File[], src: string, brand?: string | null): TreeLogoSwap | null {
  const changed: File[] = [];
  const where: string[] = [];

  for (const file of tree) {
    if (LOGO_FILE.test(file.path) && !/\.(test|spec|stories)\./.test(file.path)) {
      changed.push({ path: file.path, content: logoComponent(file, src, brand) });
      where.push("logo component");
    }
  }

  /* Inline logos in the chrome, for a project with no logo component — or
     one whose header draws a second mark of its own. */
  for (const file of tree) {
    if (!CHROME_FILE.test(file.path) || changed.some((done) => done.path === file.path)) continue;
    /* A chrome file that renders the Logo component is already covered. */
    if (changed.length > 0 && /<Logo\b|<Brand\b|<BrandMark\b|<Wordmark\b/.test(file.content)) continue;
    const swap = swapLogo(file.content, src, { jsx: true, maxCopies: 2, brand, favicon: false });
    if (swap) {
      changed.push({ path: file.path, content: swap.source });
      where.push(...swap.where);
    }
  }

  if (changed.length === 0) return null;
  return { files: changed, paths: changed.map((file) => file.path), where: [...new Set(where)] };
}

/* The logo component, rewritten to draw the uploaded picture. Its exported
   name and export style are kept, so every import of it still resolves, and it
   still takes a className so every place that sized it still sizes it. */
function logoComponent(file: File, src: string, brand?: string | null): string {
  const source = file.content;
  const named = /export\s+(?:default\s+)?function\s+([A-Z]\w*)/.exec(source)?.[1]
    ?? /export\s+const\s+([A-Z]\w*)\s*=/.exec(source)?.[1]
    ?? /function\s+([A-Z]\w*)/.exec(source)?.[1]
    ?? "Logo";
  const hasDefault = /export\s+default\b/.test(source);
  const hasNamed = new RegExp(`export\\s+(?:function|const)\\s+${named}\\b`).test(source) || /export\s*\{/.test(source);
  const alt = escapeAttribute(brand ? `${brand} logo` : "Logo");
  const client = /^\s*["']use client["']/.test(source) ? `"use client";\n\n` : "";

  return `${client}/* The logo, as uploaded. Rewritten by the logo swap — every place that
   renders <${named} /> shows this picture, at the size it gives it. */
const LOGO_SRC =
  "${escapeAttribute(src)}";

${hasNamed || !hasDefault ? "export " : ""}function ${named}({
  className = "",
  height = 36,
}: {
  className?: string;
  height?: number;
  [key: string]: unknown;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_SRC}
      alt="${alt}"
      className={className}
      style={{ height, width: "auto", maxWidth: 220, display: "block", objectFit: "contain" }}
    />
  );
}
${hasDefault ? `\nexport default ${named};\n` : ""}`;
}

/** "header", "header and footer", "header, footer and browser tab". */
export function listOf(places: string[]): string {
  if (places.length <= 1) return places[0] ?? "header";
  return `${places.slice(0, -1).join(", ")} and ${places[places.length - 1]}`;
}
