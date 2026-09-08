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
 * Six, and mobile is three of them, which is the whole argument of this file.
 * A page checked at one phone width is a page checked at the width that
 * happened to work: 320 is where a fixed 360px card first hangs off the side,
 * 375 is the iPhone most people are holding, and 480 is where a two-column grid
 * decides whether it was ever going to become one column. Desktop gets two
 * because 1280 and 1440 disagree about container padding and about whether a
 * max-width was ever set.
 *
 * They are ordered narrowest first on purpose. A run that is cut short — a
 * timeout, a crashed browser, a CI job that ran out of minutes — then has
 * measured the sizes that break, rather than the ones that were always going to
 * be fine.
 */

import type { GateResult, Issue } from "./types";
import { emptyGate } from "./types";

export type Viewport = { name: string; width: number; height: number };

export const VIEWPORTS: Viewport[] = [
  { name: "small", width: 320, height: 640 },
  { name: "mobile", width: 375, height: 812 },
  { name: "large-mobile", width: 480, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1440, height: 900 },
];

/** Everything at or below 480px, where a layout is a phone layout. */
export const isPhoneViewport = (name: string): boolean =>
  name === "small" || name === "mobile" || name === "large-mobile";

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
  /** Images wider than the box they are in. */
  imageOverflow: { selector: string; width: number; parentWidth: number }[];
  /** Two things in the navigation sitting on top of each other. */
  collisions: { a: string; b: string }[];
  /** Form controls too narrow, too short, or hanging out of their container. */
  formProblems: { selector: string; problem: string }[];
  /** Sections holding a screenful of nothing. */
  emptySections: { selector: string; height: number }[];
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

  /* An image wider than the box holding it. Distinct from page overflow: a
     picture can burst its own card without the page scrolling, and it looks
     exactly as broken. */
  const imageOverflow = [];
  for (const img of Array.from(document.images)) {
    const box = img.getBoundingClientRect();
    if (box.width === 0) continue;
    const parent = img.parentElement;
    if (!parent) continue;
    const parentBox = parent.getBoundingClientRect();
    if (parentBox.width > 0 && box.width > parentBox.width + 2) {
      imageOverflow.push({
        selector: selectorFor(img),
        width: Math.round(box.width),
        parentWidth: Math.round(parentBox.width),
      });
    }
    if (imageOverflow.length >= 6) break;
  }

  /* Navigation on top of itself. The classic phone failure: a horizontal nav
     that never became a menu, so the links stack over the logo. Only the
     direct children of a nav are compared, and only against their siblings —
     an overlap between a link and its own icon is a design, not a defect. */
  const collisions = [];
  const navs = Array.from(document.querySelectorAll("nav, [role=navigation], header"));
  for (const nav of navs) {
    const kids = Array.from(nav.children).filter((el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.position !== "absolute" && style.position !== "fixed";
    });
    for (let i = 0; i < kids.length && collisions.length < 4; i += 1) {
      for (let j = i + 1; j < kids.length && collisions.length < 4; j += 1) {
        const a = kids[i].getBoundingClientRect();
        const b = kids[j].getBoundingClientRect();
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        /* Real overlap, not a shared edge: a quarter of the smaller box in
           both directions before this counts as a collision. */
        if (overlapX > Math.min(a.width, b.width) / 4 && overlapY > Math.min(a.height, b.height) / 4) {
          collisions.push({ a: selectorFor(kids[i]), b: selectorFor(kids[j]) });
        }
      }
    }
  }

  /* Forms that cannot be filled in. A field narrower than a thumb, a control
     shorter than a tap, or one hanging out of the form it belongs to. */
  const formProblems = [];
  for (const field of Array.from(document.querySelectorAll("input, select, textarea, button"))) {
    const box = field.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const type = (field.getAttribute("type") || "").toLowerCase();
    if (type === "hidden" || type === "checkbox" || type === "radio") continue;

    if (box.right > docWidth + 1) {
      formProblems.push({ selector: selectorFor(field), problem: "runs off the right edge" });
    } else if (docWidth <= 480 && box.width < 120 && type !== "submit") {
      formProblems.push({ selector: selectorFor(field), problem: Math.round(box.width) + "px wide, too narrow to type in" });
    } else if (box.height < 28) {
      formProblems.push({ selector: selectorFor(field), problem: Math.round(box.height) + "px tall, too short to tap" });
    }
    if (formProblems.length >= 6) break;
  }

  /* A screenful of nothing. A section taller than the viewport holding almost
     no text and no picture is padding that was never filled — the shape of a
     page assembled rather than designed. */
  const emptySections = [];
  for (const section of Array.from(document.querySelectorAll("section, .section, main > div"))) {
    const box = section.getBoundingClientRect();
    if (box.height < window.innerHeight * 1.2) continue;
    const text = (section.textContent || "").trim();
    const media = section.querySelectorAll("img, svg, video, canvas, picture").length;
    if (text.length < 60 && media === 0) {
      emptySections.push({ selector: selectorFor(section), height: Math.round(box.height) });
    }
    if (emptySections.length >= 4) break;
  }

  return {
    scrollWidth: Math.round(document.documentElement.scrollWidth),
    clientWidth: Math.round(docWidth),
    overflowing,
    brokenImages,
    clipped,
    smallTargets,
    imageOverflow,
    collisions,
    formProblems,
    emptySections,
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

  for (const raw of measurements) {
    /* Read defensively, because a Measurement can come from a renderer this
       module did not write — the CLI, a CI job, a worker running a version of
       MEASURE_SCRIPT from before a field existed. A missing array must mean
       "nothing found for that check", never a thrown TypeError that takes the
       whole responsive gate down with it and reports it as not run. */
    const measurement: Measurement = {
      ...raw,
      overflowing: raw.overflowing ?? [],
      brokenImages: raw.brokenImages ?? [],
      clipped: raw.clipped ?? [],
      smallTargets: raw.smallTargets ?? [],
      imageOverflow: raw.imageOverflow ?? [],
      collisions: raw.collisions ?? [],
      formProblems: raw.formProblems ?? [],
      emptySections: raw.emptySections ?? [],
    };
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

    /* A picture bursting its own card. Not page overflow — the page can be
       perfectly contained while every image inside it is 40px too wide — and
       it is the one layout defect a screenshot makes obvious and a scroll
       measurement misses entirely. */
    for (const image of measurement.imageOverflow.slice(0, 3)) {
      responsive.push({
        gate: "responsive",
        severity: "error",
        rule: "responsive/image-overflow",
        message: `${image.selector} is ${image.width}px inside a ${image.parentWidth}px box at ${viewport}, so the picture is cut off or spilling out of it. An image needs max-width: 100% and object-fit: cover.`,
        viewport,
        where: image.selector,
      });
    }

    /* Navigation sitting on top of itself. Always a phone failure and always
       the first thing a visitor sees. */
    for (const collision of measurement.collisions.slice(0, 2)) {
      responsive.push({
        gate: "responsive",
        severity: "error",
        rule: "responsive/collision",
        message: `${collision.a} and ${collision.b} overlap each other in the header at ${viewport}. The navigation has not been given a layout for this width — stack it, or collapse it into a menu.`,
        viewport,
        where: collision.a,
      });
    }

    /* A form that cannot be filled in is a page that cannot be used, whatever
       else is right about it. */
    for (const problem of measurement.formProblems.slice(0, 3)) {
      responsive.push({
        gate: "responsive",
        severity: problem.problem.includes("off the right") ? "error" : "warning",
        rule: "responsive/form-unusable",
        message: `${problem.selector} ${problem.problem} at ${viewport}.`,
        viewport,
        where: problem.selector,
      });
    }

    /* Empty space, which is a design finding rather than a layout one — but it
       is only measurable here, with the page laid out. */
    for (const section of measurement.emptySections.slice(0, 2)) {
      visual.push({
        gate: "visual",
        severity: "warning",
        rule: "visual/empty-section",
        message: `${section.selector} is ${section.height}px tall at ${viewport} with almost nothing in it. A section exists because it has something to say.`,
        viewport,
        where: section.selector,
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
    for (const image of measurement.brokenImages ?? []) {
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
