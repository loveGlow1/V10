/* Turning a finding into the smallest change that fixes it.
 *
 * §9 is emphatic and it is right: a QA gate that responds to one overflowing
 * element by regenerating the application has thrown away a working project to
 * fix a fixed width. It also costs a full build, takes minutes, and produces a
 * different page — so the person who reported "the menu overlaps on my phone"
 * gets back something they now have to re-read from the top.
 *
 * So a repair is an INSTRUCTION, narrow enough to be applied by the existing
 * edit path (see src/lib/builder/edit.ts, which patches a document by search
 * and replace and refuses rather than guessing). This module writes the
 * instruction; it does not apply it.
 *
 * ── What is deliberately not repairable ───────────────────────────────────
 *
 * Most findings. A broken image, a missing empty state, a contrast failure in
 * the palette — each has a cause outside the document, and a model asked to fix
 * one inside the document will invent something that makes the symptom go away.
 * An unrepairable finding is reported and left, which is the honest outcome:
 * §10's structured failure says what remains unresolved rather than claiming a
 * fix nobody made.
 */

import type { Issue } from "./types";

export type Repair = {
  /** The finding this addresses. */
  rule: string;
  /** What to change, as an instruction the edit path can act on. */
  instruction: string;
  /* Whether applying this can be verified by re-running QA. Everything here
     can — a repair whose success cannot be measured is a repair nobody should
     be applying automatically. */
  verifiable: true;
};

/**
 * The repair for one finding, or null when there is not a safe one.
 *
 * Written as instructions about the DEFECT rather than about the fix wherever
 * possible: "this element is wider than the screen" leaves the model free to
 * fix it correctly for the layout it is in, where "add max-width: 100%" is a
 * guess that sometimes makes it worse.
 */
export function repairFor(issue: Issue): Repair | null {
  switch (issue.rule) {
    case "responsive/horizontal-scroll":
    case "responsive/overflow":
      return {
        rule: issue.rule,
        instruction: `${issue.where ? `The element ${issue.where}` : "Something in the layout"} is wider than the screen on a phone and pushes the whole page sideways. Find what is fixing its width — a px width, a min-width, a grid column that cannot shrink, a long unbroken string — and make it able to narrow. Do not add horizontal scrolling to hide it, and change nothing else.`,
        verifiable: true,
      };

    case "visual/fixed-width":
      return {
        rule: issue.rule,
        instruction:
          "Some elements have a fixed pixel width wider than a phone screen. Replace each `width: NNNpx` with `max-width: NNNpx; width: 100%` so it holds its size where there is room and shrinks where there is not. Change nothing else.",
        verifiable: true,
      };

    case "visual/viewport-meta":
      return {
        rule: issue.rule,
        instruction:
          'The document has no viewport meta tag, so every responsive rule in it is ignored on a phone. Add `<meta name="viewport" content="width=device-width, initial-scale=1">` inside <head>. Change nothing else.',
        verifiable: true,
      };

    case "a11y/alt":
      return {
        rule: issue.rule,
        instruction:
          "Some <img> tags have no alt attribute. Add one to each, describing what the picture shows in a few words — or alt=\"\" if it is purely decorative. Change nothing else about them.",
        verifiable: true,
      };

    case "a11y/button-name":
      return {
        rule: issue.rule,
        instruction:
          "Some buttons contain only an icon and have no accessible name, so a screen reader announces them as \"button\". Add an aria-label naming the action each one performs. Change nothing else.",
        verifiable: true,
      };

    case "a11y/label":
      return {
        rule: issue.rule,
        instruction:
          "Some form fields have nothing naming them. Give each a <label for=\"…\"> matching the field's id, or an aria-label where a visible label would not fit. A placeholder is not a label — keep it and add the label as well.",
        verifiable: true,
      };

    case "a11y/h1":
      return {
        rule: issue.rule,
        instruction:
          "The page has no <h1>. The heading that states what this page is should be an <h1>; promote it from whatever level it is at now, and leave the rest of the heading order intact.",
        verifiable: true,
      };

    case "a11y/focus":
      return {
        rule: issue.rule,
        instruction:
          "Focus outlines are removed with `outline: none` and nothing replaces them, so a keyboard user cannot see where they are. Add a visible `:focus-visible` style — an outline or a ring in the design system's accent — to every interactive element. Change nothing else.",
        verifiable: true,
      };

    case "visual/table-overflow":
      return {
        rule: issue.rule,
        instruction:
          "A table has nothing letting it scroll, so on a phone it takes the page sideways with it. Wrap each table in a container with `overflow-x: auto`. Change nothing else.",
        verifiable: true,
      };

    case "functional/dead-links":
    case "functional/broken-anchors":
      return {
        rule: issue.rule,
        instruction: `${issue.message} Point each at the section it names — add the matching id to that section, or change the href to one that exists. Do not delete the links.`,
        verifiable: true,
      };

    case "design/colour":
      return {
        rule: issue.rule,
        instruction: `${issue.message} Replace each with the nearest token. Do not change the design — the tokens are the colours this project already has.`,
        verifiable: true,
      };

    case "design/webfont":
      return {
        rule: issue.rule,
        instruction: `${issue.message} Remove the extra font links and the font-family declarations naming them, so the page uses only the families the design system defines.`,
        verifiable: true,
      };

    /* Everything else. A broken image is a pipeline problem, a missing empty
       state is a design decision, a palette that fails contrast is a fault in
       the design system rather than in the page — and "fix it in the document"
       would produce a page that hides each of those rather than one where they
       are fixed. */
    default:
      return null;
  }
}

/**
 * The repairs for a run, worst first and one per rule.
 *
 * Deduplicated by rule because six overflowing elements are one defect with six
 * symptoms: sending six near-identical instructions spends six edits fixing
 * something the first one addressed, and each edit is a chance to break
 * something that was working.
 */
export function repairsFor(issues: Issue[], limit = 4): Repair[] {
  const errors = issues.filter((issue) => issue.severity === "error");
  const seen = new Set<string>();
  const repairs: Repair[] = [];

  for (const issue of errors) {
    if (seen.has(issue.rule)) continue;
    const repair = repairFor(issue);
    if (!repair) continue;
    seen.add(issue.rule);
    repairs.push(repair);
    if (repairs.length >= limit) break;
  }

  return repairs;
}

/**
 * The repairs as one instruction for one edit.
 *
 * One edit rather than one per repair: each pass through the edit path re-reads
 * and rewrites the document, so four passes are four chances for a patch to
 * land badly. They are numbered so a model that can only manage some of them
 * does the ones at the top, which is why repairsFor returns them worst first.
 */
export function repairInstruction(repairs: Repair[]): string {
  if (repairs.length === 0) return "";

  return `Fix these specific problems and change nothing else. Do not redesign anything, do not rewrite sections that are not named here, and do not add features.

${repairs.map((repair, index) => `${index + 1}. ${repair.instruction}`).join("\n\n")}`;
}

/** What was attempted, for §10's structured failure. */
export function describeRepairs(repairs: Repair[]): string {
  if (repairs.length === 0) return "nothing here could be repaired automatically";
  return repairs.map((repair) => repair.rule).join(", ");
}
