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

/* Any way of saying logo, misspellings included — "logo", "logos", "lgo",
   "loog", "logi", "brand mark", "icon in the header". */
const LOGO =
  /\b(lo+g+o+s?|loog|logoo|lgo|logi|logp|lohgo|lgoo|brand ?(mark|logo|icon)|brandmark|wordmark|logotype|site icon|favicon|header icon|nav(bar)? icon)\b/i;
/* With a picture attached, saying logo IS asking for the swap — unless the
   message is only about the size, place or colour of the one that is there,
   or about taking it away. Those need the model. */
const ADJUST_ONLY =
  /\b(bigger|smaller|larger|resize|size|shrink|enlarge|move|align|cent(er|re)|left|right|spacing|margin|padding|position|colou?r|animate|animation|hover|remove|delete|hide|round(ed)?|shadow|border|darker|lighter|bold)\b/i;
/* Words that mean "this picture, instead", strongly enough to outweigh an
   adjustment word: "replace the logo with this, it's too big" is a swap,
   "change the logo colour" is not. Update and change are deliberately not
   here — on their own they are a swap (below), next to a size or colour they
   are about the size or colour. */
const WANTS_PICTURE =
  /\b(replace|replaced|swap|switch|use|put|new|this|these|here|instead|with|upload(ed)?|attach(ed)?|image|picture|photo|pic|file|png|jpe?g|svg|webp)\b/i;

/* A file named like a logo makes a vague message ("update this", "here") a
   logo swap too. */
const LOGO_FILE_NAME = /logo|brand|wordmark|lgo/i;

/**
 * Whether this message asks for an attached picture to become the logo.
 *
 * Generous on purpose: with a picture attached, any mention of the logo is a
 * swap. The only messages that are not are ones purely about adjusting or
 * removing the logo that is already there — "make the logo bigger", "move the
 * logo left", "remove the logo" — and those go to the model. A message that
 * does not say logo at all still counts when the file itself is named as one.
 */
export function asksForLogoSwap(message: string, imageCount: number, fileNames: string[] = []): boolean {
  if (imageCount < 1) return false;
  const m = message.toLowerCase();
  const saysLogo = LOGO.test(m);
  const fileIsLogo = fileNames.some((name) => LOGO_FILE_NAME.test(name));
  if (!saysLogo && !fileIsLogo) return false;
  /* Named as a logo and nothing much said: "update this", "here", "", "fix". */
  if (!saysLogo) return !ADJUST_ONLY.test(m) || WANTS_PICTURE.test(m);
  /* Says logo. A swap unless it is only an adjustment. */
  if (ADJUST_ONLY.test(m) && !WANTS_PICTURE.test(m.replace(/\b(the|my|our|this)\s+(lo+g+o+s?|lgo|logi)\b/g, "logo"))) return false;
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
  const maxCopies = Math.max(1, options.maxCopies ?? 4);
  const { outermost, regionOf } = ownLogos(source);
  if (outermost.length === 0) return null;

  const brand = (options.brand ?? "").trim() || brandFrom(source, outermost);
  const alt = brand ? `${brand} logo` : "Logo";

  const chosen = outermost.slice(0, maxCopies);
  const where: string[] = [];

  /* Applied back to front, so earlier indices stay valid. */
  let out = source;
  for (const el of [...chosen].sort((a, b) => b.start - a.start)) {
    const region = regionOf(el);
    const label = region?.label ?? "header";
    const height = label === "footer" ? FOOTER_HEIGHT : HEADER_HEIGHT;
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

/* The height a swapped-in logo starts at. Readable on a phone without crowding
   the bar; a person who wants it different says so, and resizeLogo does it. */
const HEADER_HEIGHT = 44;
const FOOTER_HEIGHT = 36;

type Region = { start: number; end: number; label: string };

/* The site's own logos, outermost first, and which part of the chrome each is
   in. Shared by the swap and the resize, so both find the same thing. */
function ownLogos(source: string): {
  all: Element[];
  outermost: Element[];
  regionOf: (el: Element) => Region | null;
} {
  const all = openings(source);

  /* The chrome: header, nav, footer, and anything named as a mobile menu. */
  const regions: Region[] = all
    .filter((el) => (CHROME_TAGS as readonly string[]).includes(el.tag.toLowerCase()) || MENU_NAME.test(namesOf(el.open)))
    .map((el) => ({ start: el.start, end: el.end, label: regionLabel(el) }));
  /* The innermost region wins: a nav inside a footer is the footer. */
  const regionOf = (el: Element) =>
    regions
      .filter((region) => el.start >= region.start && el.end <= region.end)
      .sort((a, b) => (a.label === "footer" ? -1 : b.label === "footer" ? 1 : b.start - a.start))[0] ?? null;

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

  /* The outermost of nested matches: `<a class="logo"><svg class="logo-mark">`
     is one logo, swapped once, at the link. */
  const outermost = candidates.filter(
    (el) => !candidates.some((other) => other !== el && other.start <= el.start && other.end >= el.end && other.start !== el.start),
  );

  return { all, outermost, regionOf };
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
  height = 44,
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

/* ── Resizing the logo ───────────────────────────────────────────────────────
 *
 * "Make the logo bigger" went to a model, and the model kept answering with
 * the same size. Not stubbornness: the swap above sets the height as an
 * inline style, and an inline style outranks every class the model added — so
 * it wrote `h-14`, the page was stored, and the logo did not move. Asked again,
 * it did the same thing again.
 *
 * Resizing is arithmetic, so it is done here, on the height that actually
 * applies. It reads every way people say it — bigger, a lot bigger, a little
 * smaller, twice the size, 50% bigger, 64px, large, "it's too small" — and
 * writes the new height where it wins. */

export type LogoResize =
  | { kind: "absolute"; px: number; said: string }
  | { kind: "scale"; factor: number; said: string };

const BIGGER = /\b(bigger|larger|large?r|biger|increase|increased|enlarge|grow|scale ?up|boost|upsize|more visible|stand out|pop more|blow ?up)\b/i;
const SMALLER = /\b(smaller|smaler|decrease|reduce|shrink|scale ?down|downsize|tone (it )?down|less (big|large))\b/i;
const MUCH = /\b(much|a lot|alot|lot|way|very|really|significantly|massively|considerably|far|heaps|loads|super|extremely|more)\b/i;
const LITTLE = /\b(slightly|a bit|bit|a little|little|tad|touch|tiny bit|small amount|marginally|abit)\b/i;
const TOO_SMALL = /\b(too (small|tiny|little)|so small|very small|looks? (small|tiny)|is (small|tiny)|barely visible|can'?t see|hard to see|not visible)\b/i;
const TOO_BIG = /\b(too (big|large|huge)|so (big|large|huge)|looks? (big|huge)|is (huge|massive))\b/i;

/**
 * What size change a message asks of the logo, or null when it asks none.
 * Needs the logo named — "make it bigger" alone could be anything.
 */
export function asksForLogoResize(message: string): LogoResize | null {
  const m = message.toLowerCase();
  if (!LOGO.test(m)) return null;

  /* An exact size: "64px", "64 px", "64 pixels", "height 64". */
  const px = /\b(\d{2,3})\s*(px|pixels?)\b/.exec(m) ?? /\b(?:height|tall|size)\s*(?:of|to|=|:)?\s*(\d{2,3})\b/.exec(m);
  if (px) return { kind: "absolute", px: clampHeight(Number(px[1])), said: `${px[1]}px` };

  /* A percentage: "50% bigger", "by 30%", "to 150%". */
  const pct = /\b(\d{1,3})\s*%/.exec(m);
  if (pct) {
    const n = Number(pct[1]);
    if (SMALLER.test(m)) return { kind: "scale", factor: Math.max(0.2, 1 - n / 100), said: `${n}% smaller` };
    if (BIGGER.test(m) || /\bby\b/.test(m)) return { kind: "scale", factor: 1 + n / 100, said: `${n}% bigger` };
    return { kind: "scale", factor: n / 100, said: `${n}% of its size` };
  }

  /* A multiple: "2x", "1.5x", "double", "twice", "triple", "half". */
  const times = /\b(\d(?:\.\d)?)\s*(x|times)\b/.exec(m);
  if (times && Number(times[1]) > 0) {
    const factor = Number(times[1]);
    return SMALLER.test(m)
      ? { kind: "scale", factor: 1 / factor, said: `${factor}× smaller` }
      : { kind: "scale", factor, said: `${factor}× the size` };
  }
  if (/\b(double|twice|two times)\b/.test(m)) return { kind: "scale", factor: 2, said: "double the size" };
  if (/\b(triple|three times)\b/.test(m)) return { kind: "scale", factor: 3, said: "three times the size" };
  if (/\b(half|halve)\b/.test(m)) return { kind: "scale", factor: 0.5, said: "half the size" };

  /* "It's too small" means bigger, whatever words come with it. */
  if (TOO_SMALL.test(m)) return { kind: "scale", factor: MUCH.test(m) ? 1.8 : 1.5, said: "bigger" };
  if (TOO_BIG.test(m)) return { kind: "scale", factor: MUCH.test(m) ? 0.55 : 0.7, said: "smaller" };

  /* Bigger and smaller, by how much it was said. */
  const bigger = BIGGER.test(m);
  const smaller = SMALLER.test(m);
  if (bigger && !smaller) {
    if (LITTLE.test(m)) return { kind: "scale", factor: 1.2, said: "a little bigger" };
    if (MUCH.test(m)) return { kind: "scale", factor: 1.75, said: "a lot bigger" };
    return { kind: "scale", factor: 1.4, said: "bigger" };
  }
  if (smaller && !bigger) {
    if (LITTLE.test(m)) return { kind: "scale", factor: 0.85, said: "a little smaller" };
    if (MUCH.test(m)) return { kind: "scale", factor: 0.55, said: "a lot smaller" };
    return { kind: "scale", factor: 0.72, said: "smaller" };
  }

  /* A named size: "make the logo large", "logo size: medium". */
  const named: [RegExp, number, string][] = [
    [/\b(extra[- ]?large|x-?large|xl|huge|massive|giant|very large|very big)\b/, 88, "extra large"],
    [/\b(large|big)\b/, 64, "large"],
    [/\b(medium|normal|regular|default)\b/, 48, "medium"],
    [/\b(small)\b/, 32, "small"],
    [/\b(tiny|extra[- ]?small|xs)\b/, 22, "extra small"],
  ];
  if (/\b(size|make|set|change|put|logo should be|be)\b/.test(m)) {
    for (const [pattern, size, said] of named) {
      if (pattern.test(m)) return { kind: "absolute", px: size, said };
    }
  }
  return null;
}

function clampHeight(px: number): number {
  return Math.round(Math.min(220, Math.max(14, px)));
}

export type LogoResized = {
  source: string;
  /** Height before and after, per place, in the order the places appear. */
  sizes: { where: string; from: number; to: number }[];
};

/**
 * The logo at its new size, everywhere it appears — or only in the footer, or
 * only in the header, when the message says so. Null when there is no logo to
 * resize, so the caller can hand it to the model.
 */
export function resizeLogo(
  source: string,
  resize: LogoResize,
  options: { jsx?: boolean; only?: "header" | "footer" | null; wholeFileIsLogo?: boolean } = {},
): LogoResized | null {
  const jsx = options.jsx === true;

  /* The Logo component the swap wrote: its size is the `height` default, and
     changing that changes it everywhere it is rendered. */
  const defaulted = options.wholeFileIsLogo ? /(\n\s*height\s*=\s*)(\d+)(\s*,)/.exec(source) : null;
  if (defaulted && /const LOGO_SRC\b/.test(source)) {
    const from = Number(defaulted[2]);
    const to = resize.kind === "absolute" ? resize.px : clampHeight(from * resize.factor);
    return {
      source: source.replace(defaulted[0], `${defaulted[1]}${to}${defaulted[3]}`).replace(/maxWidth:\s*\d+/, `maxWidth: ${Math.max(220, to * 6)}`),
      sizes: [{ where: "logo", from, to }],
    };
  }

  const targets = sizeTargets(source, options.wholeFileIsLogo === true).filter(
    (target) => !options.only || (options.only === "footer" ? target.where === "footer" : target.where !== "footer"),
  );
  if (targets.length === 0) return null;

  const sizes: LogoResized["sizes"] = [];
  let out = source;
  for (const target of [...targets].sort((a, b) => b.el.start - a.el.start)) {
    const text = target.text;
    const from = text ? fontSizeOf(target.el.open, jsx) : heightOf(target.el.open, jsx, target.where);
    const to = resize.kind === "absolute"
      ? text ? Math.max(12, Math.round(resize.px * 0.55)) : resize.px
      : clampHeight(from * resize.factor);
    const open = text ? withFontSize(target.el.open, to, jsx) : withHeight(target.el.open, to, jsx);
    out = out.slice(0, target.el.start) + open + out.slice(target.el.openEnd);
    sizes.unshift({ where: target.where, from, to });
  }

  return { source: out, sizes };
}

/** "header 44px → 62px, footer 36px → 50px". */
export function describeResize(sizes: LogoResized["sizes"]): string {
  const seen = new Set<string>();
  return sizes
    .filter((size) => (seen.has(size.where) ? false : (seen.add(size.where), true)))
    .map((size) => `${size.where} ${size.from}px → ${size.to}px`)
    .join(", ");
}

type SizeTarget = { el: Element; where: string; text: boolean };

/* What to resize: the picture inside each logo — or the drawn mark, or for a
   logo that is only words, the words. */
function sizeTargets(source: string, wholeFileIsLogo: boolean): SizeTarget[] {
  const { all, outermost, regionOf } = ownLogos(source);
  const where = (el: Element) => regionOf(el)?.label ?? "header";

  /* What the swap put in is marked, and is exactly what to resize. */
  const marked = all.filter((el) => /\bdata-qs-logo\b/.test(el.open));
  if (marked.length > 0) return marked.map((el) => ({ el, where: where(el), text: false }));

  /* A file that IS the logo: its first picture or drawing. */
  if (wholeFileIsLogo) {
    const mark = all.find((el) => /^(img|svg)$/i.test(el.tag));
    return mark ? [{ el: mark, where: "header", text: false }] : [];
  }

  return outermost.map((logo) => {
    if (/^(img|svg)$/i.test(logo.tag)) return { el: logo, where: where(logo), text: false };
    const inner = all.find((el) => el.start > logo.start && el.end <= logo.end && /^(img|svg)$/i.test(el.tag));
    return inner ? { el: inner, where: where(logo), text: false } : { el: logo, where: where(logo), text: true };
  });
}

const TW_HEIGHT: Record<string, number> = { "4": 16, "5": 20, "6": 24, "7": 28, "8": 32, "9": 36, "10": 40, "11": 44, "12": 48, "14": 56, "16": 64, "20": 80, "24": 96 };
const TW_TEXT: Record<string, number> = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48 };

/* The height that applies now: inline style first, because it wins, then the
   height attribute, then a Tailwind class, then what the swap would have set. */
function heightOf(open: string, jsx: boolean, where: string): number {
  const inline = jsx ? /style=\{\{[^}]*\bheight:\s*(\d+)/.exec(open) : /style\s*=\s*["'][^"']*\bheight\s*:\s*(\d+(?:\.\d+)?)px/i.exec(open);
  if (inline) return Number(inline[1]);
  const attr = /\bheight\s*=\s*["'{]?(\d+)/.exec(open);
  if (attr) return Number(attr[1]);
  const cls = /\bh-(\d+)\b/.exec(open);
  if (cls && TW_HEIGHT[cls[1]]) return TW_HEIGHT[cls[1]];
  const arbitrary = /\bh-\[(\d+)px\]/.exec(open);
  if (arbitrary) return Number(arbitrary[1]);
  return where === "footer" ? FOOTER_HEIGHT : HEADER_HEIGHT;
}

function fontSizeOf(open: string, jsx: boolean): number {
  const inline = jsx ? /style=\{\{[^}]*\bfontSize:\s*(\d+)/.exec(open) : /font-size\s*:\s*(\d+(?:\.\d+)?)px/i.exec(open);
  if (inline) return Number(inline[1]);
  const cls = /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)\b/.exec(open);
  return cls ? TW_TEXT[cls[1]] : 20;
}

/* The new height, written where it wins: the inline style. Width follows the
   picture's own proportions, and the old max-width cap grows with it so a wide
   wordmark is not squeezed. */
function withHeight(open: string, height: number, jsx: boolean): string {
  const maxWidth = Math.max(220, height * 6);
  if (jsx) {
    const style = /style=\{\{([^}]*)\}\}/.exec(open);
    const rest = style
      ? style[1].replace(/\b(height|maxHeight|width|maxWidth)\s*:\s*("[^"]*"|'[^']*'|[\w.%-]+)\s*,?/g, "").trim().replace(/^,|,$/g, "").trim()
      : "";
    const next = `style={{ height: ${height}, width: "auto", maxWidth: ${maxWidth}, maxHeight: "none"${rest ? `, ${rest}` : ""} }}`;
    return style ? open.replace(style[0], next) : open.replace(/\s*(\/?)>$/, ` ${next} $1>`);
  }
  const style = /\bstyle\s*=\s*(["'])([^"']*)\1/i.exec(open);
  const rest = style
    ? style[2].replace(/(^|;)\s*(height|max-height|width|max-width)\s*:[^;]*/gi, "$1").replace(/;{2,}/g, ";").replace(/^;|;$/g, "").trim()
    : "";
  const next = `style="height:${height}px;width:auto;max-width:${maxWidth}px;max-height:none${rest ? `;${rest}` : ""}"`;
  return style ? open.replace(style[0], next) : open.replace(/\s*(\/?)>$/, ` ${next}$1>`);
}

function withFontSize(open: string, size: number, jsx: boolean): string {
  if (jsx) {
    const style = /style=\{\{([^}]*)\}\}/.exec(open);
    const rest = style ? style[1].replace(/\bfontSize\s*:\s*[\w."']+\s*,?/g, "").trim().replace(/,$/, "") : "";
    const next = `style={{ fontSize: ${size}${rest ? `, ${rest}` : ""} }}`;
    return style ? open.replace(style[0], next) : open.replace(/\s*(\/?)>$/, ` ${next}$1>`);
  }
  const style = /\bstyle\s*=\s*(["'])([^"']*)\1/i.exec(open);
  const rest = style ? style[2].replace(/(^|;)\s*font-size\s*:[^;]*/gi, "$1").replace(/^;|;$/g, "").trim() : "";
  const next = `style="font-size:${size}px${rest ? `;${rest}` : ""}"`;
  return style ? open.replace(style[0], next) : open.replace(/\s*(\/?)>$/, ` ${next}$1>`);
}

/** Which part a resize is limited to, when the message names one. */
export function resizeScope(message: string): "header" | "footer" | null {
  const m = message.toLowerCase();
  const footer = /\bfooter\b/.test(m);
  const header = /\b(header|nav|navbar|top|menu bar|top bar)\b/.test(m);
  if (footer && !header) return "footer";
  if (header && !footer) return "header";
  return null;
}

/* ── On a project ──────────────────────────────────────────────────────────── */

export type TreeLogoResize = { files: File[]; paths: string[]; sizes: LogoResized["sizes"] };

/** The same resize across a project: the Logo component, then inline marks. */
export function resizeLogoInTree(tree: File[], resize: LogoResize, only: "header" | "footer" | null = null): TreeLogoResize | null {
  const changed: File[] = [];
  const sizes: LogoResized["sizes"] = [];
  for (const file of tree) {
    if (!LOGO_FILE.test(file.path) || /\.(test|spec|stories)\./.test(file.path)) continue;
    if (only === "footer") continue;
    const done = resizeLogo(file.content, resize, { jsx: true, wholeFileIsLogo: true });
    if (done) {
      changed.push({ path: file.path, content: done.source });
      sizes.push(...done.sizes);
    }
  }
  for (const file of tree) {
    if (!CHROME_FILE.test(file.path) || changed.some((done) => done.path === file.path)) continue;
    const done = resizeLogo(file.content, resize, { jsx: true, only });
    if (done) {
      changed.push({ path: file.path, content: done.source });
      sizes.push(...done.sizes);
    }
  }
  if (changed.length === 0) return null;
  return { files: changed, paths: changed.map((file) => file.path), sizes };
}
