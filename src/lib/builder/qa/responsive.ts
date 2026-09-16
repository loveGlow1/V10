/* Whether this will look right on a phone, answered without a phone.
 *
 * The `responsive` gate has always existed and has only ever been answerable by
 * render.ts, which needs a browser — fifty megabytes of Chromium that cannot
 * live in a serverless function. So in production it has never run, on any
 * build, ever: every project this platform has shipped went out with its layout
 * unexamined, and "the page on a mobile screen isn't well aligned" is what that
 * sounds like from the other side.
 *
 * A browser is still the only thing that can measure whether a heading overflows
 * its column at 390px. But most of what actually breaks a generated page on a
 * phone is not subtle and is not measured — it is written down in the class
 * list, and it can be read:
 *
 *     w-[1200px]      a page that scrolls sideways on every phone
 *     grid-cols-3     three columns at 390px, each 110px wide
 *     h-screen        content cut off by a browser toolbar that moves
 *     max-w-6xl       a container with no padding, text against the glass
 *
 * Those are the findings here. It does not replace the rendered gate and does
 * not pretend to: see `MEASURED`, below, which is what this cannot see.
 *
 * ── Why so few of these are errors ────────────────────────────────────────
 *
 * Because this reads class lists, and a class list is not a layout. Padding can
 * come from a parent, a fixed height can be exactly what a hero wanted, and a
 * row that never stacks is fine when it holds two icons. A gate that refuses a
 * working page over a stray attribute is a disease this codebase has caught
 * twice already.
 *
 * So only two things are errors, and both are true in every document that has
 * them: a fixed width wider than a phone, and a multi-column grid with no
 * single-column base. Everything else is a warning — reported, never blocking.
 */

import type { FileTree } from "@/lib/builder/tree";
import { type GateResult, type Issue, emptyGate } from "./types";

/** The narrowest screen worth building for. An iPhone SE is 375. */
const PHONE = 390;

/* What a browser would have to answer and this cannot: whether the text
   actually overflows, whether two elements collide, whether a tap target is
   large enough once it is drawn. Named here so that a reader of a passing
   responsive gate knows what "passed" covered. */
export const MEASURED = "overflow, collision and tap-target size are measured by render.ts and need a browser";

/* Every class list in the document, with the file it came from.
 *
 * `className="..."`, `className={"..."}`, `className={`...`}` and plain
 * `class="..."`, which between them is how every generated file writes one. A
 * template literal with an expression in it is read as far as the literal goes:
 * the static half of a conditional class list is still worth reading, and the
 * dynamic half was never going to be legible here. */
const CLASS_LIST = /\b(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`|\{\s*"([^"]*)"|\{\s*'([^']*)')/g;

type Lists = { file: string; classes: string }[];

function classListsIn(source: string, file: string): Lists {
  const out: Lists = [];
  CLASS_LIST.lastIndex = 0;
  for (let match = CLASS_LIST.exec(source); match; match = CLASS_LIST.exec(source)) {
    const classes = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
    if (classes.trim().length > 0) out.push({ file, classes });
  }
  return out;
}

/** A class with any responsive prefix stripped, plus whether it had one. */
function withoutBreakpoint(token: string): { base: string; responsive: boolean } {
  const match = /^(?:(?:sm|md|lg|xl|2xl):)+(.*)$/.exec(token);
  return match ? { base: match[1], responsive: true } : { base: token, responsive: false };
}

/** The pixel number in an arbitrary value, or null. `w-[1200px]` → 1200. */
function pixels(token: string): number | null {
  const match = /\[(\d+(?:\.\d+)?)px\]$/.exec(token);
  return match ? Number(match[1]) : null;
}

function issue(
  severity: Issue["severity"],
  rule: string,
  message: string,
  where: string,
): Issue {
  return { gate: "responsive", severity, rule, message, where, viewport: `${PHONE}px` };
}

/**
 * The responsive findings that need no browser.
 *
 * Takes the document and the tree, because a project's layout lives in its
 * .tsx and a single page's lives in its html, and the same rules apply to both.
 */
export function staticResponsiveGate(html: string, tree: FileTree = []): GateResult {
  const lists: Lists = [];

  for (const file of tree) {
    if (!/\.(?:tsx?|jsx?)$/.test(file.path)) continue;
    lists.push(...classListsIn(file.content, file.path));
  }
  /* A single-page build has no tree worth reading — treeFromPage would hand
     back the document under index.html and we already have it. */
  if (tree.length === 0 && html) lists.push(...classListsIn(html, "the page"));

  const issues: Issue[] = [];
  const said = new Set<string>();

  /* One finding per rule per file. Twenty copies of "this grid has no mobile
     column count" is a wall somebody scrolls past; one, naming the file, is
     something they act on. */
  const once = (found: Issue) => {
    const key = `${found.rule}:${found.where}`;
    if (said.has(key)) return;
    said.add(key);
    issues.push(found);
  };

  for (const { file, classes } of lists) {
    const tokens = classes.split(/\s+/).filter(Boolean);
    const bases = new Set(tokens.map((token) => withoutBreakpoint(token).base));

    for (const token of tokens) {
      const { base, responsive } = withoutBreakpoint(token);
      const px = pixels(base);

      /* ── Wider than the phone it is being read on ────────────────────
         True in every document that has it: a 1200px box inside a 390px
         screen is a page that scrolls sideways, and no parent can rescue it. */
      if (px !== null && /^(?:w|min-w|basis)-/.test(base) && px > PHONE && !responsive) {
        once(issue(
          "error",
          "fixed-width",
          `\`${token}\` is wider than a phone screen, so the page scrolls sideways on every phone. Use \`w-full\` with \`max-w-…\` instead.`,
          file,
        ));
      }

      /* A fixed height crops whatever does not fit, and what fits changes with
         the text, the font and the browser's own moving toolbar. */
      if (base === "h-screen" && !responsive) {
        once(issue(
          "warning",
          "fixed-height",
          "`h-screen` is measured against a viewport that changes size as a phone's toolbar moves, so content gets cut off. Use `min-h-dvh` and let the section grow.",
          file,
        ));
      }
      if (px !== null && /^h-/.test(base) && px >= 400) {
        once(issue(
          "warning",
          "fixed-height",
          `\`${token}\` fixes a height that the text inside it will not respect. Use a minimum height and padding.`,
          file,
        ));
      }

      /* Positioned by coordinates rather than by flow. Fine for a decorative
         blob; for anything with words in it, it is a layout that only works at
         the width it was written at. */
      if (px !== null && /^(?:top|left|right|bottom)-/.test(base) && px >= 40 && bases.has("absolute")) {
        once(issue(
          "warning",
          "absolute-layout",
          `\`${token}\` places something at a fixed coordinate, which does not move when the screen does. Lay it out with flex or grid and let it flow.`,
          file,
        ));
      }
    }

    /* ── A grid that never has one column ──────────────────────────────
       `grid-cols-3` with nothing narrower is three 110px columns on a phone.
       A responsive prefix anywhere on a grid-cols means somebody thought about
       it; a bare one with no `grid-cols-1` means they did not. */
    const columns = tokens.filter((token) => /^(?:(?:sm|md|lg|xl|2xl):)*grid-cols-\d+$/.test(token));
    if (columns.length > 0) {
      const base = columns.find((token) => !withoutBreakpoint(token).responsive);
      const count = base ? Number(/grid-cols-(\d+)$/.exec(base)?.[1] ?? "1") : 1;
      if (count > 1) {
        once(issue(
          "error",
          "grid-no-mobile-columns",
          `\`${base}\` applies at every width, so a phone gets ${count} columns side by side. Start at \`grid-cols-1\` and widen at \`sm:\` or \`lg:\`.`,
          file,
        ));
      }
    }

    /* A row that never becomes a column. Fine for two icons, wrong for two
       cards, and this cannot tell them apart — so it is a warning. */
    if (bases.has("flex-row") && !bases.has("flex-col")) {
      const stacks = tokens.some((token) => withoutBreakpoint(token).responsive && withoutBreakpoint(token).base === "flex-row");
      if (!stacks) {
        once(issue(
          "warning",
          "row-never-stacks",
          "`flex-row` with nothing narrower keeps everything side by side on a phone. `flex-col md:flex-row` stacks it and then lays it out.",
          file,
        ));
      }
    }

    /* A container with a width cap and no horizontal padding puts text against
       the edge of the glass. This is the one people SEE. */
    const capped = tokens.some((token) => /^(?:(?:sm|md|lg|xl|2xl):)*max-w-(?:\d|screen-|[234567]xl|xl|lg|md|sm|prose)/.test(token));
    const padded = tokens.some((token) => /^(?:(?:sm|md|lg|xl|2xl):)*(?:px|p|pl|pr)-/.test(token));
    if (capped && bases.has("mx-auto") && !padded) {
      once(issue(
        "warning",
        "no-gutter",
        "A centred container with no horizontal padding puts its text against the edge of the screen on a phone. `px-4 sm:px-6 lg:px-8` is the floor.",
        file,
      ));
    }
  }

  /* Nothing to read is not a pass. A project whose files carry no class list at
     all has not been checked, and saying so is the same rule the rendered gate
     follows. */
  if (lists.length === 0) return emptyGate(false);

  return {
    ran: true,
    passed: !issues.some((found) => found.severity === "error"),
    issues,
  };
}
