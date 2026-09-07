/* What an edit is actually asking for, and what it is allowed to touch.
 *
 * "Make the hero darker" and "add product reviews" arrive through the same
 * field and are not the same kind of request. One is a colour on one section;
 * the other is a table, a policy, a component, a page and a rule about who may
 * write a row. Handling both as "change the page" is why the second one has
 * only ever been answerable by rewriting some markup.
 *
 * So the request is classified first, against what the project actually IS —
 * and that second half is the part that was missing. The architecture manifest
 * was decided at build time and then dropped, so an edit could not know the
 * project had a database to add a table to. It is stored now (see
 * project_architecture) and read here.
 *
 * ── What this file will not do ────────────────────────────────────────────
 *
 * It does not make the change. It decides what KIND of change was asked for,
 * which layers it reaches, and — the half that matters most — which layers it
 * must not reach. §15's protected areas are the whole point: an edit that
 * touches the design tokens because somebody asked for a darker hero has
 * changed every page in the project to answer a question about one section.
 *
 * ── Deterministic, and why that is right here ─────────────────────────────
 *
 * Regexes, like every other classifier in this builder. A model could read the
 * request more subtly, and would cost a call before the edit's own call, be
 * non-deterministic on the cases that matter, and be unable to say why it
 * answered as it did. What this cannot settle it says it cannot settle:
 * `certain` is false and the caller can ask or fall back rather than acting on
 * a guess.
 *
 * Pure: no SDK import, so the browser can read it and tools/check-edit-plan.mjs
 * can compile it on its own.
 */

import type { ArchitectureManifest, Layer } from "./architecture";
import { KIND_LABEL } from "./kinds";

/* The kinds of change, from §3. Ordered by how deep they reach: a VISUAL edit
   touches how one thing looks, a MULTI_LAYER edit touches the database and the
   interface and the rules about who may do what. */
export const EDIT_KINDS = [
  "visual",
  "content",
  "component",
  "page",
  "routing",
  "responsive",
  "design_system",
  "storage",
  "authentication",
  "database",
  "backend",
  "admin",
  "payment",
  "integration",
  "multi_layer",
] as const;

export type EditKind = (typeof EDIT_KINDS)[number];

export const EDIT_LABEL: Record<EditKind, string> = {
  visual: "a look",
  content: "some words",
  component: "a component",
  page: "a page",
  routing: "where things live",
  responsive: "how it behaves on a phone",
  design_system: "the design system",
  storage: "files and uploads",
  authentication: "signing in",
  database: "what is stored",
  backend: "what happens behind it",
  admin: "the admin side",
  payment: "taking payment",
  integration: "something it connects to",
  multi_layer: "several parts at once",
};

/* ── Signals ───────────────────────────────────────────────────────────────
 *
 * Each pattern is a phrase somebody actually types. They are read in the order
 * below and the LAST match wins rather than the first, because the deeper kinds
 * are further down: "add a wishlist button" is a component and a database, and
 * calling it a component would be answering half of it.
 */

/* WHAT is being changed. These decide the kind, and they are read in order
   with the LAST match winning — the entries get deeper down the list, so a
   message that is both a colour change and a database change is read as the
   database one. The shallower reading would build the button and forget the row
   behind it. */
const ASPECTS: { kind: EditKind; match: RegExp }[] = [
  {
    kind: "visual",
    match:
      /\b(colou?r|darker|lighter|brighter|shade|tint|background|spacing|padding|margin|bigger|smaller|wider|narrower|rounded|shadow|border|align|centre|center|look|style|theme)\b/i,
  },
  {
    kind: "content",
    match:
      /\b(headline|heading|title|copy|wording|text|word|sentence|paragraph|caption|label|rename|reword|rewrite|typo|spelling|says?)\b/i,
  },
  { kind: "routing", match: /\b(route|routing|url|link to|navigate|redirect|slug|path)\b/i },
  {
    kind: "responsive",
    match: /\b(mobile|phone|tablet|responsive|small screen|breakpoint|on my phone|doesn't fit|overflow)\b/i,
  },
  {
    kind: "design_system",
    match:
      /\b(brand (?:colou?rs?|font)|design system|typeface|font family|palette|whole site|everywhere|all pages|throughout)\b/i,
  },
  { kind: "storage", match: /\b(upload|uploads|media|file|image library|attachment|avatars?)\b/i },
  {
    kind: "authentication",
    match:
      /\b(sign[ -]?in|sign[ -]?up|log[ -]?in|log[ -]?out|auth\w*|password|accounts?|sessions?|google login|magic link|forgot password|protected)\b/i,
  },
  {
    kind: "database",
    match:
      /\b(save|store|persist|remember|databases?|tables?|records?|schema|fields?|columns?|history|list of|keep track)\b/i,
  },
  {
    kind: "backend",
    match: /\b(api|endpoints?|server|backend|business logic|validation|webhooks?|email|send mail|notifications?)\b/i,
  },
  { kind: "admin", match: /\b(admin|dashboard for me|cms|back ?office|manage|moderation|publish|unpublish)\b/i },
  {
    kind: "payment",
    match: /\b(payments?|checkout|stripe|paystack|flutterwave|card|billing|subscriptions?|charge|price plan)\b/i,
  },
  {
    kind: "integration",
    match: /\b(integrat\w+|connect to|third[- ]party|zapier|slack|analytics|google maps|mailchimp|crm)\b/i,
  },
];

/* WHERE it is being changed. These are a different question and must not
   answer the first one.
 *
 * "Fix the typo in the footer" is a content change that happens to name a
 * component; reading it as a component change because the word "footer" is in
 * it gets the request wrong in a way that matters, because the two are handled
 * differently. So a location only decides the kind when nothing above said what
 * was actually being changed. */
const LOCATIONS: { kind: EditKind; match: RegExp }[] = [
  {
    kind: "component",
    match:
      /\b(buttons?|cards?|badges?|banners?|nav|navbar|menu|header|footer|hero|sections?|forms?|modals?|dialogs?|drawers?|tabs?|carousel|slider|accordion|tooltip|components?|widgets?)\b/i,
  },
  { kind: "page", match: /\b(pages?|screens?|views?|landing|home ?page|about page|contact page)\b/i },
];

/* Things people name that are FEATURES rather than any one layer. Each carries
   a set of layers with it, which is how "add a wishlist" reaches the database
   without anybody typing the word "table". */
const FEATURES: { match: RegExp; needs: Layer[]; what: string }[] = [
  {
    match: /\b(reviews?|ratings?|star ratings?|testimonials? from customers)\b/i,
    needs: ["database", "authentication", "backend"],
    what: "reviews are written by somebody, kept, and shown back",
  },
  {
    match: /\b(wishlists?|wish lists?|favourites?|favorites?|saved items?|save (?:\w+ )?for later|bookmark\w*)\b/i,
    needs: ["database", "authentication"],
    what: "a saved list belongs to a person and outlives the visit",
  },
  {
    match: /\b(comments?|discussions?|replies|reply|threads?)\b/i,
    needs: ["database", "authentication"],
    what: "comments are written by somebody and kept",
  },
  {
    match: /\b(discounts?|coupons?|promo codes?|vouchers?)\b/i,
    needs: ["database", "admin", "backend"],
    what: "a code is created by the merchant, stored, and checked at the till",
  },
  {
    match: /\b(inventory|stock levels?|out of stock)\b/i,
    needs: ["database", "admin"],
    what: "stock is a number somebody maintains",
  },
  {
    match: /\b(order history|my orders|past orders|track (?:my )?order)\b/i,
    needs: ["database", "authentication"],
    what: "an order history is one person's, and has to be theirs alone",
  },
  {
    match: /\b(newsletters?|mailing lists?|subscribe)\b/i,
    needs: ["database"],
    what: "an address somebody typed has to be kept somewhere",
  },
  {
    match: /\b(search|filter|sort by)\b/i,
    needs: [],
    what: "searching what is already on the page needs nothing new",
  },
];

/* An edit that says, in as many words, that it is only about the surface.
   Held above the feature signals: "just change the wording on the reviews
   section" is a content edit about a feature, not a request for the feature. */
/* The layers each kind cannot exist without. Authentication needs somewhere to
   put a session and something to check it; an admin needs both and a role. These
   are dependencies rather than separate concerns, which is what the multi-layer
   test below turns on. */
const FROM_KIND: Partial<Record<EditKind, Layer[]>> = {
  database: ["database", "backend"],
  backend: ["backend"],
  authentication: ["authentication", "backend", "database"],
  admin: ["admin", "backend", "database"],
  storage: ["storage", "backend"],
  payment: ["payments", "backend", "database"],
  integration: ["backend"],
};

const SURFACE_ONLY =
  /\b(just|only|simply)\b[^.]{0,30}\b(change|update|edit|fix|tweak|adjust|move|swap)\b|\b(wording|spelling|typo|colou?r) (?:on|of|in)\b/i;

export type EditPlan = {
  kind: EditKind;
  /** Every layer this change reaches, including the ones implied by a feature. */
  touches: Layer[];
  /* Layers that must not be touched. §15 — this is the field that stops "make
     the hero darker" from editing the design tokens and restyling every page. */
  protect: Layer[];
  /** Layers the change needs and the project does not have. */
  missing: Layer[];
  /** One clause per conclusion, so the answer can be argued with. */
  why: string[];
  /* Whether this is safe to act on without asking. False when the request
     reaches a layer the project does not have — adding a database to a landing
     page is not an edit, it is a different product. */
  certain: boolean;
};

function firstMatch(pattern: RegExp, text: string): string | null {
  return text.match(pattern)?.[0]?.toLowerCase() ?? null;
}

/**
 * What this edit is, what it reaches, and what it must leave alone.
 *
 * Never throws. An unreadable message becomes a content edit touching nothing,
 * which is the safe half of a wrong answer: the edit path then behaves exactly
 * as it did before this file existed.
 */
export function planEdit(message: string, manifest: ArchitectureManifest | null): EditPlan {
  const text = message ?? "";
  const why: string[] = [];

  /* WHAT is being changed, from the aspects. Last match wins: they deepen down
     the list, so a message that is both a colour and a database change is read
     as the database one. */
  let kind: EditKind | null = null;
  for (const signal of ASPECTS) {
    const found = firstMatch(signal.match, text);
    if (found) {
      kind = signal.kind;
      why.push(`"${found}" — ${EDIT_LABEL[signal.kind]}`);
    }
  }

  /* WHERE, and only when nothing said what. "Fix the typo in the footer" names
     a component and is a content change; letting the location answer the first
     question would route a one-word fix as a component rebuild. */
  if (kind === null) {
    for (const signal of LOCATIONS) {
      const found = firstMatch(signal.match, text);
      if (found) {
        kind = signal.kind;
        why.push(`"${found}" — ${EDIT_LABEL[signal.kind]}`);
      }
    }
  }

  if (kind === null) kind = "content";

  const touches = new Set<Layer>();

  /* Features first, because they are what carry a request into layers nobody
     named. */
  const surfaceOnly = SURFACE_ONLY.test(text);
  /* How many layers a single named FEATURE dragged in. This is what separates
     "add reviews" from "add login": both end up touching three layers, but the
     first is one feature spanning several parts of the product and the second
     is one layer plus the two it cannot exist without. Calling the second
     multi-layer would be describing authentication's own dependencies as if
     they were separate concerns. */
  let widestFeature = 0;

  for (const feature of FEATURES) {
    if (!feature.match.test(text)) continue;
    if (surfaceOnly) {
      why.push(`asked for as a change to what is already there, not as a new feature`);
      continue;
    }
    for (const layer of feature.needs) touches.add(layer);
    if (feature.needs.length > 0) {
      why.push(feature.what);
      widestFeature = Math.max(widestFeature, feature.needs.length);
    }
  }

  /* Then the kind's own layers. */
  for (const layer of FROM_KIND[kind] ?? []) touches.add(layer);

  /* Anything that reaches past the front end reaches the front end too: a table
     nobody can see is not a feature. */
  if (touches.size > 0) touches.add("frontend");

  const deep = [...touches].filter((layer) => layer !== "frontend");

  /* Multi-layer when a FEATURE spans more than one layer, or when a feature and
     the named aspect pull in different directions — not merely when the count
     is high. "Add login" reaches authentication, its backend and its table, and
     is one change; "add product reviews" reaches the same three and is four
     pieces of work. The difference is where the layers came from. */
  const fromFeature = widestFeature > 1;
  const fromBoth = widestFeature > 0 && (FROM_KIND[kind] ?? []).length > 0;

  if (deep.length > 1 && (fromFeature || fromBoth)) {
    kind = "multi_layer";
    why.push(`this reaches ${deep.join(", ")} — one change across several`);
  }

  /* What the project does not have. Adding a database to a landing page is not
     an edit; it is a different product, and the caller should say so rather
     than quietly building one. */
  const missing = manifest ? deep.filter((layer) => !manifest[layer]) : [];
  if (missing.length > 0) {
    why.push(`this project has no ${missing.join(" or ")} yet`);
  }

  /* ── What must be left alone (§15) ───────────────────────────────────────
   *
   * Everything the project HAS that this change does not reach. Written as an
   * explicit list rather than left implicit, because it is what goes into the
   * prompt: a model told "do not touch the database" does not touch it, and a
   * model told nothing has no reason not to. */
  const protect: Layer[] = manifest
    ? (Object.keys(manifest).filter(
        (key) =>
          key !== "type" &&
          manifest[key as Layer] === true &&
          key !== "frontend" &&
          !touches.has(key as Layer),
      ) as Layer[])
    : [];

  return {
    kind,
    touches: [...touches],
    protect,
    missing,
    why: why.length > 0 ? why : ["nothing in this names a part of the project, so it is read as wording"],
    certain: missing.length === 0,
  };
}

/**
 * The plan as the editing model is shown it.
 *
 * Two halves, and the second is the one that changes behaviour. Telling a model
 * what a project has makes it able to do the work; telling it what not to touch
 * is what stops a request about one section from rewriting the site.
 */
export function editPlanBrief(
  plan: EditPlan,
  manifest: ArchitectureManifest | null,
  designName?: string | null,
): string {
  const lines: string[] = ["WHAT THIS PROJECT ALREADY IS — read this before changing anything."];

  if (manifest) {
    const has = (Object.keys(manifest) as (keyof ArchitectureManifest)[]).filter(
      (key) => key !== "type" && manifest[key] === true,
    );
    /* Named the way a person would name it, not by its internal key. "It is a
       ecommerce" is the kind of sentence that tells a model it is reading
       machine output and can write like machine output back. */
    const label = KIND_LABEL[manifest.type].toLowerCase();
    const article = /^[aeiou]/.test(label) ? "an" : "a";

    lines.push("", `It is ${article} ${label}, and it has: ${has.join(", ")}.`);
    if (designName) {
      lines.push(
        `Its design system is ${designName}. Every colour, size, radius and duration it uses is already a token — use the token names and introduce no new values.`,
      );
    }
  }

  lines.push("", `THIS CHANGE IS: ${EDIT_LABEL[plan.kind]}.`);

  if (plan.touches.length > 0) {
    lines.push(`It reaches: ${plan.touches.join(", ")}.`);
  }

  if (plan.protect.length > 0) {
    lines.push(
      "",
      `DO NOT TOUCH: ${plan.protect.join(", ")}.`,
      "These already work. Nothing in this request is about them, and changing them to answer it would break something nobody asked you to change.",
    );
  }

  lines.push(
    "",
    "AND THE RULE THAT COVERS EVERYTHING ELSE:",
    "- Change the smallest thing that satisfies the request. If it is about the hero, the footer stays exactly as it is.",
    "- Reuse what is there. If a component already does nearly this, extend it — never add ProductCardV2 beside ProductCard.",
    "- Do not restyle anything the request did not mention. A darker hero is a darker hero, not a new palette.",
  );

  if (plan.missing.length > 0) {
    lines.push(
      "",
      `NOTE: this asks for ${plan.missing.join(" and ")}, which this project does not have. Do what can be done in the page, and say plainly what is missing rather than faking it.`,
    );
  }

  return lines.join("\n");
}

/** The plan in one line, for the step list. */
export function describeEdit(plan: EditPlan): string {
  const deep = plan.touches.filter((layer) => layer !== "frontend");
  if (deep.length === 0) return `Changing ${EDIT_LABEL[plan.kind]}`;
  return `Changing ${EDIT_LABEL[plan.kind]} — ${deep.join(", ")}`;
}
