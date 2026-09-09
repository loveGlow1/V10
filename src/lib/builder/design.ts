/* The design system a project is built to, decided before a line of it is
 * written.
 *
 * The old instruction was one sentence in the shared bar: "one palette, one
 * type scale, one voice". That is advice, and a model given advice invents a
 * palette per section — a page that arrives with four greys, three accent
 * colours, radii of 4px, 8px and 14px, and a heading scale that resets halfway
 * down. Every section is individually fine and together they look like four
 * different companies, which is the same failure the asset planner exists to
 * stop and it was only ever solved for the photographs.
 *
 * So it is solved the same way: ONE system for the whole project, chosen from
 * the brief, handed to the model as values rather than as adjectives.
 *
 * ── Built on the register the pictures already chose ──────────────────────
 *
 * The key decision in this file is that it does not read the brief again.
 * asset-planner.ts already derives a visual register from it — "luxury
 * editorial", "warm documentary", "clean clinical" — and that register is
 * exactly the question this file needs answered. Deriving it twice with two
 * sets of regexes would give two answers, and the day they disagree is the day
 * a project gets warm documentary photography inside a clinical blue interface.
 *
 * One register in, two coherent halves out: the photographs and the interface.
 *
 * ── Why a set of curated systems rather than generated values ─────────────
 *
 * A generator that picks a hue and derives a scale from it produces something
 * defensible and slightly wrong every time — the greys go muddy, the accent
 * fights the photographs, the type scale has no rhythm. These are written by
 * hand, each one internally coherent, each one a look somebody would recognise.
 * Six of them, because six distinct systems that are all good beats an infinite
 * space that is mostly not.
 *
 * Pure on purpose, like kinds.ts, market.ts, stack.ts and architecture.ts: no
 * SDK import, so the browser can read it and tools/check-design.mjs can compile
 * it on its own.
 */

import type { BuildKind } from "./kinds";
import { isDarkColor } from "./qa/contrast";

export type Palette = {
  /** The page. */
  ground: string;
  /** A card, a panel, anything raised off the page. */
  surface: string;
  /** Body text and headings. Must clear 7:1 on the ground. */
  ink: string;
  /** Secondary text. Must clear 4.5:1 on the ground. */
  muted: string;
  /** Hairlines and dividers. Not text — no contrast floor. */
  line: string;
  /** The one colour that means "this is the thing to press". */
  accent: string;
  /** Text ON the accent. Must clear 4.5:1 against it. */
  accentInk: string;
};

export type Typography = {
  /** Headings. A full CSS stack — the first name may be a webfont. */
  display: string;
  /** Body. A stack, and system fonts unless the design is the type. */
  body: string;
  /* The one webfont this project may load, when the typeface genuinely IS the
     design. Null for most: a downloaded page has to carry everything it
     fetches, and a webfont for a heading nobody would notice is weight for
     nothing. See BASE in blueprints/base.ts, which says the same. */
  webfont: { family: string; href: string } | null;
  /** The ratio between steps. 1.2 is calm; 1.333 is dramatic. */
  ratio: number;
  /** Body size in px. Everything else is derived from it and the ratio. */
  base: number;
  /** Heading leading, as a multiple. Body leading is always 1.6. */
  displayLeading: number;
  /** Heading tracking, in em. Negative tightens; large type needs it. */
  displayTracking: string;
  /** Heading weight. */
  displayWeight: number;
};

export type DesignDNA = {
  /** What this system is called, for the step line and for the record. */
  name: string;
  /** The register it was derived from. */
  register: string;
  /** One line on what this looks like, for the model to hold in mind. */
  intent: string;
  type: Typography;
  color: Palette;
  /** The spacing scale, in px. Nothing may use a value that is not in it. */
  space: number[];
  radius: { sm: string; md: string; lg: string; pill: string };
  /** Two shadows at most. A system with five is a system nobody follows. */
  shadow: { sm: string; md: string };
  /** Max content width. */
  container: string;
  motion: { fast: string; base: string; ease: string };
};

/* ── The systems ───────────────────────────────────────────────────────────
 *
 * Each is a whole look. The values are chosen against each other rather than
 * picked off a palette generator: the greys in the clinical system are cool
 * because its accent is blue, and the greys in the craft system are warm
 * because its accent is clay. Swapping one value out of one of these is how it
 * stops working.
 */

const EDITORIAL: DesignDNA = {
  name: "Editorial serif",
  register: "luxury editorial",
  intent:
    "Quiet and expensive. Large serif headings with real air around them, almost no ornament, and the photographs doing the work. Nothing is rounded, nothing glows.",
  type: {
    display: '"Instrument Serif", "Iowan Old Style", Georgia, "Times New Roman", serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    /* The one place a webfont earns its weight: this register IS the
       typeface, and a system serif reads as a document rather than as a
       fashion house. */
    webfont: {
      family: "Instrument Serif",
      href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap",
    },
    ratio: 1.333,
    base: 17,
    displayLeading: 1.05,
    displayTracking: "-0.02em",
    displayWeight: 400,
  },
  color: {
    ground: "#FBFAF8",
    surface: "#FFFFFF",
    ink: "#16150F",
    muted: "#6A6558",
    line: "#E3DFD5",
    accent: "#1F1D16",
    accentInk: "#FBFAF8",
  },
  space: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160],
  radius: { sm: "0px", md: "0px", lg: "0px", pill: "999px" },
  shadow: { sm: "none", md: "0 1px 2px rgba(20,18,12,.06)" },
  container: "1200px",
  motion: { fast: "140ms", base: "260ms", ease: "cubic-bezier(.2,.6,.2,1)" },
};

const CRAFT: DesignDNA = {
  name: "Warm craft",
  register: "warm documentary",
  intent:
    "Made by somebody. Warm paper ground, a clay accent, softly rounded corners and generous line height. Reads as a person's workshop rather than a brand system.",
  type: {
    display:
      '"Iowan Old Style", Charter, Georgia, "Times New Roman", serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    webfont: null,
    ratio: 1.25,
    base: 17,
    displayLeading: 1.15,
    displayTracking: "-0.01em",
    displayWeight: 600,
  },
  color: {
    ground: "#FAF6F0",
    surface: "#FFFFFF",
    ink: "#221C15",
    muted: "#6E6154",
    line: "#E6DCCE",
    accent: "#9A4A24",
    accentInk: "#FFFFFF",
  },
  space: [4, 8, 12, 16, 24, 32, 48, 64, 88, 120, 160],
  radius: { sm: "6px", md: "12px", lg: "20px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(58,42,26,.07)", md: "0 8px 28px rgba(58,42,26,.10)" },
  container: "1140px",
  motion: { fast: "150ms", base: "280ms", ease: "cubic-bezier(.22,.7,.25,1)" },
};

const CLINICAL: DesignDNA = {
  name: "Clinical precision",
  register: "clean clinical",
  intent:
    "Calm and exact. Cool neutrals, one trustworthy blue, hairline rules and small radii. Nothing decorative — every element is legible before it is anything else.",
  type: {
    display: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    webfont: null,
    ratio: 1.2,
    base: 16,
    displayLeading: 1.2,
    displayTracking: "-0.015em",
    displayWeight: 650,
  },
  color: {
    ground: "#FBFCFD",
    surface: "#FFFFFF",
    ink: "#101720",
    muted: "#5A6472",
    line: "#DFE5EC",
    accent: "#1257A6",
    accentInk: "#FFFFFF",
  },
  space: [4, 8, 12, 16, 20, 24, 32, 48, 64, 88, 120],
  radius: { sm: "4px", md: "8px", lg: "12px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(16,23,32,.06)", md: "0 6px 20px rgba(16,23,32,.09)" },
  container: "1120px",
  motion: { fast: "120ms", base: "220ms", ease: "cubic-bezier(.3,.6,.2,1)" },
};

const TECHNICAL: DesignDNA = {
  name: "Technical",
  register: "technical documentary",
  intent:
    "Built, not styled. Near-neutral surfaces, a monospace accent for data and labels, sharp corners and dense information. Confidence comes from precision rather than from colour.",
  type: {
    display: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    webfont: null,
    ratio: 1.2,
    base: 15,
    displayLeading: 1.15,
    displayTracking: "-0.02em",
    displayWeight: 600,
  },
  color: {
    ground: "#0E1013",
    surface: "#16191E",
    ink: "#ECEEF1",
    muted: "#98A0AB",
    line: "#252A32",
    accent: "#5EE6A8",
    accentInk: "#08130D",
  },
  space: [4, 8, 12, 16, 20, 24, 32, 40, 56, 80, 112],
  radius: { sm: "3px", md: "6px", lg: "10px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(0,0,0,.4)", md: "0 10px 30px rgba(0,0,0,.5)" },
  container: "1180px",
  motion: { fast: "110ms", base: "200ms", ease: "cubic-bezier(.3,.7,.2,1)" },
};

const COMMERCIAL: DesignDNA = {
  name: "Modern commercial",
  register: "clear commercial",
  intent:
    "Contemporary and direct. A crisp neutral ground, one confident accent used sparingly, medium radii and soft shadows. The default when nothing in the brief asks for a stronger point of view.",
  type: {
    display: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    webfont: null,
    ratio: 1.25,
    base: 16,
    displayLeading: 1.1,
    displayTracking: "-0.025em",
    displayWeight: 700,
  },
  color: {
    ground: "#FFFFFF",
    surface: "#F7F8FA",
    ink: "#0F1218",
    muted: "#5C6470",
    line: "#E4E7EC",
    accent: "#3D3BE0",
    accentInk: "#FFFFFF",
  },
  space: [4, 8, 12, 16, 24, 32, 40, 56, 80, 112, 144],
  radius: { sm: "6px", md: "10px", lg: "16px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(15,18,24,.06)", md: "0 10px 32px rgba(15,18,24,.10)" },
  container: "1160px",
  motion: { fast: "130ms", base: "240ms", ease: "cubic-bezier(.25,.7,.25,1)" },
};

const PRESS: DesignDNA = {
  name: "Press",
  register: "editorial reportage",
  intent:
    "A publication. Serif headlines set tight, a paper-white ground, rules instead of boxes, and one red reserved for what is breaking. Ranked rather than gridded — the lead story is unmistakably the lead.",
  type: {
    display: 'Charter, "Iowan Old Style", Georgia, "Times New Roman", serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    webfont: null,
    ratio: 1.333,
    base: 17,
    displayLeading: 1.06,
    displayTracking: "-0.02em",
    displayWeight: 700,
  },
  color: {
    ground: "#FFFEFB",
    surface: "#FFFFFF",
    ink: "#111111",
    muted: "#5F5F5F",
    line: "#DCDCD6",
    accent: "#B01A16",
    accentInk: "#FFFFFF",
  },
  space: [4, 8, 12, 16, 20, 28, 40, 56, 76, 104, 140],
  radius: { sm: "0px", md: "0px", lg: "2px", pill: "999px" },
  shadow: { sm: "none", md: "0 2px 8px rgba(0,0,0,.06)" },
  container: "1240px",
  motion: { fast: "120ms", base: "200ms", ease: "cubic-bezier(.2,.6,.2,1)" },
};

export const SYSTEMS = [EDITORIAL, CRAFT, CLINICAL, TECHNICAL, COMMERCIAL, PRESS];

/* Which system each of the asset planner's registers gets.
 *
 * Several registers share a system, deliberately. "editorial fashion" and
 * "luxury editorial" are two words for one look on the page even though they
 * are two different photographic briefs, and giving them separate systems would
 * be inventing a difference to justify the table. */
const BY_REGISTER: { match: RegExp; system: DesignDNA }[] = [
  { match: /luxur|fashion/i, system: EDITORIAL },
  { match: /warm documentary|appetite|food/i, system: CRAFT },
  { match: /clinical/i, system: CLINICAL },
  { match: /technical|functional/i, system: TECHNICAL },
  { match: /reportage|press/i, system: PRESS },
  { match: /commercial|catalogue/i, system: COMMERCIAL },
];

/* And the fallback per kind, for a register none of the above matched. A
   publication falls to Press rather than to the generic commercial system,
   because the wrong answer there is much more obviously wrong. */
const BY_KIND: Record<BuildKind, DesignDNA> = {
  landing: COMMERCIAL,
  ecommerce: COMMERCIAL,
  blog: PRESS,
  news: PRESS,
  webapp: CLINICAL,
};

/* A brief can also name the look outright, and when it does that beats
   everything — including the register, because somebody who wrote "brutalist"
   or "dark mode" has said what they want more directly than a photographic
   register infers it. */
const NAMED: { match: RegExp; system: DesignDNA }[] = [
  { match: /\b(dark mode|dark theme|black background|terminal|developer tool|hacker)\b/i, system: TECHNICAL },
  { match: /\b(editorial|magazine|serif|elegant|refined|understated)\b/i, system: EDITORIAL },
  { match: /\b(newspaper|newsroom|publication|broadsheet)\b/i, system: PRESS },
  { match: /\b(handmade|artisan\w*|rustic|warm|earthy|organic)\b/i, system: CRAFT },
  { match: /\b(clean|minimal|medical|clinical|precise)\b/i, system: CLINICAL },
];

/**
 * A system by name, or null.
 *
 * The name travels rather than the object. Everything in this file is a
 * constant chosen from a set of six, so sending the whole DNA through a webhook
 * would be pushing two hundred bytes of hex codes down a wire to arrive at
 * something already on the other end — and giving every hop between here and
 * the save route a chance to alter a colour. A name cannot be half-corrupted:
 * it either matches one of six or it does not.
 */
export function systemByName(name: unknown): DesignDNA | null {
  if (typeof name !== "string") return null;
  return SYSTEMS.find((system) => system.name === name) ?? null;
}

export type DesignResult = {
  dna: DesignDNA;
  /** One clause for the step list, and for anyone arguing with the answer. */
  reason: string;
};

/**
 * The design system for this project.
 *
 * `register` is the asset planner's, passed in rather than re-derived — see the
 * header. Never throws: a register nobody recognises falls to the kind's
 * default, which is a considered answer rather than a neutral one.
 */
export function decideDesign(register: string, kind: BuildKind, brief: string): DesignResult {
  const named = NAMED.find((entry) => entry.match.test(brief ?? ""));
  if (named) {
    return {
      dna: named.system,
      reason: `the brief asked for it by name — "${(brief.match(named.match) ?? [""])[0].toLowerCase()}"`,
    };
  }

  const matched = BY_REGISTER.find((entry) => entry.match.test(register));
  if (matched) {
    return { dna: matched.system, reason: `${register} imagery, so ${matched.system.name.toLowerCase()} type and colour` };
  }

  return { dna: BY_KIND[kind], reason: `the default for this kind of project` };
}

/* ── Emitting it ───────────────────────────────────────────────────────────*/

/** The type scale, derived rather than listed: base × ratio at each step. */
export function typeScale(type: Typography): { name: string; px: number }[] {
  const steps = [
    { name: "xs", power: -2 },
    { name: "sm", power: -1 },
    { name: "base", power: 0 },
    { name: "lg", power: 1 },
    { name: "xl", power: 2 },
    { name: "2xl", power: 3 },
    { name: "3xl", power: 4 },
    { name: "4xl", power: 5 },
  ];

  return steps.map((step) => ({
    name: step.name,
    px: Math.round(type.base * Math.pow(type.ratio, step.power) * 100) / 100,
  }));
}

/**
 * The system as CSS custom properties.
 *
 * This is the artefact, not a suggestion. It is written into the project's
 * stylesheet by the scaffold, so the model is not asked to reproduce these
 * numbers — it is asked to use the names. A model that has to retype a palette
 * is a model that will get one of the greys wrong.
 */
export function tokensCss(dna: DesignDNA): string {
  const scale = typeScale(dna.type)
    .map((step) => `  --text-${step.name}: ${step.px}px;`)
    .join("\n");

  const space = dna.space.map((value, index) => `  --space-${index}: ${value}px;`).join("\n");

  return `/* ${dna.name} — this project's design system.
 *
 * ${dna.intent}
 *
 * Every colour, size, radius and duration this project uses is below. Nothing
 * anywhere should introduce a value that is not here: a page with a seventh
 * grey in it is a page that stopped being one design. */
:root {
  /* Type */
  --font-display: ${dna.type.display};
  --font-body: ${dna.type.body};
  --display-weight: ${dna.type.displayWeight};
  --display-leading: ${dna.type.displayLeading};
  --display-tracking: ${dna.type.displayTracking};
  --body-leading: 1.6;
${scale}

  /* Colour */
  --ground: ${dna.color.ground};
  --surface: ${dna.color.surface};
  --ink: ${dna.color.ink};
  --muted: ${dna.color.muted};
  --line: ${dna.color.line};
  --accent: ${dna.color.accent};
  --accent-ink: ${dna.color.accentInk};

  /* Space */
${space}

  /* Shape */
  --radius-sm: ${dna.radius.sm};
  --radius-md: ${dna.radius.md};
  --radius-lg: ${dna.radius.lg};
  --radius-pill: ${dna.radius.pill};
  --shadow-sm: ${dna.shadow.sm};
  --shadow-md: ${dna.shadow.md};
  --container: ${dna.container};

  /* Motion */
  --fast: ${dna.motion.fast};
  --base: ${dna.motion.base};
  --ease: ${dna.motion.ease};
}

html { color-scheme: ${isDark(dna) ? "dark" : "light"}; }

body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: var(--text-base);
  line-height: var(--body-leading);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4 {
  font-family: var(--font-display);
  font-weight: var(--display-weight);
  line-height: var(--display-leading);
  letter-spacing: var(--display-tracking);
  margin: 0;
}
`;
}

/* Whether this system's ground is dark, so `color-scheme` and any form control
   the browser draws for itself match the page rather than fighting it.
   
   Delegated rather than computed here. This used to weight raw bytes, which is
   not the WCAG formula and is not close: sRGB is gamma-encoded, so a channel
   has to be linearised before it is weighted, and skipping that reads mid tones
   as far brighter than they are. It disagreed with the contrast numbers the
   design checker was reporting for the same palette, and there was no way to
   tell which of the two had been consulted. One implementation now — see
   qa/contrast.ts. */
export function isDark(dna: DesignDNA): boolean {
  return isDarkColor(dna.color.ground);
}

/**
 * The system as the model is shown it.
 *
 * Names rather than values wherever a name exists. A model handed "#5C6470" for
 * secondary text will type "#5C6470" in one place and "#5C6472" in another; a
 * model handed `var(--muted)` cannot.
 */
export function designBrief(dna: DesignDNA): string {
  const scale = typeScale(dna.type);

  return `THE DESIGN SYSTEM — ${dna.name}. Decided before you were called, and not a starting point to improve on.

${dna.intent}

The stylesheet already defines every token below. USE THE VARIABLE NAMES, never the literal values, and never introduce a value that is not here — one extra grey or one off-scale radius is what makes a generated page look generated.

COLOUR
  var(--ground)      the page
  var(--surface)     cards and panels
  var(--ink)         headings and body text
  var(--muted)       secondary text, captions, metadata
  var(--line)        hairlines, dividers, borders
  var(--accent)      the one colour that means "press this" — used sparingly
  var(--accent-ink)  text on the accent

TYPE
  Headings: var(--font-display) at weight ${dna.type.displayWeight}, leading ${dna.type.displayLeading}, tracking ${dna.type.displayTracking}.
  Body: var(--font-body) at var(--text-base), leading 1.6.
  Sizes, and there are no others: ${scale.map((step) => `var(--text-${step.name}) ${step.px}px`).join(", ")}.
${
  dna.type.webfont
    ? `  This project loads one webfont and only one: ${dna.type.webfont.family}, already linked. Do not add a second.`
    : `  System fonts only. Do not link a webfont — the page is downloadable and carries everything it fetches.`
}

SPACE
  Only these, as var(--space-0) … var(--space-${dna.space.length - 1}): ${dna.space.join(", ")}px.
  A margin of 37px is the tell that a section was designed on its own.

SHAPE
  Radii: var(--radius-sm) ${dna.radius.sm}, var(--radius-md) ${dna.radius.md}, var(--radius-lg) ${dna.radius.lg}, var(--radius-pill) for anything fully round.
  Shadows: var(--shadow-sm) and var(--shadow-md). There is no third.
  Content is capped at var(--container) ${dna.container}.

MOTION
  var(--fast) ${dna.motion.fast} for hovers and small state changes, var(--base) ${dna.motion.base} for anything that moves or opens, on var(--ease).
  Nothing animates on load except one considered entrance, if any.

RHYTHM — this is what separates a designed page from a stack of sections.
  Vary the sections deliberately: alternate their height, their density, their background (var(--ground) against var(--surface)), whether they are full-bleed or held to the container, and where the emphasis sits. Two adjacent sections with the same padding, the same grid and the same background read as one long section.
  Do not repeat hero → three cards → testimonials → call to action. That shape is the default a generator falls into, and every visitor has seen it.`;
}
