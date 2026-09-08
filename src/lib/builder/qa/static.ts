/* The gates that need no browser.
 *
 * These run on every build, in the pipeline, always. That is the reason they
 * are separated from the rendered gates at all: rendering needs a browser and a
 * built project, and neither is available inside a serverless function — so a
 * QA stage that could only work by rendering would be a QA stage that never
 * ran. Everything answerable from the document itself is answered here.
 *
 * What it deliberately cannot see: anything about layout. Whether a button
 * overflows its container at 390px is not a question the markup can answer, and
 * nothing here pretends otherwise — those findings come from render.ts, and
 * when it has not run the gate reports that rather than reporting a pass.
 *
 * ── Why regexes rather than a parser ──────────────────────────────────────
 *
 * The same reason the rest of this codebase uses them on generated documents:
 * pages here are written by models and hand-edited by people, and plenty of
 * perfectly good ones would fail a strict parse. A gate that refuses a working
 * page over a stray attribute is the disease this codebase has had twice
 * already — right in principle, wrong about the documents it actually meets.
 */

import type { ArchitectureManifest } from "@/lib/builder/architecture";
import type { DesignDNA } from "@/lib/builder/design";
import { typeScale } from "@/lib/builder/design";
import type { FileTree } from "@/lib/builder/tree";
import { AA_TEXT, AAA_TEXT, check as contrastCheck } from "./contrast";
import { planFor } from "./plan";
import { type GateResult, type Issue, emptyGate } from "./types";

/* The document with scripts and styles removed. Every check about what a
   VISITOR sees works on this; the ones about how it was built work on the raw
   text. Counting both is how twelve products get reported as fifteen — a
   querySelector naming a product is code about products, not a product. */
function markupOf(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ");
}

function stylesOf(html: string): string {
  return [...html.matchAll(/<style[\s\S]*?<\/style>/gi)].map((match) => match[0]).join("\n");
}

/* ── Design system adherence (§3) ──────────────────────────────────────────
 *
 * The question is not "is this page pretty" — it is whether the page used the
 * system it was given or quietly invented values beside it. That is mechanical
 * and worth catching: one extra grey is what makes a generated page look
 * generated, and it is invisible to everyone until the whole thing is beside
 * itself on a second page.
 */
export function designGate(html: string, dna: DesignDNA | null | undefined): GateResult {
  if (!dna) return emptyGate(false);

  const issues: Issue[] = [];
  const styles = stylesOf(html) + " " + [...html.matchAll(/style\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join(";");

  /* Colours the page uses, as written. Only long-form hex and rgb() — a page
     using var(--ink) is doing exactly what it was told and never appears here. */
  const used = new Set(
    [...styles.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => normaliseHex(match[0])),
  );

  const allowed = new Set(
    [dna.color.ground, dna.color.surface, dna.color.ink, dna.color.muted, dna.color.line, dna.color.accent, dna.color.accentInk]
      .map(normaliseHex),
  );

  /* White and black are always allowed. They are what a shadow, an overlay and
     a scrim are made of, and flagging every rgba(0,0,0,.06) would bury the
     finding that matters under fifty that do not. */
  allowed.add("#ffffff");
  allowed.add("#000000");

  const invented = [...used].filter((colour) => !allowed.has(colour));
  if (invented.length > 0) {
    issues.push({
      gate: "design",
      severity: invented.length > 2 ? "error" : "warning",
      rule: "design/colour",
      message: `${invented.length} colour${invented.length === 1 ? "" : "s"} not in the design system: ${invented.slice(0, 6).join(", ")}. Use var(--ink), var(--muted), var(--accent) and the rest of the tokens.`,
    });
  }

  /* Radii. A system with three radii and a page with seven is a page whose
     components were each designed on their own. */
  const radii = new Set(
    [...styles.matchAll(/border-radius\s*:\s*([^;}"]+)/gi)]
      .map((match) => match[1].trim().toLowerCase())
      .filter((value) => !value.includes("var(")),
  );
  const allowedRadii = new Set(
    [dna.radius.sm, dna.radius.md, dna.radius.lg, dna.radius.pill, "0", "50%", "999px", "100%"].map((r) =>
      r.toLowerCase(),
    ),
  );
  const strayRadii = [...radii].filter((value) => !allowedRadii.has(value));
  if (strayRadii.length > 2) {
    issues.push({
      gate: "design",
      severity: "warning",
      rule: "design/radius",
      message: `${strayRadii.length} radii outside the system: ${strayRadii.slice(0, 5).join(", ")}. The system has ${dna.radius.sm}, ${dna.radius.md} and ${dna.radius.lg}.`,
    });
  }

  /* Font sizes. Off-scale type is the tell that a heading was sized by eye. */
  const scale = new Set(typeScale(dna.type).map((step) => `${step.px}px`));
  const sizes = new Set(
    [...styles.matchAll(/font-size\s*:\s*([\d.]+px)/gi)].map((match) => match[1].toLowerCase()),
  );
  const offScale = [...sizes].filter((size) => !scale.has(size));
  if (offScale.length > 3) {
    issues.push({
      gate: "design",
      severity: "warning",
      rule: "design/type-scale",
      message: `${offScale.length} font sizes outside the scale: ${offScale.slice(0, 6).join(", ")}. Use var(--text-sm) … var(--text-4xl).`,
    });
  }

  /* A second webfont. The system allows at most one, and a page that links two
     is carrying a typeface nobody chose. */
  const webfonts = [...html.matchAll(/fonts\.googleapis\.com\/css2\?family=([^"'&]+)/gi)].map(
    (match) => decodeURIComponent(match[1].replace(/\+/g, " ")),
  );
  const families = new Set(webfonts.map((family) => family.split(":")[0]));
  const permitted = dna.type.webfont ? 1 : 0;
  if (families.size > permitted) {
    issues.push({
      gate: "design",
      severity: "error",
      rule: "design/webfont",
      message:
        permitted === 0
          ? `This system uses system fonts and the page loads ${families.size}: ${[...families].join(", ")}.`
          : `This system allows one webfont (${dna.type.webfont?.family}) and the page loads ${families.size}: ${[...families].join(", ")}.`,
    });
  }

  return {
    ran: true,
    passed: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

function normaliseHex(value: string): string {
  const clean = value.trim().toLowerCase().replace(/^#/, "");
  const full = clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean.slice(0, 6);
  return `#${full}`;
}

/* ── Accessibility (§7) ────────────────────────────────────────────────────
 *
 * The structural half, which is the half a document can answer. Contrast is
 * measured against the design system's own palette using the one contrast
 * implementation — see contrast.ts, and §7, which asks for exactly that.
 */
export function accessibilityGate(html: string, dna: DesignDNA | null | undefined): GateResult {
  const issues: Issue[] = [];
  const markup = markupOf(html);

  /* One h1. Zero leaves a screen reader with no title for the page; several
     leaves it with no way to tell which is the page's subject. */
  const h1s = (markup.match(/<h1\b/gi) ?? []).length;
  if (h1s === 0) {
    issues.push({
      gate: "accessibility",
      severity: "error",
      rule: "a11y/h1",
      message: "The page has no <h1>, so nothing states what it is.",
    });
  } else if (h1s > 1) {
    issues.push({
      gate: "accessibility",
      severity: "warning",
      rule: "a11y/h1-many",
      message: `The page has ${h1s} <h1> elements. One states the subject; several state nothing.`,
    });
  }

  /* Heading levels that skip. h2 → h4 tells assistive technology there is a
     level of structure that is not there. */
  const levels = [...markup.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
  const skipped = levels.find((level, index) => index > 0 && level - levels[index - 1] > 1);
  if (skipped) {
    issues.push({
      gate: "accessibility",
      severity: "warning",
      rule: "a11y/heading-order",
      message: `The heading levels skip to h${skipped}, which describes a structure the page does not have.`,
    });
  }

  /* Images without alt. Decorative ones are alt="" and are correct; the
     finding is a missing attribute, not an empty one. */
  const images = [...markup.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const noAlt = images.filter((tag) => !/\balt\s*=/i.test(tag));
  if (noAlt.length > 0) {
    issues.push({
      gate: "accessibility",
      severity: "error",
      rule: "a11y/alt",
      message: `${noAlt.length} image${noAlt.length === 1 ? " has" : "s have"} no alt attribute. Describe it, or set alt="" if it is decorative.`,
    });
  }

  /* A button with no text and no label is a button a screen reader announces
     as "button". Icon-only controls are the usual culprit. */
  const buttons = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
  const unnamed = buttons.filter((match) => {
    const attributes = match[1];
    const text = match[2].replace(/<[^>]+>/g, "").trim();
    return text.length === 0 && !/aria-label\s*=|aria-labelledby\s*=|title\s*=/i.test(attributes);
  });
  if (unnamed.length > 0) {
    issues.push({
      gate: "accessibility",
      severity: "error",
      rule: "a11y/button-name",
      message: `${unnamed.length} button${unnamed.length === 1 ? " has" : "s have"} no accessible name. Add aria-label to an icon-only control.`,
    });
  }

  /* Inputs with nothing naming them. A placeholder is not a label: it
     disappears the moment somebody types. */
  const inputs = [...markup.matchAll(/<input\b([^>]*)>/gi)]
    .map((match) => match[1])
    .filter((attributes) => !/type\s*=\s*["'](hidden|submit|button|image)["']/i.test(attributes));
  const labelledIds = new Set(
    [...markup.matchAll(/<label\b[^>]*\bfor\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]),
  );
  const unlabelled = inputs.filter((attributes) => {
    if (/aria-label\s*=|aria-labelledby\s*=/i.test(attributes)) return false;
    const id = attributes.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
    return !id || !labelledIds.has(id);
  });
  if (unlabelled.length > 0) {
    issues.push({
      gate: "accessibility",
      severity: unlabelled.length > 2 ? "error" : "warning",
      rule: "a11y/label",
      message: `${unlabelled.length} form field${unlabelled.length === 1 ? " has" : "s have"} no label. A placeholder is not one — it vanishes as soon as somebody types.`,
    });
  }

  /* Focus deliberately removed. `outline: none` with nothing put back is a
     keyboard user navigating a page with no visible cursor. */
  const styles = stylesOf(html);
  if (/outline\s*:\s*(none|0)\b/i.test(styles) && !/:focus-visible|:focus\b[^{]*\{[^}]*outline/i.test(styles)) {
    issues.push({
      gate: "accessibility",
      severity: "warning",
      rule: "a11y/focus",
      message: "Focus outlines are removed and nothing replaces them, so keyboard navigation has no visible cursor.",
    });
  }

  /* And the palette itself, through the one contrast implementation. */
  if (dna) {
    const pairs = [
      contrastCheck("body text on the page", dna.color.ink, dna.color.ground, AAA_TEXT),
      contrastCheck("secondary text on the page", dna.color.muted, dna.color.ground, AA_TEXT),
      contrastCheck("secondary text on a card", dna.color.muted, dna.color.surface, AA_TEXT),
      contrastCheck("a button's label", dna.color.accentInk, dna.color.accent, AA_TEXT),
    ];

    for (const pair of pairs.filter((entry) => !entry.passed)) {
      issues.push({
        gate: "accessibility",
        severity: "error",
        rule: "a11y/contrast",
        message: `${pair.what} is ${pair.ratio ?? "unreadable"}:1 against ${pair.background}, and needs ${pair.floor}:1.`,
      });
    }
  }

  return {
    ran: true,
    passed: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

/* ── Functional (§5, §6) ───────────────────────────────────────────────────
 *
 * Presence, not behaviour. A document cannot be clicked, so what is answerable
 * here is whether the thing that would be clicked exists at all — a store with
 * no add-to-cart anywhere in it is a store that cannot work, and that is worth
 * catching without a browser. Whether pressing it does anything is a rendered
 * question and is reported by render.ts.
 */
export function functionalGate(
  html: string,
  tree: FileTree,
  manifest: ArchitectureManifest | null | undefined,
): GateResult {
  const plan = planFor(manifest);
  if (!plan.derivable) return emptyGate(false);

  const issues: Issue[] = [];
  const markup = markupOf(html);
  const paths = tree.map((file) => file.path).join("\n");

  for (const expectation of plan.expectations) {
    /* Either test satisfies it. A project of files answers on its paths and a
       single page answers on its markup, and an expectation that offers both is
       satisfied by whichever applies. */
    const byMarkup = expectation.markup ? expectation.markup.test(markup) : null;
    const byPath = expectation.paths && tree.length > 0 ? expectation.paths.test(paths) : null;

    if (byMarkup === null && byPath === null) continue;
    if (byMarkup === true || byPath === true) continue;

    issues.push({
      gate: "functional",
      severity: expectation.soft ? "warning" : "error",
      rule: expectation.rule,
      message: `Nothing in this project shows that ${expectation.what}.`,
    });
  }

  /* Links that go nowhere. The oldest tell of a generated page: a navigation
     of six items where every href is "#". */
  const dead = (markup.match(/href\s*=\s*["']#["']/gi) ?? []).length;
  if (dead > 2) {
    issues.push({
      gate: "functional",
      severity: "error",
      rule: "functional/dead-links",
      message: `${dead} links point at "#" and go nowhere.`,
    });
  }

  /* Anchors naming a section that does not exist. Worse than a dead link,
     because it looks like it works until it is pressed. */
  const targets = [...markup.matchAll(/href\s*=\s*["']#([\w-]+)["']/gi)].map((match) => match[1]);
  const ids = new Set([...html.matchAll(/\sid\s*=\s*["']([\w-]+)["']/gi)].map((match) => match[1]));
  const broken = [...new Set(targets.filter((target) => !ids.has(target)))];
  if (broken.length > 0) {
    issues.push({
      gate: "functional",
      severity: "error",
      rule: "functional/broken-anchors",
      message: `${broken.length} link${broken.length === 1 ? " points" : "s point"} at a section that does not exist: ${broken.slice(0, 5).map((id) => `#${id}`).join(", ")}.`,
    });
  }

  return {
    ran: true,
    passed: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

/* ── The visual findings a document can carry ──────────────────────────────
 *
 * Not layout — layout needs a browser. These are the constructions that cause
 * layout failures, and they are visible in the markup: a fixed width wider than
 * a phone, an image with no dimensions, a table with nothing letting it scroll.
 * Catching them here means the common mobile overflow is found on every build
 * rather than only on the ones that got rendered.
 */
export function staticVisualGate(html: string): GateResult {
  const issues: Issue[] = [];
  const styles = stylesOf(html) + " " + [...html.matchAll(/style\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join(";");

  /* A width wider than the narrowest phone this is judged at. The single most
     common cause of horizontal scrolling on mobile, and it is right here in the
     stylesheet. */
  const widths = [...styles.matchAll(/(?<!max-|min-)\bwidth\s*:\s*(\d{3,})px/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 390);
  if (widths.length > 0) {
    issues.push({
      gate: "visual",
      severity: "error",
      rule: "visual/fixed-width",
      message: `${widths.length} fixed width${widths.length === 1 ? "" : "s"} wider than a phone (${[...new Set(widths)].slice(0, 4).join("px, ")}px). Use max-width so it can shrink.`,
    });
  }

  /* An image with neither dimension. The optimiser is off in a generated
     project, so this is a layout that jumps as each picture arrives. */
  const images = [...markupOf(html).matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const undimensioned = images.filter(
    (tag) => !/\bwidth\s*=|\bheight\s*=|aspect-ratio|\bstyle\s*=\s*"[^"]*height/i.test(tag),
  );
  if (undimensioned.length > 2) {
    issues.push({
      gate: "visual",
      severity: "warning",
      rule: "visual/image-dimensions",
      message: `${undimensioned.length} images carry no width, height or aspect-ratio, so the layout shifts as each one loads.`,
    });
  }

  /* A table with nothing letting it scroll. Tables do not wrap: on a phone one
     either scrolls in its own container or pushes the whole page sideways. */
  const tables = (markupOf(html).match(/<table\b/gi) ?? []).length;
  if (tables > 0 && !/overflow-x\s*:\s*(auto|scroll)/i.test(styles)) {
    issues.push({
      gate: "visual",
      severity: "warning",
      rule: "visual/table-overflow",
      message: `${tables} table${tables === 1 ? "" : "s"} with nothing to scroll in. A table does not wrap — on a phone it takes the page sideways with it.`,
    });
  }

  /* ── Nothing in this page changes with the screen ────────────────────
   *
   * The deepest version of the mobile failure, and the one every other
   * responsive finding is a symptom of: a document with no media queries, no
   * responsive utility classes and no intrinsic sizing was designed at one
   * width and shipped at all of them. It usually looks fine on the laptop it
   * was written on, which is why it reaches customers.
   *
   * Three ways of being responsive are accepted, because all three are real:
   * media queries, a utility framework's breakpoint prefixes, and intrinsic
   * layout — `auto-fit`/`minmax`, `clamp()`, `flex-wrap`. Any one of them is
   * evidence somebody thought about width. */
  const hasMediaQueries = /@media[^{]*\b(min|max)-width/i.test(styles);
  const hasUtilityBreakpoints = /\b(sm|md|lg|xl|2xl):[a-z-]/.test(html);
  const hasIntrinsic = /\b(auto-fit|auto-fill|minmax\s*\(|clamp\s*\(|flex-wrap\s*:\s*wrap)/i.test(
    styles + html,
  );

  if (html.length > 1500 && !hasMediaQueries && !hasUtilityBreakpoints && !hasIntrinsic) {
    issues.push({
      gate: "visual",
      severity: "error",
      rule: "visual/no-breakpoints",
      message:
        "Nothing in this page changes with the width of the screen — no media queries, no responsive classes, no fluid sizing. It was laid out once and shipped at every size.",
    });
  }

  /* Overflow hidden on the page itself.
   *
   * The fix everybody reaches for and the one that makes the defect
   * unmeasurable: the sideways scrolling stops, the content that was hanging
   * off the side is now unreachable instead of merely awkward, and every
   * layout check downstream goes quiet. Reported as a warning rather than an
   * error because a few designs genuinely need it — but it is named, because
   * it is far more often a symptom being covered up. */
  if (/\b(?:html|body)[^{}]*\{[^}]*overflow-x\s*:\s*hidden/i.test(styles)) {
    issues.push({
      gate: "visual",
      severity: "warning",
      rule: "visual/overflow-hidden",
      message:
        "The page hides its own horizontal overflow. That stops the sideways scrolling without fixing what is too wide — whatever was hanging off the side is now cut off instead.",
    });
  }

  /* A grid that cannot become one column. `repeat(4, 1fr)` is four columns at
     every width including 320px, where each is 70px wide. `auto-fit` with a
     `minmax` floor is the same layout on a laptop and a correct one on a
     phone. */
  const rigidGrids = [...styles.matchAll(/grid-template-columns\s*:\s*repeat\(\s*(\d+)\s*,/gi)]
    .map((match) => Number(match[1]))
    .filter((columns) => columns >= 3);
  if (rigidGrids.length > 0 && !hasMediaQueries && !hasUtilityBreakpoints) {
    issues.push({
      gate: "visual",
      severity: "warning",
      rule: "visual/rigid-grid",
      message: `${rigidGrids.length} grid${rigidGrids.length === 1 ? " holds" : "s hold"} a fixed column count (${[...new Set(rigidGrids)].join(", ")}) at every width. Use repeat(auto-fit, minmax(min(100%, 260px), 1fr)) so the columns become one on a phone.`,
    });
  }

  /* No viewport meta. Every responsive rule in the document is inert without
     it, and the page renders at desktop width on a phone. */
  if (!/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(html)) {
    issues.push({
      gate: "visual",
      severity: "error",
      rule: "visual/viewport-meta",
      message: "There is no viewport meta tag, so every responsive rule in the page is ignored on a phone.",
    });
  }

  return {
    ran: true,
    passed: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}
