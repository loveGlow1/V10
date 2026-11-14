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
 * Twelve of them, because twelve distinct systems that are all good beats an
 * infinite space that is mostly not — and each now carries an art direction,
 * a motion personality and a hand-written alternate theme, not only values.
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
  /* The two states a form and an async action end in. Text colours, so they
     clear 4.5:1 on the ground and the surface like `muted` does — a success
     message nobody can read is not feedback. Never the only signal: the state
     is said in words beside the colour. */
  success: string;
  danger: string;
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
  webfont: {
    /** The display face — first in the display stack. */
    family: string;
    href: string;
    /** Every family the one request loads: the display face, and a body face when the system pairs one. */
    families?: string[];
  } | null;
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

/* What makes a system an art direction rather than a palette.
 *
 * Colour and type are values and live in the stylesheet. These are decisions
 * about arrangement, and they are what stopped every project landing on the
 * same hero, the same three cards and the same rounded buttons in a different
 * colour: two systems with different tokens and the same composition still
 * read as one template. Each is written for its register, as an instruction a
 * designer would give, and handed to the model verbatim in designBrief. */
export type ArtDirection = {
  /** How pages are laid out: the grid, the rhythm, where the weight sits. */
  composition: string;
  /** The visual language of components: shapes, edges, buttons, labels. */
  components: string;
  /** What the photographs and illustrations are, and what they never are. */
  imagery: string;
  /** What earns belief in this register, and how the page asks for action. */
  trust: string;
};

export type DesignDNA = {
  /** What this system is called, for the step line and for the record. */
  name: string;
  /* Which of the nine design blueprints (A–I) this system is the house
     version of, and for which businesses: the shared vocabulary between the
     design spec, the build log and the model. Several systems may serve one
     blueprint — Warm craft and Modern commercial are both premium commerce,
     for a bakery and for a gadget brand. */
  blueprint: string;
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
  motion: {
    /** Hovers and small state changes. */
    fast: string;
    /** Anything that opens, closes or moves. */
    base: string;
    /** Entrances and scroll reveals — the expensive, deliberate kind. */
    slow: string;
    /** For state changes. */
    ease: string;
    /** For things arriving: fast out of the gate, a long settle. */
    easeOut: string;
    /** The delay between siblings that enter together. */
    stagger: string;
    /** How far a revealed element travels. Short travel reads as expensive. */
    distance: string;
    /** How this register moves, in one line. */
    personality: string;
  };
  art: ArtDirection;
  /* The same system in the other light, for a project that offers a theme
     toggle. Hand-written for the same reason the primary palettes are: an
     inverted palette is muddy greys and a fluorescent accent. Held to the same
     contrast floors, and switched by `data-theme` on <html> — see tokensCss.
     A project shows ONE theme unless the brief asks for a toggle; which one is
     the system's decision, not the visitor's default. */
  inverse: Palette;
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
  blueprint: "A · Luxury editorial — real estate, architecture, interiors, fashion, premium brands",
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
    success: "#2F6B3A",
    danger: "#A3271F",
  },
  space: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160],
  radius: { sm: "0px", md: "0px", lg: "0px", pill: "999px" },
  shadow: { sm: "none", md: "0 1px 2px rgba(20,18,12,.06)" },
  container: "1200px",
  motion: {
    fast: "140ms",
    base: "260ms",
    slow: "900ms",
    ease: "cubic-bezier(.2,.6,.2,1)",
    easeOut: "cubic-bezier(.16,1,.3,1)",
    stagger: "90ms",
    distance: "24px",
    personality:
      "Slow and assured: long fades over short travel, as if a page were being turned. Nothing bounces.",
  },
  art: {
    composition:
      "Asymmetric editorial spreads: a very large headline against a narrow column of text, full-bleed photographs alternating with wide empty margins, numbered sections and small captions. Weight sits off-centre.",
    components:
      "Square corners, hairline rules instead of boxes, text links whose underline draws in on hover, primary buttons as solid ink rectangles with generous letter-spacing. No cards, no pills, no icons in circles.",
    imagery:
      "Few photographs, used large, with real negative space: one subject per frame, one light and one grade across the project. Never a collage, never a lifestyle cliché.",
    trust:
      "Belief through restraint and provenance: the material, the maker, the place, press the brief supplies. One call to act per screen, stated quietly — never a wall of badges or urgency.",
  },
  inverse: {
    ground: "#12110D",
    surface: "#1B1A15",
    ink: "#F3F0E8",
    muted: "#A8A293",
    line: "#2E2C25",
    accent: "#F3F0E8",
    accentInk: "#12110D",
    success: "#8CC79A",
    danger: "#F0938A",
  },
};

const CRAFT: DesignDNA = {
  name: "Warm craft",
  blueprint: "D · Premium commerce — food, craft, makers and local business",
  register: "warm documentary",
  intent:
    "Made by somebody. Warm paper ground, a clay accent, softly rounded corners and generous line height. Reads as a person's workshop rather than a brand system.",
  type: {
    display:
      '"Young Serif", "Iowan Old Style", Charter, Georgia, "Times New Roman", serif',
    body: '"Figtree", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    /* A warm, slightly soft serif and a friendly sans: the same on every
       visitor's machine, rather than whichever serif it happens to ship. */
    webfont: {
      family: "Young Serif",
      families: ["Young Serif", "Figtree"],
      href: "https://fonts.googleapis.com/css2?family=Young+Serif&family=Figtree:wght@400;500;600;700&display=swap",
    },
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
    success: "#3D6B35",
    danger: "#A6321F",
  },
  space: [4, 8, 12, 16, 24, 32, 48, 64, 88, 120, 160],
  radius: { sm: "6px", md: "12px", lg: "20px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(58,42,26,.07)", md: "0 8px 28px rgba(58,42,26,.10)" },
  container: "1140px",
  motion: {
    fast: "150ms",
    base: "280ms",
    slow: "700ms",
    ease: "cubic-bezier(.22,.7,.25,1)",
    easeOut: "cubic-bezier(.22,1,.36,1)",
    stagger: "80ms",
    distance: "16px",
    personality:
      "Gentle and unhurried: soft fades with a little lift, nothing sharp or mechanical.",
  },
  art: {
    composition:
      "Human and slightly irregular: photographs at different sizes, text beside images rather than over them, a large pull quote, sections that read like pages of a workshop notebook.",
    components:
      "Softly rounded corners, warm paper surfaces, thin warm rules, buttons with generous padding and a clay fill, small labels in small caps.",
    imagery:
      "Process and people: hands at work, raw materials, the room in use, natural window light and honest shadow.",
    trust:
      "Belief through the maker: who makes it, how, where and how long it takes, with real delivery, care and returns policies. The call to act is an invitation, not a countdown.",
  },
  inverse: {
    ground: "#1A1511",
    surface: "#231D18",
    ink: "#F5EDE2",
    muted: "#B3A595",
    line: "#3A3029",
    accent: "#E08A5C",
    accentInk: "#1A1511",
    success: "#9CC98A",
    danger: "#F2937E",
  },
};

const CLINICAL: DesignDNA = {
  name: "Clinical precision",
  blueprint: "C · Modern minimal — professional services, health, consultants",
  register: "clean clinical",
  intent:
    "Calm and exact. Cool neutrals, one trustworthy blue, hairline rules and small radii. Nothing decorative — every element is legible before it is anything else.",
  type: {
    display: '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    /* Inter, and it is the reason this register is not the two below.
       Clinical precision, Technical and Modern commercial all had
       `ui-sans-serif` for BOTH display and body, so all three rendered in
       whatever sans the visitor's operating system happens to use — the same
       one. They differed by heading weight alone, 650 against 600 against
       700, which a system stack usually snaps to the same rendered weight
       anyway. Three of the six design systems were one design system.

       Inter is the interface typeface this register is describing: even,
       unshowy, legible at small sizes before it is anything else. */
    webfont: {
      family: "Inter",
      href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap",
    },
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
    success: "#1E6B45",
    danger: "#B42318",
  },
  space: [4, 8, 12, 16, 20, 24, 32, 48, 64, 88, 120],
  radius: { sm: "4px", md: "8px", lg: "12px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(16,23,32,.06)", md: "0 6px 20px rgba(16,23,32,.09)" },
  container: "1120px",
  motion: {
    fast: "120ms",
    base: "220ms",
    slow: "600ms",
    ease: "cubic-bezier(.3,.6,.2,1)",
    easeOut: "cubic-bezier(.2,.9,.3,1)",
    stagger: "60ms",
    distance: "12px",
    personality:
      "Quiet and exact: short, near-invisible transitions that confirm an action rather than perform one.",
  },
  art: {
    composition:
      "Structured and calm: a clear twelve-column grid, information grouped into quiet panels, an obvious reading order, and the next step — book, call, ask — always in reach.",
    components:
      "Small radii, hairline borders, large comfortable form controls, small line icons only where they help scanning, status said in words and colour together.",
    imagery:
      "Real rooms, real equipment and real practitioners in even daylight. Never models posing in lab coats, never stethoscope stock.",
    trust:
      "Belief through clarity: credentials, how an appointment works, what it costs or how cost is decided, hours, accessibility and how personal data is handled — stated plainly.",
  },
  inverse: {
    ground: "#0D1117",
    surface: "#151B23",
    ink: "#E8EDF3",
    muted: "#9AA6B5",
    line: "#26303C",
    accent: "#6CA6F0",
    accentInk: "#0B1320",
    success: "#6FD19E",
    danger: "#F59A92",
  },
};

const TECHNICAL: DesignDNA = {
  name: "Technical",
  blueprint: "B · Cinematic dark (technical) — developer tools and technical SaaS",
  register: "technical documentary",
  intent:
    "Built, not styled. Near-neutral surfaces, a monospace accent for data and labels, sharp corners and dense information. Confidence comes from precision rather than from colour.",
  type: {
    display: '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    /* Geist. Drawn for developer tooling, which is exactly what this
       register is for — slightly narrow, mechanical, and unmistakably not
       the system sans it used to fall back to. */
    webfont: {
      family: "Geist",
      href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700&display=swap",
    },
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
    success: "#5ED69A",
    danger: "#FF7B72",
  },
  space: [4, 8, 12, 16, 20, 24, 32, 40, 56, 80, 112],
  radius: { sm: "3px", md: "6px", lg: "10px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(0,0,0,.4)", md: "0 10px 30px rgba(0,0,0,.5)" },
  container: "1180px",
  motion: {
    fast: "110ms",
    base: "200ms",
    slow: "500ms",
    ease: "cubic-bezier(.3,.7,.2,1)",
    easeOut: "cubic-bezier(.2,.9,.25,1)",
    stagger: "40ms",
    distance: "8px",
    personality:
      "Snappy and mechanical: fast, short and precise, things snapping into place the way a terminal prints.",
  },
  art: {
    composition:
      "Dense and precise: a strict grid, the real product interface or a code sample as the opening visual, specifications in tables, and documentation-like sections that reward scanning.",
    components:
      "Sharp small radii, low-contrast 1px lines, monospace for labels, keys and values, compact buttons, keyboard shortcuts shown where they exist.",
    imagery:
      "Mostly none. Interfaces, diagrams and code drawn in HTML and SVG; photographs only of real hardware or a real team.",
    trust:
      "Belief through specifics: docs, changelog, status, API examples, limits and security facts the brief supplies. The call to act is something to do now — a copyable command, a key, a sandbox.",
  },
  inverse: {
    ground: "#FAFAF9",
    surface: "#FFFFFF",
    ink: "#0E1013",
    muted: "#5B626C",
    line: "#E4E6E9",
    accent: "#0B7A4B",
    accentInk: "#FFFFFF",
    success: "#0B7A4B",
    danger: "#B42318",
  },
};

const COMMERCIAL: DesignDNA = {
  name: "Modern commercial",
  blueprint: "D · Premium commerce — products, services and online stores",
  register: "clear commercial",
  intent:
    "Contemporary and direct. A crisp neutral ground, one confident accent used sparingly, medium radii and soft shadows. The default when nothing in the brief asks for a stronger point of view.",
  type: {
    display: '"Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    /* Manrope. The semi-rounded terminals are what make this read as a
       product being sold rather than a document being filed, and they are
       the whole distance between this register and Clinical precision — a
       distance that did not exist while both were the system sans. */
    webfont: {
      family: "Manrope",
      href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&display=swap",
    },
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
    success: "#18794E",
    danger: "#C0262D",
  },
  space: [4, 8, 12, 16, 24, 32, 40, 56, 80, 112, 144],
  radius: { sm: "6px", md: "10px", lg: "16px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(15,18,24,.06)", md: "0 10px 32px rgba(15,18,24,.10)" },
  container: "1160px",
  motion: {
    fast: "130ms",
    base: "240ms",
    slow: "650ms",
    ease: "cubic-bezier(.25,.7,.25,1)",
    easeOut: "cubic-bezier(.16,1,.3,1)",
    stagger: "70ms",
    distance: "20px",
    personality:
      "Lively but controlled: crisp eased reveals, responsive hovers and a confident press.",
  },
  art: {
    composition:
      "Confident product storytelling: a direct headline with the product or service shown working, then alternating text-and-visual rows of different weights, and one strong closing call. In a store the product leads: large imagery, a clear grid of products, then the detail that sells one — price, options, delivery — with the path to checkout never more than a tap away.",
    components:
      "Medium radii, soft layered surfaces separated by tone rather than borders, the accent reserved for the primary action, secondary actions as quiet text buttons. Product cards are refined and consistent — one image ratio, name, price, at most one badge — and prices are always visible, never behind a click.",
    imagery:
      "The product or service in real use by the people it is for, in bright natural light.",
    trust:
      "Belief through proof the brief supplies — clients, guarantees, prices shown upfront, a clear cancellation or refund policy — and the primary action repeated at natural decision points.",
  },
  inverse: {
    ground: "#0D0F14",
    surface: "#161922",
    ink: "#F1F3F7",
    muted: "#9CA3B0",
    line: "#272B35",
    accent: "#8E8CFF",
    accentInk: "#0D0F14",
    success: "#5FD3A0",
    danger: "#FF8A8A",
  },
};

const PRESS: DesignDNA = {
  name: "Press",
  blueprint: "E · Editorial magazine — blogs, news, publications, media",
  register: "editorial reportage",
  intent:
    "A publication. Serif headlines set tight, a paper-white ground, rules instead of boxes, and one red reserved for what is breaking. Ranked rather than gridded — the lead story is unmistakably the lead.",
  type: {
    display: '"Source Serif 4", Charter, "Iowan Old Style", Georgia, "Times New Roman", serif',
    body: '"Public Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    /* A newspaper serif built for headlines and long reading, and a plain
       public-service sans for the furniture around it. */
    webfont: {
      family: "Source Serif 4",
      families: ["Source Serif 4", "Public Sans"],
      href: "https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,700&family=Public+Sans:wght@400;500;600&display=swap",
    },
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
    success: "#1F6B3A",
    danger: "#B01A16",
  },
  space: [4, 8, 12, 16, 20, 28, 40, 56, 76, 104, 140],
  radius: { sm: "0px", md: "0px", lg: "2px", pill: "999px" },
  shadow: { sm: "none", md: "0 2px 8px rgba(0,0,0,.06)" },
  container: "1240px",
  motion: {
    fast: "120ms",
    base: "200ms",
    slow: "450ms",
    ease: "cubic-bezier(.2,.6,.2,1)",
    easeOut: "cubic-bezier(.2,.8,.2,1)",
    stagger: "40ms",
    distance: "8px",
    personality:
      "Almost none: the news is the motion. Brief fades on secondary items, never on a headline.",
  },
  art: {
    composition:
      "Ranked, not gridded: a dominant lead story, then columns of decreasing weight, rules between items, dense datelines and bylines. Featured articles lead, categories are always one click away, and an article page is built for reading: a measure of 60–72 characters, a clear heading hierarchy, and the image that tells the story at the top.",
    components:
      "No radii, column rules, kickers in small caps, headlines as the links, buttons rare and plain. Article cards share one image ratio and show the category, headline, standfirst, byline and date in that order.",
    imagery:
      "Press photography as it happened, every frame captioned and credited, and image-led storytelling on features — one strong photograph per story, never repeated across stories.",
    trust:
      "Belief through attribution: bylines, dates, corrections, sources and a clear section structure.",
  },
  inverse: {
    ground: "#121212",
    surface: "#1A1A1A",
    ink: "#F2F2EE",
    muted: "#A3A39C",
    line: "#2E2E2B",
    accent: "#FF5A4F",
    accentInk: "#121212",
    success: "#7CC48F",
    danger: "#FF6F65",
  },
};

/* ── Three registers the six above could not hold ─────────────────────────
 *
 * A futuristic AI product, a spa and a private bank were all landing on
 * Modern commercial or Clinical precision: a bright neutral ground and a blue
 * button, the same page as a plumber's. Each of these is a direction an agency
 * would recognise on sight, and each is reached by naming the industry — see
 * BY_INDUSTRY — not by asking for a colour. */

const LUMINOUS: DesignDNA = {
  name: "Luminous dark",
  blueprint: "B · Cinematic dark — AI, technology, premium SaaS, digital products",
  register: "luminous technology",
  intent:
    "Deep and luminous. Near-black layered surfaces with light falling across them, one pale violet accent, large precise geometric headings. A flagship product launch, never a crypto template.",
  type: {
    display: '"Sora", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    /* Sora: wide, geometric and calm at display sizes — the shape of a
       product that wants to look like the future without a single glow. */
    webfont: {
      family: "Sora",
      href: "https://fonts.googleapis.com/css2?family=Sora:wght@400;600&display=swap",
    },
    ratio: 1.333,
    base: 16,
    displayLeading: 1.05,
    displayTracking: "-0.035em",
    displayWeight: 600,
  },
  color: {
    ground: "#07080B",
    surface: "#0F1116",
    ink: "#F2F3F7",
    muted: "#979CAB",
    line: "#1E2129",
    accent: "#C9B8FF",
    accentInk: "#120C24",
    success: "#7EE2B8",
    danger: "#FF8F8F",
  },
  space: [4, 8, 12, 16, 24, 32, 48, 72, 104, 144, 192],
  radius: { sm: "8px", md: "14px", lg: "24px", pill: "999px" },
  shadow: {
    sm: "inset 0 1px 0 rgba(255,255,255,.06)",
    md: "0 24px 64px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.08)",
  },
  container: "1200px",
  motion: {
    fast: "140ms",
    base: "280ms",
    slow: "1000ms",
    ease: "cubic-bezier(.3,.7,.2,1)",
    easeOut: "cubic-bezier(.16,1,.3,1)",
    stagger: "100ms",
    distance: "32px",
    personality:
      "Cinematic: long eased reveals, a gentle parallax on the main visual, light that seems to settle as you scroll.",
  },
  art: {
    composition:
      "Cinematic chapters: a full-height opening statement, the product revealed in one large framed visual, then sections that each make one claim and show one piece of evidence for it.",
    components:
      "Surfaces separated by light rather than borders — a 1px top highlight, a slightly lifted surface — glass only where text sits over imagery, primary buttons in the pale accent, secondary as ghost text. One controlled gradient and a subtle glow may sit behind the main visual; never neon, never on text, never more than one per screen.",
    imagery:
      "The real product interface, abstract light and geometry drawn in CSS or SVG, real hardware or people in low-key light. Never robots, glowing brains or circuit-board stock.",
    trust:
      "Belief through demonstration and candour: the product shown working, its limits stated, how data is handled and secured, pricing clear. The call to act is to try it.",
  },
  inverse: {
    ground: "#F7F7FA",
    surface: "#FFFFFF",
    ink: "#0B0C12",
    muted: "#5A5E6E",
    line: "#E3E4EB",
    accent: "#4B32C3",
    accentInk: "#FFFFFF",
    success: "#127A50",
    danger: "#B42318",
  },
};

const SANCTUARY: DesignDNA = {
  name: "Calm sanctuary",
  blueprint: "A · Luxury editorial (hospitality) — hotels, spas, wellness, retreats",
  register: "restorative calm",
  intent:
    "Calm and restorative. Stone and linen grounds, a deep sage accent, light elegant serif headings and long, slow pacing. The page breathes the way the place should.",
  type: {
    display: '"Cormorant Garamond", "Iowan Old Style", Georgia, "Times New Roman", serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    /* Cormorant is the register: a light, high-contrast serif that reads as
       linen and quiet rooms, where a system serif reads as a form. */
    webfont: {
      family: "Cormorant Garamond",
      href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&display=swap",
    },
    ratio: 1.333,
    base: 17,
    displayLeading: 1.08,
    displayTracking: "-0.01em",
    displayWeight: 500,
  },
  color: {
    ground: "#F5F2EC",
    surface: "#FBF9F5",
    ink: "#1F2420",
    muted: "#5C655E",
    line: "#E2DDD3",
    accent: "#3E5C4C",
    accentInk: "#FFFFFF",
    success: "#2F6B45",
    danger: "#A63A2B",
  },
  space: [4, 8, 12, 16, 24, 32, 48, 72, 104, 144, 184],
  radius: { sm: "10px", md: "18px", lg: "28px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(31,36,32,.05)", md: "0 18px 48px rgba(31,36,32,.08)" },
  container: "1180px",
  motion: {
    fast: "160ms",
    base: "320ms",
    slow: "1100ms",
    ease: "cubic-bezier(.25,.6,.3,1)",
    easeOut: "cubic-bezier(.22,1,.36,1)",
    stagger: "110ms",
    distance: "20px",
    personality: "Breathing: slow fades, minimal travel, a gentle parallax on landscape photographs.",
  },
  art: {
    composition:
      "Slow and spacious: one idea per screen, wide photographs with text set in their calm area, long vertical rhythm, and booking or enquiry always one step away.",
    components:
      "Soft generous radii, pill buttons, tonal surfaces with no borders, generous line height, small uppercase labels with open tracking.",
    imagery:
      "The place and the experience in soft morning or evening light: rooms, textures, water, hands, landscape. Never a stock model with cucumber eyes.",
    trust:
      "Belief through reassurance: what a visit is like step by step, who the practitioners are and their qualifications, location, prices and policies, and an easy booking or enquiry.",
  },
  inverse: {
    ground: "#141714",
    surface: "#1C201C",
    ink: "#EFEDE6",
    muted: "#A9AEA6",
    line: "#2D322D",
    accent: "#A9C7B4",
    accentInk: "#141714",
    success: "#9ACFAB",
    danger: "#EE9A8C",
  },
};

const CAPITAL: DesignDNA = {
  name: "Private capital",
  blueprint: "G · Fintech precision — banking, investments, payments, wealth, property",
  register: "established authority",
  intent:
    "Established and assured. Ivory ground, deep navy ink and accent, a refined serif for headings and exact tabular figures. A private bank or a landmark property, never a template for one.",
  type: {
    display: '"Newsreader", Charter, Georgia, "Times New Roman", serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    /* Newsreader: a serif with authority and modern proportions, so the page
       reads as an institution rather than as a newspaper or a fashion house. */
    webfont: {
      family: "Newsreader",
      href: "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap",
    },
    ratio: 1.25,
    base: 17,
    displayLeading: 1.1,
    displayTracking: "-0.015em",
    displayWeight: 500,
  },
  color: {
    ground: "#F7F6F2",
    surface: "#FFFFFF",
    ink: "#0F1A2A",
    muted: "#556172",
    line: "#DEDCD4",
    accent: "#0F2E4D",
    accentInk: "#F7F6F2",
    success: "#1D6B48",
    danger: "#A8291F",
  },
  space: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 168],
  radius: { sm: "2px", md: "4px", lg: "6px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(15,26,42,.06)", md: "0 12px 36px rgba(15,26,42,.10)" },
  container: "1200px",
  motion: {
    fast: "140ms",
    base: "240ms",
    slow: "800ms",
    ease: "cubic-bezier(.25,.6,.25,1)",
    easeOut: "cubic-bezier(.2,1,.3,1)",
    stagger: "70ms",
    distance: "16px",
    personality: "Composed: precise eased reveals and a steady parallax on architecture. Nothing playful.",
  },
  art: {
    composition:
      "Measured and architectural: a wide opening statement, then content on a strict grid — large property or portfolio photographs alternating with dense, tabular facts.",
    components:
      "Small radii, fine rules, tabular numerals for every figure, understated buttons in a navy fill or a precise underline, labels in small caps. Where there are accounts: account cards with the balance as the largest figure, transaction tables with consistent signs, currency and dates, and charts with labelled axes. A simulated or demonstration transaction is always labelled as one — never presented as money that really moved.",
    imagery:
      "Architecture and interiors in clean daylight with straight verticals; advisors as real people at work. Never handshakes, skylines at dusk or piles of coins.",
    trust:
      "Belief through specifics and regulation: registration and licence numbers, fees, team credentials and a track record only as the brief supplies it, clear disclaimers, and a private consultation as the call to act.",
  },
  inverse: {
    ground: "#0A111B",
    surface: "#111A26",
    ink: "#EEF1F5",
    muted: "#9DA8B7",
    line: "#222D3B",
    accent: "#D9C08A",
    accentInk: "#0A111B",
    success: "#7CCBA0",
    danger: "#F09A8F",
  },
};

/* ── Three more directions the nine above could not hold ──────────────────
 *
 * A freight company, a construction firm and an industrial supplier were
 * landing on Technical — a developer tool's grey hairlines — when what they
 * need is a business that looks established and easy to deal with. Working
 * software was landing on Clinical precision, a marketing page's system,
 * when it needs one built for sidebars, tables and states. And a designer,
 * an illustrator or a creative agency was landing on Editorial serif, which
 * is quiet by design, when their site IS the portfolio and has to be loud.
 * Each is reached the same way as the others: by the industry the brief
 * names (BY_INDUSTRY), a look it names (NAMED), or the kind (BY_KIND). */

const CORPORATE: DesignDNA = {
  name: "Corporate professional",
  blueprint: "F · Corporate professional — logistics, construction, consulting, industry",
  register: "established industry",
  intent:
    "Solid and capable. A cool light ground, deep navy ink, one burnt-orange accent that means action, and a structured sans with industrial roots. A firm that moves freight or builds things, never a startup template.",
  type: {
    display: '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    /* IBM Plex Sans: engineered, slightly mechanical, legible at every size —
       the voice of an operation that runs on schedules and specifications. */
    webfont: {
      family: "IBM Plex Sans",
      href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&display=swap",
    },
    ratio: 1.25,
    base: 16,
    displayLeading: 1.1,
    displayTracking: "-0.015em",
    displayWeight: 700,
  },
  color: {
    ground: "#F5F7FA",
    surface: "#FFFFFF",
    ink: "#0B1B2E",
    muted: "#4A5A6E",
    line: "#D9DFE7",
    accent: "#C2410C",
    accentInk: "#FFFFFF",
    success: "#166534",
    danger: "#B91C1C",
  },
  space: [4, 8, 12, 16, 24, 32, 48, 64, 88, 120, 152],
  radius: { sm: "4px", md: "6px", lg: "10px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(11,27,46,.08)", md: "0 10px 30px rgba(11,27,46,.10)" },
  container: "1240px",
  motion: {
    fast: "130ms",
    base: "220ms",
    slow: "700ms",
    ease: "cubic-bezier(.3,.6,.3,1)",
    easeOut: "cubic-bezier(.2,1,.3,1)",
    stagger: "60ms",
    distance: "16px",
    personality: "Efficient: short, firm reveals and crisp state changes. Motion that confirms rather than performs.",
  },
  art: {
    composition:
      "Structured and information-led: a strong opening with the core service and its proof, then services on a clear grid, a band of operational facts (coverage, fleet, years, response times as the brief supplies them), process steps and a prominent working tool such as tracking or a quote form.",
    components:
      "Modest radii, solid navy headers and footers, service cards with a short spec list, numbered process steps, form fields with visible labels, primary buttons in the orange accent and secondary in navy outline. Icons are line icons in a square, never cartoons.",
    imagery:
      "Real operations: warehouses, fleets, containers, sites, crews at work in daylight, shot straight and sharp. Never handshakes over a desk, globes made of light or generic skyline stock.",
    trust:
      "Belief through capability and specifics: certifications, coverage, safety record, named sectors served and response commitments, only as the brief supplies them. The call to act is concrete — request a quote, track a shipment, speak to the team.",
  },
  inverse: {
    ground: "#0B1220",
    surface: "#121B2B",
    ink: "#EEF2F7",
    muted: "#9AA8BA",
    line: "#22304A",
    accent: "#FB923C",
    accentInk: "#1A0E05",
    success: "#86EFAC",
    danger: "#FCA5A5",
  },
};

const DASHBOARD: DesignDNA = {
  name: "Modern dashboard",
  blueprint: "H · Modern dashboard — SaaS apps, CRMs, portals, management systems",
  register: "working software",
  intent:
    "Calm, dense and exact. A soft grey ground, white working surfaces, one indigo accent for the primary action, and a friendly geometric sans. Software people use all day, built around its sidebar, its tables and its states.",
  type: {
    display: '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    /* Plus Jakarta Sans: open, even and quietly friendly — readable in a
       table at 13px and confident as a page title, which is the whole job. */
    webfont: {
      family: "Plus Jakarta Sans",
      href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap",
    },
    ratio: 1.2,
    base: 15,
    displayLeading: 1.15,
    displayTracking: "-0.02em",
    displayWeight: 700,
  },
  color: {
    ground: "#F6F7F9",
    surface: "#FFFFFF",
    ink: "#111827",
    muted: "#4B5563",
    line: "#E5E7EB",
    accent: "#4F46E5",
    accentInk: "#FFFFFF",
    success: "#15803D",
    danger: "#B91C1C",
  },
  space: [4, 8, 12, 16, 20, 24, 32, 40, 56, 72, 96],
  radius: { sm: "6px", md: "10px", lg: "14px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(17,24,39,.06)", md: "0 8px 24px rgba(17,24,39,.08)" },
  container: "1440px",
  motion: {
    fast: "120ms",
    base: "200ms",
    slow: "500ms",
    ease: "cubic-bezier(.4,0,.2,1)",
    easeOut: "cubic-bezier(.16,1,.3,1)",
    stagger: "40ms",
    distance: "8px",
    personality: "Instant and quiet: panels slide, rows highlight, toasts arrive and leave. Nothing decorative moves.",
  },
  art: {
    composition:
      "An application, not a page: a fixed sidebar naming this product's real sections, a slim top bar with search and the account, and a content area that opens on the overview — a row of stat cards read from the data, then the main table or board, then detail in a side panel or dialog.",
    components:
      "White cards on the grey ground with hairline borders, compact tables with sticky headers, sortable columns and status pills, segmented filters, inline-SVG charts with real axes, dialogs and drawers for create and edit, toasts for results. Every list has a designed empty state, a skeleton while loading and a stated error.",
    imagery:
      "Almost none. Avatars as monograms, icons in one consistent line style, charts and the interface itself drawn in code. A photograph inside working software is decoration.",
    trust:
      "Belief through the product behaving well: real-looking data in the domain's own words, responsive controls, clear confirmation of every change and an honest 'not connected yet' where a back end is missing. Never invented live figures.",
  },
  inverse: {
    ground: "#0B0F17",
    surface: "#121826",
    ink: "#F3F4F6",
    muted: "#9CA3AF",
    line: "#1F2937",
    accent: "#A5B4FC",
    accentInk: "#111827",
    success: "#86EFAC",
    danger: "#FCA5A5",
  },
};

const CREATIVE: DesignDNA = {
  name: "Creative expressive",
  blueprint: "I · Creative expressive — designers, agencies, studios, artists",
  register: "expressive studio",
  intent:
    "Confident and distinctive. Warm paper ground, near-black ink, an electric blue accent, oversized expressive headings and layouts that break the grid on purpose. A studio whose website is part of the work.",
  type: {
    display: '"Syne", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    /* Syne: wide, idiosyncratic and unmistakable at display sizes — the
       typeface does the introducing before a word is read. */
    webfont: {
      family: "Syne",
      href: "https://fonts.googleapis.com/css2?family=Syne:wght@500;700;800&display=swap",
    },
    ratio: 1.414,
    base: 17,
    displayLeading: 0.98,
    displayTracking: "-0.03em",
    displayWeight: 800,
  },
  color: {
    ground: "#F3EFE6",
    surface: "#FFFFFF",
    ink: "#111111",
    muted: "#57534E",
    line: "#D6CFC2",
    accent: "#2B2BD9",
    accentInk: "#FFFFFF",
    success: "#2F6B3A",
    danger: "#B42318",
  },
  space: [4, 8, 12, 16, 24, 32, 48, 80, 120, 168, 224],
  radius: { sm: "0px", md: "0px", lg: "28px", pill: "999px" },
  shadow: { sm: "none", md: "8px 8px 0 #111111" },
  container: "1320px",
  motion: {
    fast: "150ms",
    base: "300ms",
    slow: "1000ms",
    ease: "cubic-bezier(.65,0,.35,1)",
    easeOut: "cubic-bezier(.16,1,.3,1)",
    stagger: "110ms",
    distance: "40px",
    personality: "Expressive but controlled: big confident entrances, image reveals as the work scrolls in, a magnetic hover on the primary action. Never a gimmick that slows reading.",
  },
  art: {
    composition:
      "Asymmetric and image-led: an oversized name or statement that fills the first screen, then the work in a varied grid — a full-width piece, two side by side, one offset — each with a short line of context, then process, services and a direct way to get in touch.",
    components:
      "Oversized type, square cards with one bold hard shadow, project tiles that reveal their title on hover, a large outlined or solid accent button, a marquee of client names only when the brief supplies them. Labels in small uppercase with wide tracking.",
    imagery:
      "The work itself, large: project images, process shots and the person behind it, each with its own aspect ratio rather than forced into one. Never mock-up stock or a laptop on a desk.",
    trust:
      "Belief through the work: real projects with the problem, the approach and the result, clients and collaborators as the brief names them, and a voice with personality. The call to act is a direct conversation — an email, a booking, a brief.",
  },
  inverse: {
    ground: "#0E0E0E",
    surface: "#171717",
    ink: "#F5F2EA",
    muted: "#A8A29E",
    line: "#2A2A2A",
    accent: "#D4FF3A",
    accentInk: "#0E0E0E",
    success: "#86EFAC",
    danger: "#FCA5A5",
  },
};

/* ── The second shelf ─────────────────────────────────────────────────────
 *
 * Kinds of site the first twelve did not serve: a children's party business
 * came out Modern commercial, a restaurant Warm craft, a gym and a nightclub
 * both Technical, a wedding planner Editorial. Each is its own look, with a
 * PAIR of webfonts — a display face and a body face, in one request — because
 * these registers are carried as much by the reading text as by the headings.
 * Contrast floors as for every other system (tools/check-design.mjs). */

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

const PLAYFUL: DesignDNA = {
  name: "Playful bright",
  blueprint: "J · Playful — kids, education, toys, parties, family events, pets",
  register: "bright and friendly",
  intent:
    "Cheerful and warm without being childish: a cream ground, rounded friendly type, one confident violet, sunny yellow and soft shapes. Everything feels safe to touch.",
  type: {
    display: `"Fredoka", ${SANS}`,
    body: `"Nunito", ${SANS}`,
    webfont: {
      family: "Fredoka",
      families: ["Fredoka", "Nunito"],
      href: "https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@400;600;700&display=swap",
    },
    ratio: 1.25,
    base: 17,
    displayLeading: 1.1,
    displayTracking: "-0.01em",
    displayWeight: 600,
  },
  color: { ground: "#FFF8EC", surface: "#FFFFFF", ink: "#1D1A33", muted: "#5B5670", line: "#F0E2C8", accent: "#5B3DF5", accentInk: "#FFFFFF", success: "#1F7A3A", danger: "#B42318" },
  space: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160],
  radius: { sm: "12px", md: "20px", lg: "32px", pill: "999px" },
  shadow: { sm: "0 2px 0 rgba(29,26,51,.08)", md: "0 10px 30px rgba(91,61,245,.14)" },
  container: "1180px",
  motion: { fast: "150ms", base: "280ms", slow: "700ms", ease: "cubic-bezier(.34,1.56,.64,1)", easeOut: "cubic-bezier(.22,1.2,.36,1)", stagger: "80ms", distance: "20px", personality: "Bouncy but brief: a little overshoot on entrances and a playful lift on hover. Never so much that reading waits for it." },
  art: {
    composition: "Generous, centred and rhythmic: a big friendly headline with a soft blob or sticker shape behind the picture, then alternating rows of picture and text, each in a rounded card, and a bright band that asks for the booking.",
    components: "Fully rounded buttons and cards, chunky pill tags, icons in soft coloured circles, wavy or curved section dividers, little star or squiggle accents used sparingly.",
    imagery: "Real children, families, pets or the event itself, bright and natural, smiling but not posed. Illustrations only in a single friendly flat style. Never clip-art, never stock-smile overload.",
    trust: "Belief through warmth and safety: real reviews from parents, clear prices and what is included, safety and qualifications the brief states, one big friendly call to book.",
  },
  inverse: { ground: "#17142A", surface: "#211D3A", ink: "#FBF7FF", muted: "#B9B2D6", line: "#332E55", accent: "#FFC94D", accentInk: "#17142A", success: "#86EFAC", danger: "#FCA5A5" },
};

const DINING: DesignDNA = {
  name: "Fine dining",
  blueprint: "K · Hospitality — restaurants, bars, cafés, bakeries with a dining room, caterers, chefs",
  register: "candlelit appetite",
  intent:
    "Appetite and occasion: a warm linen ground, a high-contrast serif for dish names and headings, a deep wine accent and food photographs shot like a menu cover.",
  type: {
    display: `"Playfair Display", Georgia, "Times New Roman", serif`,
    body: `"Karla", ${SANS}`,
    webfont: {
      family: "Playfair Display",
      families: ["Playfair Display", "Karla"],
      href: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;1,500&family=Karla:wght@400;500;700&display=swap",
    },
    ratio: 1.333,
    base: 17,
    displayLeading: 1.08,
    displayTracking: "-0.01em",
    displayWeight: 500,
  },
  color: { ground: "#F7F1E8", surface: "#FFFDF8", ink: "#1E1712", muted: "#6B5D50", line: "#E4D7C3", accent: "#7A1F1F", accentInk: "#FFF8EE", success: "#2F6B3A", danger: "#A3271F" },
  space: [4, 8, 12, 16, 24, 32, 48, 64, 96, 136, 176],
  radius: { sm: "2px", md: "4px", lg: "8px", pill: "999px" },
  shadow: { sm: "none", md: "0 12px 40px rgba(30,23,18,.12)" },
  container: "1200px",
  motion: { fast: "150ms", base: "300ms", slow: "1000ms", ease: "cubic-bezier(.2,.6,.2,1)", easeOut: "cubic-bezier(.16,1,.3,1)", stagger: "100ms", distance: "20px", personality: "Unhurried, like good service: slow fades, photographs that settle into place, nothing that jumps." },
  art: {
    composition: "A full-bleed signature dish or the room at night behind the name, then the menu as a real typeset menu — dish, short description, price aligned — the story of the kitchen, the room, opening hours and a reservation band.",
    components: "Thin rules and centred small-caps section labels, dish lists with dotted leaders to the price, a solid wine-coloured Reserve button, an elegant opening-hours table, a map card. No cards with shadows around dishes.",
    imagery: "The food close and lit like candlelight, the room, the chef's hands, the drinks. One warm grade across all of it. Never stock buffet photos or bright flat delivery shots.",
    trust: "Belief through appetite and detail: the real menu with prices, the chef and the sourcing, reviews or press the brief supplies, address and hours always visible, one clear way to book a table.",
  },
  inverse: { ground: "#140F0C", surface: "#1E1814", ink: "#F6EEE3", muted: "#B8A994", line: "#33291F", accent: "#E3B26B", accentInk: "#140F0C", success: "#8CC79A", danger: "#F0938A" },
};

const ATHLETIC: DesignDNA = {
  name: "Athletic energy",
  blueprint: "L · Performance — gyms, fitness, coaches, sports clubs, martial arts, sports gear",
  register: "high-energy performance",
  intent:
    "Loud, fast and disciplined: a near-black ground, condensed all-caps headlines that hit like a scoreboard, one acid-lime accent and action photographs with sweat in them.",
  type: {
    display: `"Anton", "Arial Narrow", ${SANS}`,
    body: `"Barlow", ${SANS}`,
    webfont: {
      family: "Anton",
      families: ["Anton", "Barlow"],
      href: "https://fonts.googleapis.com/css2?family=Anton&family=Barlow:wght@400;500;600;700&display=swap",
    },
    ratio: 1.5,
    base: 17,
    displayLeading: 0.95,
    displayTracking: "0.01em",
    displayWeight: 400,
  },
  color: { ground: "#0B0B0C", surface: "#151517", ink: "#F7F7F5", muted: "#A6A6A2", line: "#2A2A2D", accent: "#D7FF3A", accentInk: "#0B0B0C", success: "#86EFAC", danger: "#FCA5A5" },
  space: [4, 8, 12, 16, 24, 32, 48, 72, 104, 144, 192],
  radius: { sm: "0px", md: "2px", lg: "4px", pill: "999px" },
  shadow: { sm: "none", md: "0 0 0 1px #2A2A2D" },
  container: "1280px",
  motion: { fast: "100ms", base: "200ms", slow: "600ms", ease: "cubic-bezier(.4,0,.2,1)", easeOut: "cubic-bezier(.12,.9,.2,1)", stagger: "60ms", distance: "32px", personality: "Explosive and short: hard, fast entrances, a skewed hover on the main button, numbers that count up once. Never floaty." },
  art: {
    composition: "A full-screen action photograph with a huge uppercase headline on top, then stats in big numerals, programmes or classes as bold tiles, the schedule as a timetable, coaches with their speciality, results, and a lime band to start a trial.",
    components: "All-caps condensed headings, square edges, lime solid buttons with black text, diagonal or skewed section edges used once or twice, numerals at display size, a timetable grid. No soft pastel cards.",
    imagery: "Real training in motion: sweat, chalk, effort, real members and coaches, hard contrast and a cool grade. Never smiling-at-camera stock gym photos.",
    trust: "Belief through results and people: member transformations and numbers the brief supplies, coaches' credentials, the timetable and prices up front, and one urgent call — book a free class.",
  },
  inverse: { ground: "#F5F5F2", surface: "#FFFFFF", ink: "#0B0B0C", muted: "#55554F", line: "#DADAD3", accent: "#0B0B0C", accentInk: "#D7FF3A", success: "#1F7A3A", danger: "#B42318" },
};

const NIGHTLIFE: DesignDNA = {
  name: "Neon nightlife",
  blueprint: "M · Nightlife and culture — music, DJs, clubs, festivals, concerts, gaming, esports",
  register: "neon night",
  intent:
    "After dark: a deep violet-black ground, wide geometric display type, one hot neon pink, and photographs of light, crowds and stages. It should feel loud even when silent.",
  type: {
    display: `"Unbounded", ${SANS}`,
    body: `"DM Sans", ${SANS}`,
    webfont: {
      family: "Unbounded",
      families: ["Unbounded", "DM Sans"],
      href: "https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700;800&family=DM+Sans:wght@400;500;700&display=swap",
    },
    ratio: 1.414,
    base: 16,
    displayLeading: 1.0,
    displayTracking: "-0.02em",
    displayWeight: 700,
  },
  color: { ground: "#0A0614", surface: "#140D24", ink: "#F5F0FF", muted: "#B3A6D1", line: "#2A1F45", accent: "#FF3EA5", accentInk: "#0A0614", success: "#7CF0B0", danger: "#FF9AA8" },
  space: [4, 8, 12, 16, 24, 32, 48, 72, 104, 144, 192],
  radius: { sm: "6px", md: "14px", lg: "24px", pill: "999px" },
  shadow: { sm: "0 0 0 1px rgba(255,62,165,.25)", md: "0 0 40px rgba(255,62,165,.28)" },
  container: "1280px",
  motion: { fast: "120ms", base: "240ms", slow: "800ms", ease: "cubic-bezier(.4,0,.2,1)", easeOut: "cubic-bezier(.16,1,.3,1)", stagger: "70ms", distance: "28px", personality: "Pulse, not chaos: a glow that breathes on the main action, images that slide in on the beat, a marquee for line-ups only when the brief has one." },
  art: {
    composition: "A full-screen stage or crowd photograph with the name huge across it, then upcoming dates as a ticket list (date, venue, Get tickets), the line-up or artists as large tiles, a gallery strip, and a newsletter or tickets band.",
    components: "Glowing outline and solid neon buttons, ticket rows with dashed perforation dividers, glass panels over photographs, small mono labels for dates, a gradient edge used once. No corporate cards.",
    imagery: "Light and people: stage lights, lasers, crowds, the artist mid-performance, grainy and saturated, magenta and blue. Never a stock DJ silhouette.",
    trust: "Belief through the scene: real dates, venues, line-ups and past events the brief supplies, sold-out marks only when true, social proof from the community, one clear call — tickets.",
  },
  inverse: { ground: "#FAF7FF", surface: "#FFFFFF", ink: "#140B26", muted: "#5A4E73", line: "#E4DCF3", accent: "#B0136E", accentInk: "#FFFFFF", success: "#1F7A3A", danger: "#B42318" },
};

const ROMANCE: DesignDNA = {
  name: "Romantic occasion",
  blueprint: "N · Occasions — weddings, bridal, event planners, florists, photographers of occasions",
  register: "soft romantic",
  intent:
    "Soft and celebratory: a blush-white ground, a fashion-house serif with fine contrast, dusty-rose accents and photographs full of soft daylight. Elegant, never saccharine.",
  type: {
    display: `"Bodoni Moda", Didot, Georgia, "Times New Roman", serif`,
    body: `"Jost", ${SANS}`,
    webfont: {
      family: "Bodoni Moda",
      families: ["Bodoni Moda", "Jost"],
      href: "https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,400;0,500;1,400&family=Jost:wght@300;400;500&display=swap",
    },
    ratio: 1.333,
    base: 17,
    displayLeading: 1.1,
    displayTracking: "0em",
    displayWeight: 400,
  },
  color: { ground: "#FBF7F4", surface: "#FFFFFF", ink: "#2A2024", muted: "#6E5F64", line: "#EADFD8", accent: "#8A5A5E", accentInk: "#FFFFFF", success: "#2F6B3A", danger: "#A3271F" },
  space: [4, 8, 12, 16, 24, 32, 48, 64, 96, 136, 176],
  radius: { sm: "2px", md: "6px", lg: "999px", pill: "999px" },
  shadow: { sm: "none", md: "0 20px 50px rgba(138,90,94,.12)" },
  container: "1160px",
  motion: { fast: "160ms", base: "320ms", slow: "1100ms", ease: "cubic-bezier(.2,.6,.2,1)", easeOut: "cubic-bezier(.16,1,.3,1)", stagger: "120ms", distance: "16px", personality: "Graceful: slow soft fades, photographs that gently scale into place, nothing sharp or sudden." },
  art: {
    composition: "Centred and airy: an arched or oval-cropped photograph with the names or the studio in italic serif, then the story, the services or packages as elegant columns, a gallery of real occasions, kind words, and a gentle enquiry form.",
    components: "Arched picture frames, thin rules with a small centred ornament, italic serif accents inside headings, outlined buttons that fill softly on hover, an RSVP or enquiry form with soft fields.",
    imagery: "Soft daylight, real couples and real details — flowers, table settings, hands, fabric — with a light, airy, slightly warm grade. Never staged stock weddings.",
    trust: "Belief through real occasions and kind words: galleries of real events, testimonials from couples or clients, packages with what is included, and one gentle call — check your date or enquire.",
  },
  inverse: { ground: "#171214", surface: "#211A1D", ink: "#F7EFEC", muted: "#BBA9AD", line: "#382C30", accent: "#E8B7B2", accentInk: "#171214", success: "#8CC79A", danger: "#F0938A" },
};

const NATURE: DesignDNA = {
  name: "Natural outdoors",
  blueprint: "O · Nature — outdoor, eco and sustainable brands, farms, gardens, landscaping, travel and tours",
  register: "natural light outdoors",
  intent:
    "Grounded and fresh: a stone-paper ground, a soft characterful serif, a deep forest-green accent and wide landscapes. Feels like breathing out.",
  type: {
    display: `"Fraunces", Georgia, "Times New Roman", serif`,
    body: `"Nunito Sans", ${SANS}`,
    webfont: {
      family: "Fraunces",
      families: ["Fraunces", "Nunito Sans"],
      href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Nunito+Sans:wght@400;600;700&display=swap",
    },
    ratio: 1.3,
    base: 17,
    displayLeading: 1.08,
    displayTracking: "-0.015em",
    displayWeight: 600,
  },
  color: { ground: "#F4F1E8", surface: "#FBFAF5", ink: "#1B2418", muted: "#56614F", line: "#DCD8C8", accent: "#2F5D34", accentInk: "#F7F5EC", success: "#2F6B3A", danger: "#A3271F" },
  space: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 168],
  radius: { sm: "6px", md: "12px", lg: "24px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(27,36,24,.06)", md: "0 14px 36px rgba(27,36,24,.10)" },
  container: "1220px",
  motion: { fast: "150ms", base: "300ms", slow: "900ms", ease: "cubic-bezier(.25,.6,.3,1)", easeOut: "cubic-bezier(.16,1,.3,1)", stagger: "90ms", distance: "22px", personality: "Calm and organic: landscapes that drift slightly as you scroll, soft rises, nothing mechanical." },
  art: {
    composition: "A wide landscape with the promise over it, then what you do in three honest blocks with photographs, the place or the process, impact numbers when the brief has them, trips or products as cards with a real photo, and a band to book or shop.",
    components: "Softly rounded cards with photographs edge to edge, leaf-green solid buttons, small uppercase labels, an organic curved divider used once, simple line icons. No neon, no hard shadows.",
    imagery: "Real places and real hands: landscapes, soil, plants, trails, the team outdoors, natural light and a warm-green grade. Never generic stock leaves on white.",
    trust: "Belief through honesty and place: where things come from, certifications the brief supplies, real guests or customers, clear prices and seasons, one call — book, visit or shop.",
  },
  inverse: { ground: "#101610", surface: "#182018", ink: "#EEF2E6", muted: "#A9B5A0", line: "#2A3528", accent: "#A8D08D", accentInk: "#101610", success: "#9AD7A6", danger: "#F0938A" },
};

const RETRO: DesignDNA = {
  name: "Retro warm",
  blueprint: "P · Retro — barbers, diners, record shops, vintage stores, coffee roasters, craft beer",
  register: "vintage warm",
  intent:
    "Nostalgic and characterful: a toasted-cream ground, a soft high-contrast display serif, burnt-orange and brown, and badges that look printed. Seventies warmth, made crisp.",
  type: {
    display: `"DM Serif Display", Georgia, "Times New Roman", serif`,
    body: `"Work Sans", ${SANS}`,
    webfont: {
      family: "DM Serif Display",
      families: ["DM Serif Display", "Work Sans"],
      href: "https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Work+Sans:wght@400;500;600&display=swap",
    },
    ratio: 1.333,
    base: 17,
    displayLeading: 1.02,
    displayTracking: "-0.01em",
    displayWeight: 400,
  },
  color: { ground: "#F6EEDC", surface: "#FFF8E8", ink: "#2B1D12", muted: "#6B5440", line: "#E2D2B0", accent: "#C2410C", accentInk: "#FFF8E8", success: "#2F6B3A", danger: "#A3271F" },
  space: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 168],
  radius: { sm: "4px", md: "10px", lg: "18px", pill: "999px" },
  shadow: { sm: "2px 2px 0 #2B1D12", md: "5px 5px 0 #2B1D12" },
  container: "1180px",
  motion: { fast: "120ms", base: "240ms", slow: "700ms", ease: "cubic-bezier(.4,0,.2,1)", easeOut: "cubic-bezier(.16,1,.3,1)", stagger: "80ms", distance: "18px", personality: "Tactile: buttons that press down onto their hard shadow, stickers that settle with a slight tilt. Charming, never gimmicky." },
  art: {
    composition: "A big warm headline beside a round badge or stamp with the year founded, then what is on offer as a printed-menu style list or cards, the people and the place, a strip of photographs with a film grain, and a band to visit or order.",
    components: "Hard offset shadows that press on click, round stamp badges, two-tone stripes used once, outlined pills, a slightly tilted sticker label for one highlight. No glassy blur.",
    imagery: "Warm, grainy photographs: the shop, the craft, regulars, close-ups of the product, a film-like grade with faded blacks. Never glossy stock.",
    trust: "Belief through character and loyalty: the story and the year it started, real regulars' words, prices on the wall, address and hours, one call — come by or order.",
  },
  inverse: { ground: "#1C140D", surface: "#261C13", ink: "#F8EEDB", muted: "#C2AE8E", line: "#3E2F20", accent: "#F2A541", accentInk: "#1C140D", success: "#9AD7A6", danger: "#F0938A" },
};

const BRUTALIST: DesignDNA = {
  name: "Raw brutalist",
  blueprint: "Q · Brutalist — avant-garde studios, zines, art spaces, radical brands, portfolios that break rules",
  register: "raw and unpolished",
  intent:
    "Raw on purpose: pure white, pure black, a single primary blue, a heavy grotesque, visible borders and a grid you can see. Honest, loud, instantly memorable.",
  type: {
    display: `"Archivo Black", "Arial Black", ${SANS}`,
    body: `"Space Grotesk", ${SANS}`,
    webfont: {
      family: "Archivo Black",
      families: ["Archivo Black", "Space Grotesk"],
      href: "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;700&display=swap",
    },
    ratio: 1.5,
    base: 17,
    displayLeading: 0.92,
    displayTracking: "-0.03em",
    displayWeight: 400,
  },
  color: { ground: "#FFFFFF", surface: "#F2F2F2", ink: "#000000", muted: "#4A4A4A", line: "#000000", accent: "#0000FF", accentInk: "#FFFFFF", success: "#006B2E", danger: "#C40000" },
  space: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192],
  radius: { sm: "0px", md: "0px", lg: "0px", pill: "0px" },
  shadow: { sm: "none", md: "6px 6px 0 #000000" },
  container: "1440px",
  motion: { fast: "0ms", base: "120ms", slow: "300ms", ease: "steps(3, end)", easeOut: "cubic-bezier(.2,.8,.2,1)", stagger: "40ms", distance: "0px", personality: "Abrupt on purpose: hovers that invert colour instantly, no fades, no float — things are there or not." },
  art: {
    composition: "A visible grid with 2px black borders between cells, a giant headline that runs off the edge, content in bordered blocks of different sizes, text set flush left in hard columns, a ticker or index list.",
    components: "Black-bordered boxes everywhere, buttons that invert on hover, underlined links, monospace labels, numbered index lists, no rounded corners at all, one blue used only for actions.",
    imagery: "Photographs in black and white or high contrast, cropped hard, sometimes in a bordered cell with a caption number. Never soft lifestyle stock.",
    trust: "Belief through conviction: a manifesto in plain words, the work or the product shown bluntly, prices and contacts in plain sight, one call to act written as a command.",
  },
  inverse: { ground: "#000000", surface: "#111111", ink: "#FFFFFF", muted: "#B5B5B5", line: "#FFFFFF", accent: "#FFFF00", accentInk: "#000000", success: "#5CFF9D", danger: "#FF7A7A" },
};

const COMMUNITY: DesignDNA = {
  name: "Community warm",
  blueprint: "R · Community — nonprofits, charities, churches, schools, local councils, associations, NGOs",
  register: "hopeful community",
  intent:
    "Open and hopeful: a warm white ground, an exceptionally readable rounded sans, a sunrise-orange accent and photographs of real people together. Easy for everyone to read and act on.",
  type: {
    display: `"Lexend", ${SANS}`,
    body: `"Source Sans 3", ${SANS}`,
    webfont: {
      family: "Lexend",
      families: ["Lexend", "Source Sans 3"],
      href: "https://fonts.googleapis.com/css2?family=Lexend:wght@500;600;700&family=Source+Sans+3:wght@400;600;700&display=swap",
    },
    ratio: 1.25,
    base: 18,
    displayLeading: 1.12,
    displayTracking: "-0.01em",
    displayWeight: 600,
  },
  color: { ground: "#FFFBF5", surface: "#FFFFFF", ink: "#1A2233", muted: "#556074", line: "#ECE3D6", accent: "#C2410C", accentInk: "#FFFFFF", success: "#1F7A3A", danger: "#B42318" },
  space: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160],
  radius: { sm: "8px", md: "14px", lg: "24px", pill: "999px" },
  shadow: { sm: "0 1px 2px rgba(26,34,51,.06)", md: "0 12px 32px rgba(26,34,51,.10)" },
  container: "1180px",
  motion: { fast: "150ms", base: "280ms", slow: "750ms", ease: "cubic-bezier(.25,.6,.3,1)", easeOut: "cubic-bezier(.16,1,.3,1)", stagger: "80ms", distance: "18px", personality: "Warm and steady: gentle rises, a progress bar that fills once, nothing flashy that would distract from the cause." },
  art: {
    composition: "A real photograph of people with the mission in one plain sentence, then impact in large numbers, the programmes or ministries as cards, stories of people helped, events or services with dates, and a strong donate, volunteer or join band.",
    components: "Big readable text, rounded cards, a solid orange Donate or Join button repeated at the top, a fundraising progress bar, event rows with date blocks, simple line icons, high-contrast focus states throughout.",
    imagery: "Real people from the community, together and in action, natural and dignified, warm grade. Never pity imagery, never stock handshakes.",
    trust: "Belief through transparency: what the money or time does, real stories, registration numbers and partners the brief supplies, upcoming dates, and one clear action — donate, volunteer, visit or join.",
  },
  inverse: { ground: "#121722", surface: "#1A2130", ink: "#F3F5FA", muted: "#AAB3C5", line: "#2A3345", accent: "#FDBA74", accentInk: "#121722", success: "#86EFAC", danger: "#FCA5A5" },
};

export const SYSTEMS = [EDITORIAL, CRAFT, CLINICAL, TECHNICAL, COMMERCIAL, PRESS, LUMINOUS, SANCTUARY, CAPITAL, CORPORATE, DASHBOARD, CREATIVE, PLAYFUL, DINING, ATHLETIC, NIGHTLIFE, ROMANCE, NATURE, RETRO, BRUTALIST, COMMUNITY];

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
  webapp: DASHBOARD,
  /* The spec's look for these: a neutral grey scale, one accent, hairlines
     rather than shadows. Technical for the product and the freight company,
     Clinical for money, where calm is the point; Editorial for a portfolio,
     where the work is the colour. */
  saas: TECHNICAL,
  fintech: CAPITAL,
  logistics: CORPORATE,
  portfolio: EDITORIAL,
};

/* asset-planner's default register for the kinds whose own system should
   win over it (see decideDesign). Kept in step with KIND_DEFAULTS there by
   tools/check-domain.mjs. */
export const KIND_DEFAULT_REGISTER: Partial<Record<BuildKind, string>> = {
  webapp: "functional and unadorned",
  logistics: "technical and functional",
  fintech: "clinical trust",
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
  { match: /\b(brutalist|brutalism|anti[- ]design|raw grid)\b/i, system: BRUTALIST },
  { match: /\b(retro|vintage|nostalgic|throwback|old[- ]school|70s|80s|seventies|eighties)\b/i, system: RETRO },
  { match: /\b(neon|cyberpunk|synthwave|vaporwave|glow(ing)?)\b/i, system: NIGHTLIFE },
  { match: /\b(playful|fun|colou?rful|cheerful|cute|whimsical|kid[- ]friendly)\b/i, system: PLAYFUL },
  { match: /\b(romantic|blush|dreamy|soft pink)\b/i, system: ROMANCE },
  { match: /\b(sporty|athletic|high[- ]energy|aggressive)\b/i, system: ATHLETIC },
  { match: /\b(bold|expressive|experimental|avant[- ]garde)\b/i, system: CREATIVE },
  { match: /\b(corporate)\b/i, system: CORPORATE },
];

/* The industry the brief names, which beats the photographic register.
 *
 * The register answers "what do the pictures look like", and for these
 * industries that is the wrong question: "a premium wealth manager" is a luxury
 * register and is not a fashion house, and "a boutique hotel" is a boutique and
 * is not a shop. The industry decides who the page has to convince and how,
 * which is what a design system is for.
 *
 * Ordered most specific first, so "an AI tool for dental clinics" is a clinic
 * before it is an AI product. A brief that names a LOOK (NAMED above) still
 * beats all of these. */
const BY_INDUSTRY: { match: RegExp; system: DesignDNA }[] = [
  {
    match: /\b(clinics?|medical|dental|dentists?|hospitals?|healthcare|pharmac\w*|physio\w*|doctors?|diagnostics?|patients?)\b/i,
    system: CLINICAL,
  },
  {
    match: /\b(financ\w*|fintech|banks?|banking|wealth|investments?|investors?|asset management|private equity|venture capital|insurance|accountants?|accounting|law firm|lawyers?|solicitors?|attorneys?|legal services|real estate|realtors?|propert(y|ies)|estate agen\w*|mortgages?|brokerage)\b/i,
    system: CAPITAL,
  },
  {
    match: /\b(weddings?|bridal|brides?|engagements?|event planners?|event planning|wedding planners?|florists?|flower shop|anniversar\w*|vow renewals?)\b/i,
    system: ROMANCE,
  },
  {
    match: /\b(wellness|spa|yoga|pilates|meditation|retreats?|hotels?|resorts?|guest ?house|bed and breakfast|villas?|hospitality|skincare|massage|holistic|mindful\w*)\b/i,
    system: SANCTUARY,
  },
  {
    match: /\b(restaurants?|bistros?|brasseries?|steakhouses?|trattorias?|pizzerias?|sushi|ramen|tapas|fine dining|eatery|eateries|cocktail bars?|wine bars?|rooftop bars?|gastropubs?|(local|village|irish|country) pubs?|caf[eé]s?|coffee shops?|tea rooms?|caterers?|catering|private chefs?|chefs?|supper clubs?)\b/i,
    system: DINING,
  },
  {
    match: /\b(gyms?|fitness|crossfit|personal trainers?|personal training|boxing|kickboxing|martial arts|karate|taekwondo|jiu[- ]jitsu|mma|bootcamps?|sports? clubs?|football clubs?|soccer|basketball|athletics|running clubs?|cycling clubs?|sportswear|athletes?|coaching for athletes)\b/i,
    system: ATHLETIC,
  },
  {
    match: /\b(kids?|children'?s?|toddlers?|nurser(y|ies)|daycare|day care|preschools?|kindergartens?|creches?|toys?|toy store|play ?centres?|play ?centers?|birthday part(y|ies)|kids'? part(y|ies)|bouncy castles?|pets?|pet shop|dog grooming|groomers?|tutoring|tutors?)\b/i,
    system: PLAYFUL,
  },
  {
    match: /\b(non[- ]?profits?|charit(y|ies)|ngos?|charitable foundations?|churches|church|mosques?|temples?|synagogues?|ministr(y|ies)|parish|schools?|academ(y|ies)|colleges?|universit(y|ies)|community (centres?|centers?|groups?)|volunteers?|volunteering|local councils?|residents'? associations?|cooperatives?|co-ops?|fundrais\w*|donations?)\b/i,
    system: COMMUNITY,
  },
  {
    match: /\b(night ?clubs?|clubs? nights?|djs?|festivals?|concerts?|gigs?|live music|music venues?|record labels?|bands?|rappers?|singers?|artists? (tour|tours)|esports?|e-sports?|gaming|gamers?|game studios?|streamers?|raves?|parties|lounges?)\b/i,
    system: NIGHTLIFE,
  },
  {
    match: /\b(barbers?|barbershops?|diners?|record (shops?|stores?)|vinyl|thrift|second[- ]hand|antiques?|coffee roasters?|roastery|breweries|brewery|craft beer|tattoo\w*|bike shop)\b/i,
    system: RETRO,
  },
  {
    match: /\b(farms?|farmers?|gardens?|gardening|garden centres?|landscap\w*|nurseries? for plants|outdoors?|eco[- ](friendly|conscious|brands?|products?|tourism|lodges?|stores?)|ecological|sustainab\w*|camping|campsites?|glamping|hiking|trekking|safaris?|tour operators?|tours?|travel agenc\w*|adventure|national parks?|conservation|solar|renewable)\b/i,
    system: NATURE,
  },
  {
    match: /\b(developers?|devtools?|dev tools?|api|sdk|cli|open[- ]source|observability|devops)\b/i,
    system: TECHNICAL,
  },
  {
    /* "AI" only in capitals: lower-case "ai" is a word in several languages
       and a fragment of nothing in English worth matching. */
    match: /\bAI\b|\b([Aa]rtificial intelligence|[Mm]achine learning|LLMs?|[Gg]enerative|[Nn]eural|[Ff]uturistic|[Dd]eep[- ]?tech|[Qq]uantum|[Rr]obotics?|[Aa]utonomous|[Aa]gentic)\b/,
    system: LUMINOUS,
  },
  {
    match: /\b(creative agenc\w*|design studio|branding agenc\w*|graphic designers?|illustrators?|artists?|photographers?|videographers?|filmmakers?|musicians?|motion designers?|art directors?)\b/i,
    system: CREATIVE,
  },
  {
    match: /\b(logistics|freight|shipping company|haulage|trucking|couriers?|warehous\w*|construction|contractors?|engineering firm|manufactur\w*|industrial|consultanc\w*|consulting firm|security company|cleaning company|facilities management)\b/i,
    system: CORPORATE,
  },
  {
    match: /\b(crm|dashboard|admin panel|back office|internal tool|project management|inventory system|management system|customer portal)\b/i,
    system: DASHBOARD,
  },
];

/**
 * A system by name, or null.
 *
 * The name travels rather than the object. Everything in this file is a
 * constant chosen from a fixed set, so sending the whole DNA through a webhook
 * would be pushing two hundred bytes of hex codes down a wire to arrive at
 * something already on the other end — and giving every hop between here and
 * the save route a chance to alter a colour. A name cannot be half-corrupted:
 * it either matches one of the set or it does not.
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

  const industry = BY_INDUSTRY.find((entry) => entry.match.test(brief ?? ""));
  if (industry) {
    return {
      dna: industry.system,
      reason: `the brief names the industry — "${(brief.match(industry.match) ?? [""])[0].toLowerCase()}" — so ${industry.system.name.toLowerCase()}`,
    };
  }

  /* The kind's own design, when the register is only that kind's default —
     asset-planner's answer to "what does this kind look like when the brief
     does not say", not something the brief asked for. Without this, a web
     app's "functional and unadorned" read as Technical, a freight company's
     "technical and functional" as Technical and a fintech's "clinical trust"
     as Clinical, before the kind's own system was ever reached. */
  if (KIND_DEFAULT_REGISTER[kind] === register) {
    return { dna: BY_KIND[kind], reason: `the house design for this kind of project — ${BY_KIND[kind].blueprint.split(" — ")[0]}` };
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
export function tokensCss(dna: DesignDNA, options: { fontImport?: boolean } = {}): string {
  const scale = typeScale(dna.type)
    .map((step) => `  --text-${step.name}: ${step.px}px;`)
    .join("\n");

  const space = dna.space.map((value, index) => `  --space-${index}: ${value}px;`).join("\n");
  const dark = isDark(dna);
  const alternate = dark ? "light" : "dark";

  /* The fonts themselves. A Next.js project's stylesheet imports them; a
     single page gets a <link> instead (withTokens), which the download
     inliner can carry. Before this, nothing loaded them at all: every stack
     fell through to the system face and every project looked alike. */
  const fontImport = options.fontImport !== false && dna.type.webfont ? `@import url("${dna.type.webfont.href}");\n` : "";

  return `${fontImport}/* ${dna.name} — this project's design system.
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
${paletteVars(dna.color)}

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
  --slow: ${dna.motion.slow};
  --ease: ${dna.motion.ease};
  --ease-out: ${dna.motion.easeOut};
  --stagger: ${dna.motion.stagger};
  --distance: ${dna.motion.distance};

  /* States */
  --disabled-opacity: 0.45;
  --press-scale: 0.98;
}

html { color-scheme: ${dark ? "dark" : "light"}; }

/* The other theme, for a project with a toggle: set data-theme="${alternate}" on
   <html> and every surface that uses the tokens switches together. */
:root[data-theme="${alternate}"] {
${paletteVars(dna.inverse)}
  color-scheme: ${alternate};
}

body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: var(--text-base);
  line-height: var(--body-leading);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

h1, h2, h3, h4 {
  font-family: var(--font-display);
  font-weight: var(--display-weight);
  line-height: var(--display-leading);
  letter-spacing: var(--display-tracking);
  text-wrap: balance;
  margin: 0;
}

/* Interaction states. Zero specificity (:where), so anything the page styles
   itself wins — these are the floor every control stands on, not its design. */
:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
:where(a, button, [role="button"], summary) {
  transition: color var(--fast) var(--ease), background-color var(--fast) var(--ease),
    border-color var(--fast) var(--ease), box-shadow var(--base) var(--ease),
    opacity var(--fast) var(--ease), transform var(--fast) var(--ease);
}
:where(button, [role="button"]):not(:disabled, [aria-disabled="true"]):active {
  transform: scale(var(--press-scale));
}
:where(button, input, select, textarea):disabled,
:where([aria-disabled="true"]) {
  opacity: var(--disabled-opacity);
  cursor: not-allowed;
}
:where([aria-busy="true"]) { cursor: progress; }
::selection { background: var(--accent); color: var(--accent-ink); }

/* ── Ready-made pieces ──────────────────────────────────────────────────
   Built from the tokens above, so they are this system's buttons and cards,
   not a generic kit. Zero specificity (:where), so a page's own rules win.
   Use them; restyle them only where the art direction says so. */
:where(.qs-container) { width: min(100% - 2 * var(--space-3), var(--container)); margin-inline: auto; }
:where(.qs-section) { padding-block: clamp(var(--space-6), 9vw, var(--space-9)); }
:where(.qs-section-alt) { background: var(--surface); }
:where(.qs-stack) { display: flex; flex-direction: column; gap: var(--space-3); }
:where(.qs-cluster) { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
:where(.qs-grid) { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); }
:where(.qs-split) { display: grid; gap: var(--space-6); align-items: center; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); }

:where(.qs-display) { font-family: var(--font-display); font-weight: var(--display-weight); line-height: var(--display-leading); letter-spacing: var(--display-tracking); font-size: clamp(var(--text-2xl), 6.5vw, calc(var(--text-4xl) * 1.35)); text-wrap: balance; }
:where(.qs-lead) { font-size: var(--text-lg); color: var(--muted); max-width: 62ch; text-wrap: pretty; }
:where(.qs-eyebrow) { font-size: var(--text-xs); font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
:where(.qs-prose) { max-width: 68ch; }
:where(.qs-prose) > * + * { margin-top: var(--space-3); }
:where(.qs-gradient-text) { background: linear-gradient(100deg, var(--ink), var(--accent)); -webkit-background-clip: text; background-clip: text; color: transparent; }

:where(.qs-btn) {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-1);
  min-height: 44px; padding: var(--space-2) var(--space-4);
  border: 1px solid transparent; border-radius: var(--radius-md);
  font: inherit; font-weight: 600; line-height: 1.2; text-decoration: none; cursor: pointer;
}
:where(.qs-btn-primary) { background: var(--accent); color: var(--accent-ink); box-shadow: var(--shadow-sm); }
:where(.qs-btn-primary):hover { background: color-mix(in srgb, var(--accent) 88%, var(--ink)); box-shadow: var(--shadow-md); }
:where(.qs-btn-ghost) { background: transparent; color: var(--ink); border-color: var(--line); }
:where(.qs-btn-ghost):hover { border-color: var(--ink); }
:where(.qs-btn-soft) { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--ink); }
:where(.qs-btn-soft):hover { background: color-mix(in srgb, var(--accent) 20%, transparent); }
:where(.qs-btn-lg) { min-height: 52px; padding: var(--space-3) var(--space-5); font-size: var(--text-lg); }

:where(.qs-card) { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: var(--space-4); box-shadow: var(--shadow-sm); }
:where(a.qs-card, .qs-card-hover):hover { box-shadow: var(--shadow-md); border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); }
:where(.qs-badge) { display: inline-flex; align-items: center; gap: var(--space-0); padding: 2px var(--space-2); border-radius: var(--radius-pill); font-size: var(--text-xs); font-weight: 600; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--ink); }
:where(.qs-divider) { height: 1px; border: 0; background: var(--line); margin-block: var(--space-5); }

:where(.qs-field) { display: grid; gap: var(--space-1); }
:where(.qs-label) { font-size: var(--text-sm); font-weight: 600; }
:where(.qs-input) { width: 100%; min-height: 44px; padding: var(--space-2) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); color: var(--ink); font: inherit; font-size: max(16px, var(--text-base)); }
:where(.qs-input):focus { border-color: var(--accent); outline: 2px solid color-mix(in srgb, var(--accent) 35%, transparent); outline-offset: 0; }

/* Surfaces with character — for the systems whose art direction asks. */
:where(.qs-glass) { background: color-mix(in srgb, var(--surface) 62%, transparent); -webkit-backdrop-filter: blur(16px) saturate(140%); backdrop-filter: blur(16px) saturate(140%); border: 1px solid color-mix(in srgb, var(--ink) 10%, transparent); border-radius: var(--radius-lg); }
:where(.qs-mesh) { background:
  radial-gradient(60% 50% at 15% 10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%),
  radial-gradient(50% 45% at 90% 85%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%),
  var(--ground); }
:where(.qs-grain) { position: relative; isolation: isolate; }
:where(.qs-grain)::after { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; opacity: .07; mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
:where(.qs-frame) { overflow: hidden; border-radius: var(--radius-lg); }
:where(.qs-frame) > img { display: block; width: 100%; height: 100%; object-fit: cover; }

/* Motion, declared by attribute so no script is needed and nothing is hidden
   that a reader without script, or with motion turned off, cannot see:
     data-enter            the opening screen, on load; style="--i: n" staggers
     data-reveal           a block that eases in as it scrolls into view
     data-parallax         a frame whose <img> drifts slightly as it scrolls
   Scroll effects use scroll-driven animations where the browser has them and
   simply do not happen where it does not — the content is there either way. */
@keyframes qs-rise {
  from { opacity: 0; transform: translateY(var(--distance)); }
  to { opacity: 1; transform: none; }
}
@keyframes qs-drift {
  from { transform: translateY(-5%) scale(1.1); }
  to { transform: translateY(5%) scale(1.1); }
}
@media (prefers-reduced-motion: no-preference) {
  html { scroll-behavior: smooth; }
  [data-enter] {
    animation: qs-rise var(--slow) var(--ease-out) both;
    animation-delay: calc(var(--i, 0) * var(--stagger));
  }
  @supports (animation-timeline: view()) {
    [data-reveal] {
      animation: qs-rise var(--ease-out) both;
      animation-timeline: view();
      animation-range: entry calc(var(--i, 0) * 4%) cover calc(28% + var(--i, 0) * 4%);
    }
    /* clip, not hidden: hidden would make the frame its own scroller, and a
       view timeline measured against a box that never scrolls never moves. */
    [data-parallax] { overflow: clip; view-timeline-name: --qs-frame; }
    [data-parallax] > img {
      animation: qs-drift linear both;
      animation-timeline: --qs-frame;
    }
  }
  @view-transition { navigation: auto; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;
}

/** A palette as custom properties — the same names for either theme. */
function paletteVars(palette: Palette): string {
  return [
    `  --ground: ${palette.ground};`,
    `  --surface: ${palette.surface};`,
    `  --ink: ${palette.ink};`,
    `  --muted: ${palette.muted};`,
    `  --line: ${palette.line};`,
    `  --accent: ${palette.accent};`,
    `  --accent-ink: ${palette.accentInk};`,
    `  --success: ${palette.success};`,
    `  --danger: ${palette.danger};`,
  ].join("\n");
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

  return `THE DESIGN SYSTEM — ${dna.name} (design blueprint ${dna.blueprint}). Decided before you were called, and not a starting point to improve on.

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
  var(--success)     confirmations — always said in words as well
  var(--danger)      errors and destructive actions — always said in words as well

TYPE
  Headings: var(--font-display) at weight ${dna.type.displayWeight}, leading ${dna.type.displayLeading}, tracking ${dna.type.displayTracking}.
  Body: var(--font-body) at var(--text-base), leading 1.6.
  Sizes, and there are no others: ${scale.map((step) => `var(--text-${step.name}) ${step.px}px`).join(", ")}.
${
  dna.type.webfont
    ? `  This project's fonts are already linked: ${(dna.type.webfont.families ?? [dna.type.webfont.family]).join(" (headings) and ")}${(dna.type.webfont.families?.length ?? 1) > 1 ? " (body text)" : ""}. Use var(--font-display) and var(--font-body); do not add any other font.`
    : `  System fonts only. Do not link a webfont — the page is downloadable and carries everything it fetches.`
}

SPACE
  Only these, as var(--space-0) … var(--space-${dna.space.length - 1}): ${dna.space.join(", ")}px.
  A margin of 37px is the tell that a section was designed on its own.

SHAPE
  Radii: var(--radius-sm) ${dna.radius.sm}, var(--radius-md) ${dna.radius.md}, var(--radius-lg) ${dna.radius.lg}, var(--radius-pill) for anything fully round.
  Shadows: var(--shadow-sm) and var(--shadow-md). There is no third.
  Content is capped at var(--container) ${dna.container}.

THEME
  This system is ${isDark(dna) ? "dark" : "light"} because the brand calls for it. Ship that theme. Only if the brief asks for a toggle, add one: it sets data-theme="${isDark(dna) ? "light" : "dark"}" on <html> (every token above switches with it — already defined), starts from prefers-color-scheme, and remembers the choice in try/catch.

ART DIRECTION — how this system composes, which matters more than its colours
  Composition: ${dna.art.composition}
  Components: ${dna.art.components}
  Imagery: ${dna.art.imagery}
  Trust and conversion: ${dna.art.trust}

STATES — every control, designed in each
  Hover, pressed, focus-visible, disabled, loading (aria-busy="true", the label says what is happening), success and error. Focus rings, the press, disabled and the transitions are already in the stylesheet; design hover and the rest to match.

MOTION — ${dna.motion.personality}
  var(--fast) ${dna.motion.fast} for hovers, var(--base) ${dna.motion.base} for anything that opens or moves, on var(--ease); var(--slow) ${dna.motion.slow} on var(--ease-out) for entrances. Siblings stagger by var(--stagger) ${dna.motion.stagger} and travel var(--distance) ${dna.motion.distance}.
  Already built, by attribute — use these, do not write your own observers or keyframes:
    data-enter on the opening screen's headline, text and action, with style="--i: 0", 1, 2 to stagger them.
    data-reveal on the blocks of later sections, with --i on siblings.
    data-parallax on the frame around at most two large photographs (the frame holds an <img> directly).
  Reduced motion is already honoured. Animate only transform and opacity; nothing loops or moves on its own.

READY-MADE PIECES — already in the stylesheet, built from these tokens. Use them instead of re-styling the same things by hand:
  Layout: qs-container, qs-section (qs-section-alt for a surface band), qs-stack, qs-cluster, qs-grid (responsive cards), qs-split (text beside a picture).
  Type: qs-display (the hero headline, fluid), qs-lead, qs-eyebrow, qs-prose, qs-gradient-text (once, if at all).
  Actions: qs-btn with qs-btn-primary | qs-btn-ghost | qs-btn-soft, plus qs-btn-lg for the main call.
  Content: qs-card (qs-card-hover when it is a link), qs-badge, qs-divider, qs-frame around a cropped <img>.
  Forms: qs-field > qs-label + qs-input (inputs, selects, textareas).
  Surfaces: qs-glass (over a photograph), qs-mesh (a soft accent wash), qs-grain (film grain) — only where the art direction calls for them.

RHYTHM — this is what separates a designed page from a stack of sections.
  Vary the sections deliberately: alternate their height, their density, their background (var(--ground) against var(--surface)), whether they are full-bleed or held to the container, and where the emphasis sits. Two adjacent sections with the same padding, the same grid and the same background read as one long section.
  Do not repeat hero → three cards → testimonials → call to action. That shape is the default a generator falls into, and every visitor has seen it.`;
}

/* A marker rather than a guess at whether the tokens are already there.
 *
 * A page goes round the edit loop many times and is re-saved on each one, and
 * a second :root block appended each time would be a document that grows a
 * design system per edit. Searching for "--ground" instead would match a page
 * that merely USES the tokens, which is every page this works on. */
const TOKENS_MARK = "data-quickstark-tokens";

/**
 * The design system, compiled into a single-page build.
 *
 * The gap this closes is the one that made the design system prose. tokensCss
 * had exactly one caller — scaffold.ts, writing app/tokens.css into a NEXT.JS
 * TREE — so a project got real tokens and a page, which is the overwhelming
 * majority of what this builder produces, got a paragraph in the prompt
 * describing them and nothing that enforced anything. designGate could only
 * ever check the page against values the model had chosen to honour.
 *
 * Now the same tokens are the same tokens in both shapes. The model is told to
 * use the names; this is what makes the names resolve.
 *
 * ── Inserted first, not last ──────────────────────────────────────────────
 *
 * At the top of <head>, before anything the model wrote. CSS custom properties
 * cascade like any other declaration, so a page that defines its own
 * `--ground` later WINS — which is deliberate. A generated page that took the
 * trouble to define a value has made a decision, and the platform overwriting
 * it would be the reverse of what the tokens are for. What this guarantees is
 * that every token NAME resolves to something sensible, so a class or a
 * `var(--space-4)` the model reached for cannot compile to nothing.
 *
 * Idempotent, and never throws: a document this cannot find a head in is
 * returned exactly as it arrived. A page is worth storing whether or not its
 * tokens were injected.
 */
export function withTokens(html: string, dna: DesignDNA | null | undefined): string {
  if (!dna || !html) return html;
  if (html.includes(TOKENS_MARK)) return html;

  /* The fonts as links, ahead of the tokens: preconnected, and in a form the
     download inliner carries (standalone-page.ts). Skipped when the page
     already links the same stylesheet. */
  const fonts =
    dna.type.webfont && !html.includes(dna.type.webfont.href)
      ? `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="${dna.type.webfont.href}">\n`
      : "";
  const block = `${fonts}<style ${TOKENS_MARK}>\n${tokensCss(dna, { fontImport: false })}\n</style>`;

  const head = html.match(/<head\b[^>]*>/i);
  if (head?.index !== undefined) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}\n${block}${html.slice(at)}`;
  }

  /* No <head>. A fragment, or a document the model opened differently — put
     the tokens before the first style or the first body, whichever comes
     first, so they still precede anything that uses them. */
  const anchor = html.search(/<style\b|<body\b/i);
  if (anchor >= 0) return `${html.slice(0, anchor)}${block}\n${html.slice(anchor)}`;

  return `${block}\n${html}`;
}
