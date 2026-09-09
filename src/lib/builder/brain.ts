/* What this project actually IS, read out of the page rather than assumed.
 *
 * Everything upstream sends a model the whole document and hopes it notices.
 * That works for "make the header darker" and fails for everything that
 * depends on knowing the project: which sections exist, what the palette is,
 * which ids the scripts reach for, what the nav points at. The information was
 * always there — 46,000 characters of it — and nothing ever looked at it.
 *
 * So it is read once, into a structure, and that structure does two jobs that
 * were previously done by nobody:
 *
 *   BEFORE the edit, it is summarised into a few lines at the top of the
 *   prompt. A model told "this page uses #0b0f19 and Inter, and has sections
 *   hero, features, pricing, faq" makes a different change from one told
 *   nothing — it matches what is there instead of inventing a second design
 *   system halfway down the document.
 *
 *   AFTER the edit, the same reading is taken again and compared. A nav link
 *   pointing at a section that no longer exists, a script reaching for an id
 *   the edit deleted, a form that quietly vanished — each of those is a page
 *   that still parses, still validates, still looks fine in a diff, and is
 *   broken for the person using it.
 *
 * DETERMINISTIC AND FREE. No model call, no network, no browser. Everything
 * here is regex over markup, which is the only thing that can run inside the
 * sixty seconds a serverless function gets and still leave room for the edit
 * itself. It is deliberately not a parser: pages here are written by models and
 * hand-edited by people, and a strict reading would fail on documents that work
 * perfectly. Every number below is a signal, not a proof — which is why the
 * regression rules that use them are written to fire on disappearance rather
 * than on shape.
 */

/** Everything worth knowing about a page, in a form two callers can use. */
export type PageProfile = {
  /* The named landmarks of the document, in order. Read from ids and headings
     rather than tag names: "section" appears nine times and means nothing,
     "pricing" means something. */
  sections: string[];
  headings: string[];

  /* The design system as practised, not as intended. Counted by use so the
     summary can lead with the colours that actually carry the page rather than
     the one that appears once in a hover state. */
  colors: string[];
  fonts: string[];

  /* Anything that has to keep working. These are the counts the regression
     rules watch, and they are counts rather than contents because an edit is
     allowed to reword a button and not allowed to lose it. */
  images: number;
  forms: number;
  inputs: number;
  buttons: number;
  scripts: number;

  /* The wiring. `anchors` are the ids the document defines; `linkTargets` are
     the ones its own links point at; `scriptTargets` are the ones its scripts
     reach for by name. A page is internally sound when the last two are
     subsets of the first, and the interesting failures are all about that
     stopping being true. */
  anchors: string[];
  linkTargets: string[];
  scriptTargets: string[];

  /* Whether the page ever declared itself responsive. Losing this is the
     mobile layout collapsing, silently, on a page that looks perfect on the
     desktop somebody edited it from. */
  responsive: boolean;
};

/* Markup only. A <div> inside a template literal or a comment is text, and
   counting it would make every number drift for reasons no edit caused. The
   script and style TAGS survive so they can still be counted as elements; only
   their contents go. Deliberately the same treatment validate.ts gives them,
   for the same reason. */
function markupOnly(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, "$1$2")
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, "$1$2");
}

function scriptBodies(html: string): string {
  return (html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi) ?? []).join("\n");
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

/** Unique values, in the order they first appear, capped so a summary stays one. */
function firstFew<T>(values: T[], limit: number): T[] {
  return [...new Set(values)].slice(0, limit);
}

/** Unique values, commonest first — for the palette, where use is the point. */
function byUse(values: string[], limit: number): string[] {
  const tally = new Map<string, number>();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);
}

/**
 * Reads a page into the profile above.
 *
 * Safe on anything, including an empty string and markup that is half a
 * document — an edit in progress is exactly when this gets called.
 */
export function readPage(html: string): PageProfile {
  const markup = markupOnly(html);
  const scripts = scriptBodies(html);

  /* Sections, by the name a person would use. An id is the best evidence
     because somebody chose it; a heading is the fallback because somebody
     wrote it. */
  const ids = [...markup.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);
  const sectionIds = [...markup.matchAll(/<(?:section|main|header|footer|nav|article|aside)\b[^>]*\bid=["']([^"']+)["']/gi)]
    .map((m) => m[1]);

  const headings = [...markup.matchAll(/<h[1-3][^>]*>([\s\S]{1,120}?)<\/h[1-3]>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 1 && text.length <= 60);

  /* The palette, taken from wherever colour is written. Both notations, because
     a page uses whichever the model felt like that day. */
  const hex = [...html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
  const rgb = [...html.matchAll(/\brgba?\([^)]{3,40}\)/g)].map((m) => m[0].replace(/\s+/g, ""));

  /* Typefaces as named, not as resolved. font-family declarations and whatever
     the page loads from a font service are the two places a real answer lives. */
  const families = [...html.matchAll(/font-family\s*:\s*([^;"'}]+)/gi)]
    .map((m) => m[1].split(",")[0].replace(/["']/g, "").trim())
    .filter((name) => name.length > 0 && !/^(inherit|initial|unset|var\()/i.test(name));
  const loaded = [...html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^&"'\s]+)/gi)]
    .map((m) => decodeURIComponent(m[1]).split(":")[0].replace(/\+/g, " "));

  /* Where the page points, and what it reaches for. Only same-document links:
     an external URL cannot be verified from here and is none of this file's
     business. */
  const linkTargets = [...markup.matchAll(/href=["']#([^"']+)["']/g)].map((m) => m[1]);
  const scriptTargets = [
    ...scripts.matchAll(/getElementById\(\s*["']([^"']+)["']/g),
    ...scripts.matchAll(/querySelector(?:All)?\(\s*["']#([A-Za-z0-9_-]+)["']/g),
  ].map((m) => m[1]);

  return {
    sections: firstFew(sectionIds.length > 0 ? sectionIds : headings.map(slug), 12),
    headings: firstFew(headings, 12),
    colors: byUse([...hex, ...rgb], 6),
    fonts: firstFew([...loaded, ...families], 4),
    images: count(markup, /<img\b/gi),
    forms: count(markup, /<form\b/gi),
    inputs: count(markup, /<(?:input|textarea|select)\b/gi),
    buttons: count(markup, /<button\b/gi) + count(markup, /type=["']submit["']/gi),
    scripts: count(html, /<script\b/gi),
    anchors: firstFew(ids, 40),
    linkTargets: firstFew(linkTargets, 40),
    scriptTargets: firstFew(scriptTargets, 40),
    responsive: /<meta[^>]+name=["']viewport["']/i.test(html),
  };
}

/** A heading turned into the id it would have had, for pages that name nothing. */
function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

/**
 * The project, in the few lines that go at the top of an edit prompt.
 *
 * Short on purpose. This rides in front of the whole document on every single
 * edit, so every line has to earn its tokens — and a model that is about to
 * read the page anyway does not need a description of it. What it needs is the
 * part that is hard to see from inside a 46,000-character document: what the
 * palette IS, what the sections ARE, and which ids something else depends on.
 *
 * Returns an empty string for a page with nothing worth saying about it, so a
 * caller can concatenate without checking.
 */
export function describeProject(profile: PageProfile): string {
  const lines: string[] = [];

  if (profile.sections.length > 0) {
    lines.push(`Sections: ${profile.sections.join(", ")}`);
  }
  if (profile.colors.length > 0) {
    lines.push(`Palette in use: ${profile.colors.join(", ")} — match these rather than introducing new ones.`);
  }
  if (profile.fonts.length > 0) {
    lines.push(`Typefaces: ${profile.fonts.join(", ")}`);
  }

  /* The wiring, named only when there is some. A page with a script that
     reaches for three ids is a page where deleting the wrong div breaks a
     button, and that is worth one line. */
  const wired = profile.scriptTargets.filter((id) => profile.anchors.includes(id));
  if (wired.length > 0) {
    lines.push(`Scripts depend on these ids — do not rename or remove them: ${wired.join(", ")}`);
  }

  const navigated = profile.linkTargets.filter((id) => profile.anchors.includes(id));
  if (navigated.length > 0) {
    lines.push(`Navigation points at these ids: ${navigated.join(", ")}`);
  }

  const working: string[] = [];
  if (profile.forms > 0) working.push(`${profile.forms} form${profile.forms === 1 ? "" : "s"}`);
  if (profile.inputs > 0) working.push(`${profile.inputs} input${profile.inputs === 1 ? "" : "s"}`);
  if (profile.images > 0) working.push(`${profile.images} image${profile.images === 1 ? "" : "s"}`);
  if (working.length > 0) {
    lines.push(`Working parts: ${working.join(", ")}. Leave anything the request does not name exactly as it is.`);
  }

  if (lines.length === 0) return "";

  return `WHAT THIS PROJECT IS — read from the page, and true right now:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

/* ── Regression protection ─────────────────────────────────────────────────
 *
 * The other half of the same reading. validate.ts asks whether the document
 * still holds together; this asks whether it still WORKS — which is a different
 * question with different answers, and the failures it catches all share a
 * shape: the page renders, the markup balances, and something a person used
 * yesterday is gone.
 *
 * Written to fire on LOSS only. Every rule below triggers on something that
 * existed and stopped existing, never on something being the wrong shape,
 * because "wrong shape" on a model-written page is an opinion and a false
 * refusal costs somebody an edit they asked for correctly.
 */

/* How much of a working part may go before it reads as an accident.
 *
 * Not zero. "Remove the second signup form", "take out the newsletter box" are
 * real requests, and a guard that refused them would be the same disease this
 * codebase has had twice already. Losing MOST of something is the signal — an
 * edit to a button's colour does not take four fifths of the buttons with it. */
const KEEP = 0.5;

function mostlyGone(before: number, after: number): boolean {
  return before > 0 && after < before * KEEP;
}

/**
 * What this edit broke that was previously working, as sentences.
 *
 * Empty means nothing detectable regressed — which is not the same as the edit
 * being good, and is not claimed to be.
 */
export function regressions(before: PageProfile, after: PageProfile): string[] {
  const found: string[] = [];

  /* THE ONE THIS IS REALLY FOR. A link in the nav that used to land somewhere
     and now lands nowhere. The page renders, the link is still styled, and
     clicking it does nothing — the single most invisible way to break a page,
     and the easiest to cause by deleting a section somebody asked you to
     delete without touching the menu that points at it. */
  const brokenLinks = after.linkTargets.filter(
    (id) => before.anchors.includes(id) && !after.anchors.includes(id),
  );
  if (brokenLinks.length > 0) {
    found.push(
      `a link now points at ${brokenLinks.map((id) => `#${id}`).join(", ")}, which the change removed from the page`,
    );
  }

  /* A script reaching for an id that is no longer there. Whatever that script
     did — a menu, a tab, a modal — stopped doing it, and nothing anywhere else
     in the pipeline can tell. */
  const brokenScripts = after.scriptTargets.filter(
    (id) => before.anchors.includes(id) && !after.anchors.includes(id),
  );
  if (brokenScripts.length > 0) {
    found.push(
      `a script still reaches for ${brokenScripts.map((id) => `#${id}`).join(", ")}, which the change removed`,
    );
  }

  /* The mobile layout, lost in one line. */
  if (before.responsive && !after.responsive) {
    found.push("the viewport tag is gone, so the page would no longer lay out on a phone");
  }

  /* Working parts that mostly vanished. Counted rather than matched, because an
     edit may legitimately reword every button on the page. */
  if (mostlyGone(before.forms, after.forms)) {
    found.push(`${before.forms - after.forms} of the page's ${before.forms} forms went missing`);
  }
  if (mostlyGone(before.inputs, after.inputs)) {
    found.push(`${before.inputs - after.inputs} of the page's ${before.inputs} form fields went missing`);
  }
  if (mostlyGone(before.scripts, after.scripts)) {
    found.push("the page's scripts were removed, so anything interactive stopped working");
  }

  return found;
}
