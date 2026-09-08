/* Whether anybody composed the page, as against whether it fits.
 *
 * The other gates ask questions with mechanical answers: does it scroll
 * sideways, does every image have alt text, does the palette match the system.
 * A page can pass all of them and still be the thing people actually complain
 * about — a hero whose subject is cut off at the bottom and hidden behind the
 * header at the top, a heading with one stranded word on its second line, a
 * two-hundred-pixel hole between two sections, cards that miss lining up by
 * three pixels. None of that is a bug in the markup. All of it is the first
 * thing anybody sees.
 *
 * ── Two halves, and why ───────────────────────────────────────────────────
 *
 * The static half reads the document and asks whether a framing DECISION was
 * ever taken: did anybody say where the subject sits, or did the picture get
 * `object-fit: cover` because that is what one writes. That runs everywhere,
 * including in the serverless function where there is no browser.
 *
 * The rendered half measures what the decision produced. Whether a frame is
 * throwing away 60% of a photograph is arithmetic over two aspect ratios, and
 * both of them are things only a laid-out page knows.
 *
 * ── The bar for an error ──────────────────────────────────────────────────
 *
 * An error fails the gate and starts a repair round, so only two things here
 * are errors: a picture whose frame is destroying it, and a header sitting on
 * the content. Both are unambiguous — nobody has ever wanted either — and both
 * have a repair that is a change to one declaration. Everything else is a
 * warning, because "this heading has an orphan" is a judgement, and a gate that
 * fails a build over a judgement is a gate somebody turns off.
 */

import { NO_COMPOSITION, type Composition, type Measurement } from "./render";
import { type GateResult, type Issue, emptyGate } from "./types";

/* ── The document half ─────────────────────────────────────────────────────*/

/** Every <img …> tag, with the attributes this gate cares about. */
function images(html: string): { tag: string; attribute: (name: string) => string }[] {
  return [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => {
    const tag = match[0];
    return {
      tag,
      attribute: (name: string) =>
        tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1]?.trim() ?? "",
    };
  });
}

/* Nothing here asks whether the page has breakpoints at all.
 *
 * It is a composition question and it is already asked: `visual/no-breakpoints`
 * in static.ts fires on a page that was laid out once and shipped at every
 * size. A second rule saying the same thing in different words would double
 * every report of it, and a gate that reports one defect twice is a gate people
 * start skimming. What belongs here is what THAT rule cannot see — how a
 * picture is framed, and what its frame is doing to it. */

/**
 * What the document itself says about how its pictures are framed.
 *
 * Always runs — there is nothing here that needs a browser — so the composition
 * gate reports as exercised on every build rather than only where Chromium
 * exists. The rendered findings merge into it where they were measured.
 */
export function staticCompositionGate(html: string): GateResult {
  const issues: Issue[] = [];
  const all = images(html);
  const styles = [...html.matchAll(/<style[\s\S]*?<\/style>/gi)].map((match) => match[0]).join("\n");

  for (const image of all) {
    const focal = image.attribute("data-focal");
    const fit = image.attribute("data-fit");
    const zoom = image.attribute("data-zoom");
    if (!focal && !fit && !zoom) continue;

    /* A framing that was declared and never compiled.
     *
     * `data-focal` is intent; `object-position` is what a browser acts on, and
     * the pipeline turns the first into the second on the way past (see
     * autofix.ts). A tag carrying the attribute and not the declaration is a
     * framing decision that does nothing at all — which is worse than not
     * having taken one, because everything downstream reports that the picture
     * was framed. */
    const style = image.attribute("style");
    if (focal && !/object-position\s*:/i.test(style)) {
      issues.push({
        gate: "composition",
        severity: "error",
        rule: "composition/uncompiled-focal",
        message: `An image declares data-focal="${focal}" and has no object-position, so the focal point does nothing. The attribute has to become a declaration.`,
        where: image.attribute("alt") || image.attribute("data-shot") || "an image",
      });
    }
    if (fit && !/object-fit\s*:/i.test(style)) {
      issues.push({
        gate: "composition",
        severity: "error",
        rule: "composition/uncompiled-focal",
        message: `An image declares data-fit="${fit}" and has no object-fit, so the frame is behaving however the browser defaults.`,
        where: image.attribute("alt") || image.attribute("data-shot") || "an image",
      });
    }
  }

  /* The lead picture with nobody's decision on it.
   *
   * A photograph slot exists because the design wanted a photograph there, and
   * where the subject sits inside it is the difference between a hero and a
   * texture. Not an error: centred is sometimes right, and a gate that insists
   * on an attribute is a gate that gets an attribute rather than a decision. */
  const hero = all.find((image) => image.attribute("data-weight").toLowerCase() === "hero");
  if (hero && !hero.attribute("data-focal") && !/object-position\s*:/i.test(hero.attribute("style"))) {
    issues.push({
      gate: "composition",
      severity: "warning",
      rule: "composition/unframed-hero",
      message:
        "The hero picture has no focal point. It will be centred, which crops equally off every side — decide where the subject sits with data-focal, or say so with object-position.",
      where: hero.attribute("alt") || hero.attribute("data-shot") || "the hero image",
    });
  }

  /* A slot with no shape. Until the picture arrives the box has no height, so
     the page lays out once without it and again with it, and everything below
     jumps.
   *
     Asked of the DOCUMENT rather than of the tag, which is the correction after
     this fired on a perfectly good page: `.hero img { aspect-ratio: 16/9 }` in
     the stylesheet is the ordinary way to shape a slot, and a rule that only
     looked at the tag reported it as unshaped. What is being caught is a page
     where nobody gave the pictures a shape anywhere. */
  const shapedSomewhere =
    /aspect-ratio\s*:/i.test(styles) || /\bimg\b[^{}]*\{[^}]*\bheight\s*:/i.test(styles);

  for (const image of shapedSomewhere ? [] : all) {
    if (!image.attribute("data-shot")) continue;
    const tag = image.tag;
    if (/aspect-ratio\s*:/i.test(tag) || /\bheight\s*=/i.test(tag) || /\baspect-\[?/i.test(tag)) continue;
    if (/\b(?:h-|min-h-)\S+/i.test(image.attribute("class"))) continue;

    issues.push({
      gate: "composition",
      severity: "warning",
      rule: "composition/no-frame-shape",
      message:
        "A photograph slot has no aspect-ratio and no height, so its box has no shape until the picture loads and everything under it moves when it does.",
      where: image.attribute("alt") || image.attribute("data-shot"),
    });
    break;
  }

  return { ran: true, passed: !issues.some((issue) => issue.severity === "error"), issues };
}

/* ── The rendered half ─────────────────────────────────────────────────────*/

/**
 * What the measurements say about the composition.
 *
 * Reads defensively for the same reason gatesFrom does: a measurement can come
 * from a renderer that predates this block entirely, and a missing field has to
 * mean "not looked at" rather than a thrown TypeError that takes the gate down
 * and reports it as not run.
 */
export function renderedCompositionGate(measurements: Measurement[]): GateResult {
  if (measurements.length === 0) return emptyGate(false);

  const measured = measurements.filter((entry) => entry.composition);
  if (measured.length === 0) return emptyGate(false);

  const issues: Issue[] = [];
  /* One finding per defect, not one per viewport. A hero cropped at 55% is
     cropped at every width, and reporting it six times buries the five other
     things that are wrong. Layout findings elsewhere ARE per viewport, because
     which widths they break at is the question; this is not. */
  const seen = new Set<string>();
  const once = (key: string): boolean => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  for (const entry of measured) {
    const viewport = entry.viewport;
    const composition: Composition = { ...NO_COMPOSITION, ...entry.composition };

    /* A frame throwing the picture away. The number is what survives: 40 means
       the box is keeping about 40% of the shape the photograph has. */
    for (const crop of composition.crops) {
      if (!once(`crop:${crop.selector}`)) continue;

      if (crop.fit === "cover") {
        issues.push({
          gate: "composition",
          severity: "error",
          rule: "composition/subject-cropped",
          message: `${crop.selector} is a ${crop.sourceRatio} picture in a ${crop.boxRatio} frame, so ${100 - crop.kept}% of it is being cut away at ${viewport}. Whatever the subject is, most of it is outside the box. Give the frame something closer to the picture's own shape, set a focal point so the crop keeps the subject, or use object-fit: contain and let the box have space in it.`,
          viewport,
          where: crop.selector,
        });
      } else {
        issues.push({
          gate: "composition",
          severity: "error",
          rule: "composition/stretched",
          message: `${crop.selector} is being stretched to fit its box at ${viewport} — a ${crop.sourceRatio} picture in a ${crop.boxRatio} frame with object-fit: ${crop.fit}. Everything in it is the wrong shape. Use cover with a focal point, or contain.`,
          viewport,
          where: crop.selector,
        });
      }
    }

    /* The header sitting on the page rather than above it. */
    for (const collision of composition.headerOver) {
      if (!once(`header:${collision.selector}`)) continue;
      issues.push({
        gate: "composition",
        severity: "error",
        rule: "composition/header-collision",
        message: `The fixed header is ${collision.headerHeight}px tall and covers ${collision.what} at ${viewport} — ${collision.selector}, by ${collision.covered}px. Give what is under it room to clear the header, or move the subject down inside its own frame. Do not shorten the header and do not move the whole page.`,
        viewport,
        where: collision.selector,
      });
    }

    for (const contact of composition.edgeContact) {
      if (!once(`edge:${contact.selector}`)) continue;
      issues.push({
        gate: "composition",
        severity: "warning",
        rule: "composition/edge-contact",
        message: `${contact.selector} sits ${contact.gap}px from the edge of the screen at ${viewport}. Text needs a gutter — the container wants a max-width and padding, not the full width of the window.`,
        viewport,
        where: contact.selector,
      });
    }

    for (const gap of composition.gaps) {
      if (!once(`gap:${gap.after}`)) continue;
      issues.push({
        gate: "composition",
        severity: "warning",
        rule: "composition/whitespace",
        message: `There is a ${gap.height}px hole after ${gap.after} at ${viewport} with nothing in it. Space is deliberate or it is a mistake, and at this size it reads as a section that failed to render.`,
        viewport,
        where: gap.after,
      });
    }

    for (const off of composition.misaligned) {
      if (!once(`align:${off.a}`)) continue;
      issues.push({
        gate: "composition",
        severity: "warning",
        rule: "composition/misaligned",
        message: `${off.a} and ${off.b} are ${off.by}px out of line at ${viewport}. Two things that nearly line up look broken where two things a long way apart look placed — put them on the same edge.`,
        viewport,
        where: off.a,
      });
    }

    for (const problem of composition.typography) {
      if (!once(`type:${problem.selector}:${problem.problem}`)) continue;
      issues.push({
        gate: "composition",
        severity: "warning",
        rule: "composition/type-wrapping",
        message: `${problem.selector} ${problem.problem} at ${viewport}.`,
        viewport,
        where: problem.selector,
      });
    }
  }

  return { ran: true, passed: !issues.some((issue) => issue.severity === "error"), issues };
}
