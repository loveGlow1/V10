/* The gates that need a browser.
 *
 * Whether a button overflows its container at 390px is not a question the
 * markup can answer. Layout is what a browser computes, so these findings come
 * from actually laying the page out at three sizes and measuring what happened.
 *
 * ── Why this is a port rather than a direct call ──────────────────────────
 *
 * Because it cannot always run, and pretending otherwise would be worse than
 * not having it.
 *
 * The pipeline's QA stage lives in a serverless function. A headless Chromium
 * is fifty megabytes and several seconds of cold start, against a function with
 * a sixty-second ceiling that is already doing a build's worth of work — and a
 * project of `.tsx` cannot be rendered at all without `npm install` and `next
 * build`, neither of which is happening in a request. So a design where the QA
 * stage renders inline would be a design where the QA stage is switched off
 * within a week.
 *
 * Instead: everything answerable without a browser runs on every build (see
 * static.ts), and this runs wherever a browser exists — the CLI, CI, a worker —
 * against the same types and returning the same shape. A run that had no
 * renderer reports `ran: false`, and summarise() turns that into "incomplete"
 * rather than into a pass. A gate nobody exercised is never reported as one
 * that passed.
 *
 * ── The viewports ─────────────────────────────────────────────────────────
 *
 * The three from §2, and they are not arbitrary. 1440×900 is the laptop most
 * of this is looked at on; 768×1024 is the width where two-column layouts have
 * to decide what they are; 390×844 is a current iPhone and the width where
 * everything that was going to break has broken.
 */

import type { GateResult, Issue } from "./types";
import { emptyGate } from "./types";

export type Viewport = { name: string; width: number; height: number };

export const VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

/* What one viewport's measurement comes back as. Deliberately plain data: the
   thing doing the measuring runs inside a browser page and can only return
   values that survive being serialised out of it. */
export type Measurement = {
  viewport: string;
  /** The document's scroll width against the viewport's. Wider means sideways. */
  scrollWidth: number;
  clientWidth: number;
  /** Elements whose right edge is past the viewport, with a way to find them. */
  overflowing: { selector: string; right: number; width: number }[];
  /** Images that resolved to nothing. */
  brokenImages: { src: string; alt: string }[];
  /** Text boxes clipped by a fixed height. */
  clipped: { selector: string }[];
  /** Tap targets under the size a finger can reliably hit. */
  smallTargets: { selector: string; width: number; height: number }[];
  /** Whether anything was actually laid out — a blank render is a failed one. */
  bodyHeight: number;
};

/**
 * The script that runs inside the page.
 *
 * Exported as a string rather than a function because it is evaluated in the
 * browser's context, not this one: it has no access to anything in this module
 * and everything it needs has to be inside it. Kept here rather than in the
 * caller so that every renderer — the CLI, CI, a worker — measures identically.
 */
export const MEASURE_SCRIPT = `(() => {
  const selectorFor = (el) => {
    if (!el || !el.tagName) return "?";
    const id = el.id ? "#" + el.id : "";
    const cls = typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".")
      : "";
    return el.tagName.toLowerCase() + id + cls;
  };

  const docWidth = document.documentElement.clientWidth;
  const all = Array.from(document.querySelectorAll("body *"));

  /* Past the right edge by more than a pixel. The tolerance is not politeness:
     sub-pixel layout routinely lands a full-bleed element at 390.4px, and
     reporting that as overflow makes the gate noise. */
  const overflowing = [];
  for (const el of all) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (box.right > docWidth + 1) {
      overflowing.push({ selector: selectorFor(el), right: Math.round(box.right), width: Math.round(box.width) });
    }
    if (overflowing.length >= 12) break;
  }

  const brokenImages = Array.from(document.images)
    .filter((img) => img.complete && img.naturalWidth === 0)
    .slice(0, 12)
    .map((img) => ({ src: (img.currentSrc || img.src || "").slice(0, 120), alt: img.alt || "" }));

  /* Text taller than the box holding it, where the box is not allowed to
     scroll. That is content the visitor cannot reach. */
  const clipped = [];
  for (const el of all) {
    const style = getComputedStyle(el);
    if (style.overflow !== "hidden" && style.overflowY !== "hidden") continue;
    if (el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0) {
      const text = (el.textContent || "").trim();
      if (text.length > 12) clipped.push({ selector: selectorFor(el) });
    }
    if (clipped.length >= 8) break;
  }

  /* Anything you tap, smaller than a finger. 24px is the floor WCAG 2.2 sets;
     44 is the comfortable one, and flagging everything under 44 on a desktop
     render would report every inline link on the page. */
  const smallTargets = [];
  if (docWidth <= 500) {
    for (const el of document.querySelectorAll("button, a, [role=button], input[type=submit]")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.width < 24 || box.height < 24) {
        smallTargets.push({ selector: selectorFor(el), width: Math.round(box.width), height: Math.round(box.height) });
      }
      if (smallTargets.length >= 8) break;
    }
  }

  return {
    scrollWidth: Math.round(document.documentElement.scrollWidth),
    clientWidth: Math.round(docWidth),
    overflowing,
    brokenImages,
    clipped,
    smallTargets,
    bodyHeight: Math.round(document.body ? document.body.scrollHeight : 0),
  };
})()`;

/**
 * Something that can lay a document out and measure it.
 *
 * One method, and the caller supplies it. This module never imports a browser
 * driver: the pipeline bundles this file and must not drag Chromium into a
 * serverless function that will never use it.
 */
export type Renderer = (html: string, viewport: Viewport) => Promise<Measurement>;

/**
 * The rendered gates, from the measurements.
 *
 * Split into two results because the spec asks two different questions of the
 * same render: `visual` is what is wrong at any size, `responsive` is what is
 * wrong specifically because of size. A broken image is visual at every
 * viewport; horizontal scrolling at 390px is responsive.
 */
export function gatesFrom(measurements: Measurement[]): { visual: GateResult; responsive: GateResult } {
  if (measurements.length === 0) {
    return { visual: emptyGate(false), responsive: emptyGate(false) };
  }

  const visual: Issue[] = [];
  const responsive: Issue[] = [];

  for (const measurement of measurements) {
    const { viewport } = measurement;

    /* A render with no height is a render that produced nothing — a script
       that threw, a stylesheet that hid everything. Worth reporting loudly:
       every other measurement below it is meaningless. */
    if (measurement.bodyHeight < 200) {
      visual.push({
        gate: "visual",
        severity: "error",
        rule: "visual/blank",
        message: `The page rendered ${measurement.bodyHeight}px tall at ${viewport}, which is not a page.`,
        viewport,
      });
      continue;
    }

    /* Sideways scrolling. The single most reported defect on a generated site
       and the one nobody notices on a laptop. */
    if (measurement.scrollWidth > measurement.clientWidth + 1) {
      const by = measurement.scrollWidth - measurement.clientWidth;
      responsive.push({
        gate: "responsive",
        severity: "error",
        rule: "responsive/horizontal-scroll",
        message: `The page scrolls sideways by ${by}px at ${viewport} (${measurement.clientWidth}px). Something inside it is wider than the screen.`,
        viewport,
        where: measurement.overflowing[0]?.selector,
      });
    }

    for (const element of measurement.overflowing.slice(0, 3)) {
      responsive.push({
        gate: "responsive",
        severity: "error",
        rule: "responsive/overflow",
        message: `${element.selector} is ${element.width}px wide and runs ${element.right - measurement.clientWidth}px past the right edge at ${viewport}.`,
        viewport,
        where: element.selector,
      });
    }

    for (const element of measurement.clipped.slice(0, 3)) {
      visual.push({
        gate: "visual",
        severity: "warning",
        rule: "visual/clipped",
        message: `${element.selector} hides text that overflows it at ${viewport}, so some of the content cannot be read.`,
        viewport,
        where: element.selector,
      });
    }

    for (const target of measurement.smallTargets.slice(0, 3)) {
      responsive.push({
        gate: "responsive",
        severity: "warning",
        rule: "responsive/tap-target",
        message: `${target.selector} is ${target.width}×${target.height} at ${viewport}, too small to tap reliably.`,
        viewport,
        where: target.selector,
      });
    }
  }

  /* Broken images are collected across every viewport and reported once.
   *
   * An image that fails to load fails at all three sizes, so reporting per
   * viewport turns one defect into three findings and buries the two below it.
   * Layout findings are NOT deduplicated this way on purpose: the same element
   * overflowing at tablet and at mobile is genuinely two facts, and which
   * viewports it breaks at is the first thing anybody fixing it asks. */
  const brokenSeen = new Set<string>();
  for (const measurement of measurements) {
    for (const image of measurement.brokenImages) {
      const key = image.src || image.alt || "unknown";
      if (brokenSeen.has(key)) continue;
      brokenSeen.add(key);
      visual.push({
        gate: "visual",
        severity: "error",
        rule: "visual/broken-image",
        message: `An image did not load${image.alt ? ` (${image.alt})` : ""}: ${image.src || "no src"}.`,
      });
      if (brokenSeen.size >= 6) break;
    }
    if (brokenSeen.size >= 6) break;
  }

  /* A page whose height barely changes between a laptop and a phone has not
     been laid out for a phone — it has been scaled. §4 names this exactly. */
  const desktop = measurements.find((entry) => entry.viewport === "desktop");
  const mobile = measurements.find((entry) => entry.viewport === "mobile");
  if (desktop && mobile && desktop.bodyHeight > 400) {
    const ratio = mobile.bodyHeight / desktop.bodyHeight;
    if (ratio < 1.15) {
      responsive.push({
        gate: "responsive",
        severity: "warning",
        rule: "responsive/not-reflowed",
        message: `The page is ${Math.round(ratio * 100)}% of its desktop height on a phone. Content that reflows into one column gets taller; a layout that only shrinks does not.`,
        viewport: "mobile",
      });
    }
  }

  return {
    visual: { ran: true, passed: !visual.some((issue) => issue.severity === "error"), issues: visual },
    responsive: {
      ran: true,
      passed: !responsive.some((issue) => issue.severity === "error"),
      issues: responsive,
    },
  };
}

/**
 * Lays the document out at each viewport.
 *
 * Never throws. A renderer that fails on one viewport contributes nothing for
 * it and the others still report — a QA stage that dies on a browser crash is a
 * QA stage that blocks a build for a reason unrelated to the build.
 */
export async function measureAll(
  html: string,
  render: Renderer,
  viewports: Viewport[] = VIEWPORTS,
): Promise<Measurement[]> {
  const out: Measurement[] = [];

  for (const viewport of viewports) {
    try {
      out.push(await render(html, viewport));
    } catch {
      /* Swallowed on purpose, and the absence is the report: a viewport that
         produced no measurement simply contributes no findings, and a run that
         produced none at all comes back with both rendered gates not run. */
    }
  }

  return out;
}
