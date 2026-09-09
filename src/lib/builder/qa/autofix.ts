/* The repairs that need no model, no browser and no permission.
 *
 * repair.ts writes INSTRUCTIONS for the edit path: a model reads the document,
 * decides what to change, and rewrites it. That is right for anything needing
 * judgement, and it is far too expensive for the handful of defects that have
 * exactly one correct fix. A missing viewport meta tag does not need an opinion.
 * `width: 1200px` on a phone does not need an opinion. `100vw` is wrong for the
 * same reason in every document that has ever contained it.
 *
 * So those are done here, mechanically, on the way past — before the page is
 * stored, on every build, with no model call and no added latency worth
 * measuring. The customer never sees them because there is nothing to see: the
 * page simply does not have the defect.
 *
 * ── The rule every fix in this file obeys ─────────────────────────────────
 *
 * A fix may only make a wrong page right. It may never make a right page
 * different. Every rule below is one where the "before" state is a defect in
 * every document that has it — which is why there is no fix here for a narrow
 * column, a small font or a cramped section, all of which are sometimes exactly
 * what was wanted.
 *
 * And nothing here hides anything. `overflow-x: hidden` on the body would clear
 * every horizontal-scroll finding in one line and cut the content off the side
 * of the page where nobody can reach it, and the gate would go quiet. A fix
 * that defeats its own check is worse than no fix.
 *
 * ── Documents, not projects ───────────────────────────────────────────────
 *
 * This rewrites an HTML document. A project of .tsx files is not touched: the
 * same defects there live in Tailwind classes and component props, where a
 * regex is a liability rather than a tool. Those are caught by the gates and
 * repaired through the edit path like anything else.
 */

import { ensureFramingStyles, pictures, readFraming, writeFraming } from "@/lib/builder/framing";

export type Fix = {
  /** The QA rule this pre-empts, so a report can say what stopped being wrong. */
  rule: string;
  /** What was changed, in a sentence. */
  what: string;
  /** How many places. */
  count: number;
};

export type FixResult = { html: string; applied: Fix[] };

/* The safety net, appended once as the last stylesheet in the document.
 *
 * Everything in it is a guard rather than a style: each rule prevents a
 * specific way a page takes itself sideways, and none of them can change a
 * layout that was not already broken. `max-width: 100%` on an image cannot
 * shrink an image that fits. `overflow-wrap` cannot break a word that has
 * room. That is the test each of these had to pass to be here. */
const SAFETY_NET = `
/* Added automatically after the build: guards, not styling. Each one prevents a
   specific way a page pushes itself off the side of a phone. */
img, svg, video, canvas, iframe { max-width: 100%; }
img, video { height: auto; }
pre, code, table { max-width: 100%; }
pre { overflow-x: auto; }
h1, h2, h3, h4, p, li, a, td, th, dd, dt, figcaption, blockquote { overflow-wrap: break-word; }
`;

/** Whether the document already carries something. */
const has = (html: string, pattern: RegExp): boolean => pattern.test(html);

/**
 * Every mechanical fix this document needs, applied.
 *
 * Never throws and never returns a shorter document than it was given: each
 * step is a substitution that either matches or does not, so the worst outcome
 * is the page it was handed back unchanged.
 */
export function autofix(html: string): FixResult {
  if (!html || html.length < 40) return { html, applied: [] };

  const applied: Fix[] = [];
  let out = html;

  /* ── The viewport meta ──────────────────────────────────────────────────
     Without it a phone renders the page at 980px and scales it down, which
     makes every responsive rule in the document inert and every font too small
     to read. There is no document where its absence is deliberate. */
  if (!has(out, /<meta\b[^>]*name\s*=\s*["']viewport["']/i)) {
    const tag = '<meta name="viewport" content="width=device-width, initial-scale=1">';
    if (/<head[^>]*>/i.test(out)) {
      out = out.replace(/<head([^>]*)>/i, `<head$1>\n    ${tag}`);
      applied.push({ rule: "visual/viewport-meta", what: "added the viewport meta tag", count: 1 });
    } else if (/<html[^>]*>/i.test(out)) {
      out = out.replace(/<html([^>]*)>/i, `<html$1>\n<head>${tag}</head>`);
      applied.push({ rule: "visual/viewport-meta", what: "added a head with the viewport meta tag", count: 1 });
    }
  }

  /* ── 100vw ──────────────────────────────────────────────────────────────
     The viewport width INCLUDING the scrollbar. An element at width: 100vw on
     a desktop with a visible scrollbar is 15px wider than the space it has, so
     the page scrolls sideways — every time, in every document, by exactly the
     width of the scrollbar. 100% is what was meant. */
  {
    let count = 0;
    out = out.replace(
      /(\b(?:max-|min-)?width\s*:\s*)100vw\b/gi,
      (whole, prefix: string) => {
        count += 1;
        return `${prefix}100%`;
      },
    );
    if (count > 0) {
      applied.push({
        rule: "responsive/horizontal-scroll",
        what: "changed width: 100vw to 100%, which excludes the scrollbar",
        count,
      });
    }
  }

  /* ── Fixed widths wider than a phone ────────────────────────────────────
     `width: 1200px` holds that width at every screen size, so on a 375px phone
     it is 825px of the page hanging off the right. `max-width` with `width:
     100%` is the same layout wherever there is room and a correct one where
     there is not.

     Only in the page's own CSS, and only outside a media query that already
     scopes it to a wide screen: a rule inside `@media (min-width: 1024px)` is
     doing this deliberately and correctly. */
  {
    let count = 0;
    out = replaceOutsideWideMediaQueries(out, /(?<!-)\bwidth\s*:\s*(\d{3,})px\b/gi, (whole, value: string) => {
      if (Number(value) <= 390) return whole;
      count += 1;
      return `max-width: ${value}px; width: 100%`;
    });
    if (count > 0) {
      applied.push({
        rule: "visual/fixed-width",
        what: "turned fixed pixel widths into max-widths that can shrink",
        count,
      });
    }
  }

  /* ── min-width holding a layout open ────────────────────────────────────
     A min-width above the narrowest phone cannot be satisfied on that phone,
     so the element stays wide and takes the page with it. Capped rather than
     removed: the intent — do not get narrower than this — is usually right,
     and 320px is where it stops being possible. */
  {
    let count = 0;
    out = replaceOutsideWideMediaQueries(out, /\bmin-width\s*:\s*(\d{3,})px\b/gi, (whole, value: string) => {
      if (Number(value) <= 320) return whole;
      count += 1;
      return "min-width: 0";
    });
    if (count > 0) {
      applied.push({
        rule: "responsive/overflow",
        what: "released min-widths that could not be met on a phone",
        count,
      });
    }
  }

  /* ── Tables, wrapped so they scroll in their own box ────────────────────
     A table does not wrap. On a phone it either scrolls inside a container or
     it pushes the entire page sideways, and the container is the fix everybody
     writes by hand afterwards. Skipped where one is already wrapped, and
     skipped entirely where the document nests tables — a regex has no business
     rewriting those. */
  {
    const tables = [...out.matchAll(/<table\b/gi)].length;
    const closings = [...out.matchAll(/<\/table>/gi)].length;

    if (tables > 0 && tables === closings && !/<table[\s\S]*?<table/i.test(out)) {
      let count = 0;
      out = out.replace(/(<table\b[\s\S]*?<\/table>)/gi, (whole, table: string, offset: number) => {
        /* Already inside something that scrolls. Cheap and good enough: the
           200 characters before a table are its own container's opening tag. */
        const before = out.slice(Math.max(0, offset - 200), offset);
        if (/overflow-x\s*:\s*(auto|scroll)/i.test(before)) return whole;
        count += 1;
        return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">${table}</div>`;
      });
      if (count > 0) {
        applied.push({
          rule: "visual/table-overflow",
          what: "wrapped tables in a container that scrolls on its own",
          count,
        });
      }
    }
  }

  /* ── Grids that cannot become one column ────────────────────────────────
   *
   * `repeat(4, 1fr)` is four columns at every width, including 320px, where
   * each of them is seventy pixels wide and the content inside them does not
   * fit. It is the last mechanical cause of a page hanging off the side after
   * everything above has run.
   *
   * The declaration itself is left exactly as written, and that is the whole
   * design of this fix: four columns on a laptop is very probably what was
   * wanted, and rewriting it to `auto-fit` would silently make it five on a
   * wide screen. Instead an override is appended for the same selectors,
   * scoped to phones. Below 640px it collapses; at every width above it,
   * nothing this fix did can apply at all.
   *
   * A selector is taken from the rule that declares the grid. Where the CSS is
   * shaped in a way this cannot read, nothing matches and nothing is added. */
  {
    const selectors = new Set<string>();
    for (const match of out.matchAll(
      /([^{}@]+)\{([^{}]*grid-template-columns\s*:\s*repeat\(\s*(\d+)\s*,[^{}]*)\}/gi,
    )) {
      const selector = match[1].trim().replace(/\s+/g, " ");
      const columns = Number(match[3]);
      if (columns < 3) continue;
      /* A selector this cannot safely re-emit — one carrying a brace, a quote
         or an at-rule fragment — is skipped rather than guessed at. */
      if (!selector || /[{}@"']/.test(selector) || selector.length > 120) continue;
      selectors.add(selector);
    }

    if (selectors.size > 0 && !out.includes("/* Added automatically: grids collapse")) {
      const block = `<style>/* Added automatically: grids collapse on a phone. The declarations above are
   untouched — this applies only below 640px. */
@media (max-width: 640px) {
  ${[...selectors].join(",\n  ")} { grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); }
}</style>`;

      if (/<\/head>/i.test(out)) {
        out = out.replace(/<\/head>/i, `${block}\n</head>`);
        applied.push({
          rule: "visual/rigid-grid",
          what: "let fixed-column grids collapse below 640px",
          count: selectors.size,
        });
      }
    }
  }

  /* ── box-sizing ─────────────────────────────────────────────────────────
   *
   * The single most common remaining cause of a page hanging off the side of a
   * phone, and the one the fixes above cannot reach: `width: 100%` plus
   * `padding: 40px` is 100% PLUS 80px under the CSS default, so a container
   * that was told to fit its parent is eighty pixels wider than it. Turning a
   * fixed width into a max-width does not help, because the padding is added
   * after the max-width is applied.
   *
   * This is the one fix in this file that could change a page that was right,
   * which is why it is conditional. A document that declares `box-sizing`
   * anywhere has an author who thought about it and is left entirely alone. A
   * document that declares it nowhere has an author who did not — every CSS
   * framework in use, Tailwind's preflight included, sets border-box globally,
   * so a page written against any of them already assumes it, and a page
   * written against none of them is relying on a default that is wrong for
   * every layout it is currently breaking.
   *
   * The cost, stated honestly: an element with an explicit width AND padding
   * gets smaller by its padding rather than larger. On a page that is
   * currently pushing itself off the screen, that is the correction. */
  if (!/box-sizing/i.test(out)) {
    const rule = "*, *::before, *::after { box-sizing: border-box; }";
    if (/<\/head>/i.test(out)) {
      out = out.replace(
        /<\/head>/i,
        `<style>/* Added automatically: the page declared no box-sizing, and its padding was\n   being added on top of its widths. */\n${rule}</style>\n</head>`,
      );
      applied.push({
        rule: "responsive/box-sizing",
        what: "made padding count inside an element's width rather than on top of it",
        count: 1,
      });
    }
  }

  /* ── Framing, compiled ──────────────────────────────────────────────────
   *
   * The generator declares where the subject of a picture sits — `data-fit`,
   * `data-focal`, `data-zoom` — and a browser has never heard of any of them.
   * This turns the declaration into the CSS that acts on it, which is the same
   * arrangement as `data-shot`: the model writes the intent, the pipeline turns
   * it into the thing that works.
   *
   * It cannot make a right page different. A tag with no framing attributes is
   * not touched at all, and a tag whose attributes already agree with its own
   * declarations is rewritten to exactly what it already said — writeFraming is
   * idempotent, which is what lets this run on every build and on every edit
   * without the document drifting a character each time.
   *
   * Not a substitution over the whole document: each tag is replaced where it
   * stands, because two products can legitimately carry identical markup and a
   * global replace would frame them off the first one's attributes. */
  {
    let count = 0;
    let cursor = 0;

    for (const picture of pictures(out)) {
      if (!/\bdata-(?:focal|fit|zoom)\s*=/i.test(picture.tag)) continue;

      const framed = writeFraming(picture.tag, readFraming(picture.tag));
      if (framed === picture.tag) continue;

      const at = out.indexOf(picture.tag, cursor);
      if (at === -1) continue;

      out = out.slice(0, at) + framed + out.slice(at + picture.tag.length);
      cursor = at + framed.length;
      count += 1;
    }

    if (count > 0) {
      applied.push({
        rule: "composition/uncompiled-focal",
        what: "turned the declared focal points into object-fit and object-position",
        count,
      });
    }

    /* And the one rule that cannot live on the tag: a picture framed closer in
       than its box has to be clipped by its parent. Appended only when the
       document has one. */
    const framed = ensureFramingStyles(out);
    if (framed !== out) {
      out = framed;
      applied.push({
        rule: "composition/subject-cropped",
        what: "clipped the frames of pictures that are zoomed in, so they cannot spill over the section below",
        count: 1,
      });
    }
  }

  /* ── The safety net ─────────────────────────────────────────────────────
     Last, so it wins over anything above it, and once. */
  if (!out.includes("Added automatically after the build")) {
    if (/<\/head>/i.test(out)) {
      out = out.replace(/<\/head>/i, `<style>${SAFETY_NET}</style>\n</head>`);
      applied.push({
        rule: "responsive/guards",
        what: "added the media and long-word guards that stop a page taking itself sideways",
        count: 1,
      });
    } else if (/<\/body>/i.test(out)) {
      out = out.replace(/<\/body>/i, `<style>${SAFETY_NET}</style>\n</body>`);
      applied.push({
        rule: "responsive/guards",
        what: "added the media and long-word guards that stop a page taking itself sideways",
        count: 1,
      });
    }
  }

  return { html: out, applied };
}

/* Substitution that leaves wide-screen media queries alone.
 *
 * `width: 1200px` inside `@media (min-width: 1024px)` is correct and rewriting
 * it would be the exact failure this file is written to avoid — a fix that
 * changes a page that was right. Everything else, including narrow-screen media
 * queries and the bare stylesheet, is fair game.
 *
 * Blocks are found by scanning for `@media` and matching its braces, which is
 * enough for CSS as it is actually written. A stylesheet this cannot parse is
 * left entirely alone rather than half-rewritten. */
function replaceOutsideWideMediaQueries(
  html: string,
  pattern: RegExp,
  replacer: (whole: string, value: string) => string,
): string {
  const protectedRanges = wideMediaRanges(html);
  if (protectedRanges === null) return html;

  const inProtected = (index: number): boolean =>
    protectedRanges.some(([start, end]) => index >= start && index < end);

  return html.replace(pattern, (whole, value: string, offset: number) =>
    inProtected(offset) ? whole : replacer(whole, value),
  );
}

/** The [start, end) spans of every `@media` block scoped to a wide screen. */
function wideMediaRanges(css: string): [number, number][] | null {
  const ranges: [number, number][] = [];
  const opener = /@media([^{]*)\{/gi;

  for (const match of css.matchAll(opener)) {
    const condition = match[1] ?? "";
    const start = match.index ?? 0;

    /* Only min-width queries above a phone are protected. A max-width query is
       the mobile branch, and a fixed width there is the defect itself. */
    const min = /min-width\s*:\s*(\d+)px/i.exec(condition);
    if (!min || Number(min[1]) < 480) continue;

    let depth = 0;
    let index = start + match[0].length - 1;
    for (; index < css.length; index += 1) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    /* Unbalanced braces: something is being parsed that is not the CSS this
       expects. Refusing the whole pass is the safe answer. */
    if (depth !== 0) return null;
    ranges.push([start, index + 1]);
  }

  return ranges;
}

/** What was fixed, for a build step or a message. */
export function describeFixes(applied: Fix[]): string {
  if (applied.length === 0) return "nothing needed fixing";
  const total = applied.reduce((sum, fix) => sum + fix.count, 0);
  return `${total} ${total === 1 ? "thing" : "things"}: ${applied.map((fix) => fix.what).join("; ")}`;
}
