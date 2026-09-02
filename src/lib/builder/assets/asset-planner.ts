import {
  DEFAULT_QUALITY,
  isPhoto,
  type AssetRequest,
  type AssetType,
  type Quality,
  type VisualDirection,
  type VisualSpec,
} from "@/lib/builder/assets/asset-types";
import { blueprintFor } from "@/lib/builder/blueprints";
import type { BuildKind } from "@/lib/builder/kinds";

/* Deciding what pictures a project needs, before anything goes and gets one.
 *
 * This runs after classification and before code generation, and it is the
 * whole of the answer to "why did every project come back looking the same".
 * The code model was deciding what imagery to invent, one section at a time,
 * with no memory of the section before — so a project got a luxury photograph,
 * a cartoon, a stock desk and a 3D render, each individually defensible.
 *
 * Two outputs, in this order and never the other way round:
 *
 *   1. ONE visual direction for the whole project. Register, palette, lighting,
 *      environment, mood, and what it must never contain.
 *   2. A list of requests that all inherit it.
 *
 * Deterministic on purpose. The direction is read from the brief and the
 * blueprint rather than asked for, because a planner that costs a model call
 * per build is a planner that gets skipped when it matters. Where a brief says
 * something specific — luxury, brutalist, hand-made, clinical — that wins, and
 * where it says nothing the kind's own default is a good answer rather than a
 * neutral one. */

/* Registers a brief can ask for by name. The words are the ones people
   actually type, and each carries a whole look rather than an adjective. */
const REGISTERS: { match: RegExp; direction: Omit<VisualDirection, "avoid"> }[] = [
  {
    match: /\b(luxur\w+|premium|high[- ]end|upmarket|exclusive|bespoke|couture|fine)\b/i,
    direction: {
      register: "luxury editorial",
      palette: "warm neutrals, deep shadow, one restrained metallic",
      lighting: "soft directional studio light with a slow falloff",
      environment: "minimal seamless studio, or a sparse interior with real materials",
      mood: "considered, quiet, expensive",
    },
  },
  {
    match: /\b(artisan\w*|handmade|hand[- ]made|craft\w*|small[- ]batch|independent|family[- ]run|heritage)\b/i,
    direction: {
      register: "warm documentary",
      palette: "warm earth tones, natural wood, unbleached linen",
      lighting: "north-facing window light, visible texture, honest shadow",
      environment: "a real workshop, kitchen or studio in use",
      mood: "human, unhurried, made by somebody",
    },
  },
  {
    match: /\b(clinic\w*|medical|health\w*|dental|pharma\w*|lab\w*|diagnostic)\b/i,
    direction: {
      register: "clean clinical",
      palette: "cool white, pale grey-blue, one calm accent",
      lighting: "even, bright, shadowless",
      environment: "uncluttered treatment rooms and real equipment",
      mood: "calm, competent, unintimidating",
    },
  },
  {
    match: /\b(industrial|logistics|fleet|construction|engineering|manufactur\w+|infrastructure|energy|plant)\b/i,
    direction: {
      register: "technical documentary",
      palette: "steel grey, concrete, high-visibility accent",
      lighting: "overcast daylight or hard site lighting",
      environment: "yards, depots, plant rooms and equipment in service",
      mood: "capable, unglamorous, real",
    },
  },
  {
    match: /\b(restaurant|cafe|café|bakery|food|kitchen|menu|dining|catering|coffee|bar)\b/i,
    direction: {
      register: "appetite-first food photography",
      palette: "deep saturated food tones on warm neutral ground",
      lighting: "raking side light, shallow depth of field",
      environment: "the pass, a table laid, or a close crop on the plate",
      mood: "immediate, generous, warm",
    },
  },
  {
    match: /\b(fashion|apparel|clothing|wear|textile|fabric|boutique|style|jewel\w+)\b/i,
    direction: {
      register: "editorial fashion",
      palette: "the garments' own colours against a muted ground",
      lighting: "single-source studio light, strong shape, controlled shadow",
      environment: "seamless studio, or a plain wall in daylight",
      mood: "confident, styled, current",
    },
  },
];

/* What a kind looks like when the brief does not say. Not neutral — a default
   that is neutral is the generic look the whole system exists to avoid. */
const BY_KIND: Record<BuildKind, Omit<VisualDirection, "avoid">> = {
  landing: {
    register: "clear commercial",
    palette: "one confident accent on a considered neutral",
    lighting: "bright, even, natural",
    environment: "the product or service in real use",
    mood: "direct, credible, current",
  },
  ecommerce: {
    register: "catalogue-consistent product photography",
    palette: "consistent neutral ground so the products carry the colour",
    lighting: "even studio light, identical across every product",
    environment: "seamless ground, with a few lifestyle frames for contrast",
    mood: "clean, desirable, honest about the goods",
  },
  blog: {
    register: "editorial reportage",
    palette: "restrained, letting photographs sit against a paper ground",
    lighting: "available light, documentary rather than staged",
    environment: "wherever the story actually happens",
    mood: "considered, journalistic, unposed",
  },
  webapp: {
    register: "functional and unadorned",
    palette: "the interface's own palette, nothing decorative",
    lighting: "not applicable to most of this project",
    environment: "the product itself",
    mood: "clear, quiet, competent",
  },
};

/* What no project's pictures may contain, whatever its direction. Every one of
   these is a tell that an image was generated rather than taken. */
const ALWAYS_AVOID = [
  "text, lettering, logos or watermarks inside the image",
  "wireframe or vector-illustration styling",
  "fake user interfaces or screenshots rendered as photographs",
  "obvious stock-photo staging — pointing at laptops, handshakes, headsets",
  "unrelated subject matter used as decoration",
];

/** The one look every picture in this project inherits. */
export function planDirection(kind: BuildKind, brief: string): VisualDirection {
  const named = REGISTERS.find((entry) => entry.match.test(brief));
  const base = named ? named.direction : BY_KIND[kind];

  return {
    ...base,
    avoid:
      kind === "webapp"
        ? [...ALWAYS_AVOID, "decorative photography inside functional software"]
        : ALWAYS_AVOID,
  };
}

/* Turning a request into something a generation model answers consistently.
 *
 * Never the raw brief. "A luxury skincare image" is a different photograph
 * every time it is asked for; a spec that names subject, environment,
 * composition, lighting, style and mood is close to the same photograph every
 * time, which is what makes eight of them look like one shoot. */
export function specFor(
  request: Omit<AssetRequest, "spec">,
  direction: VisualDirection,
  subject: string,
): VisualSpec {
  const composition: Record<string, string> = {
    hero: "wide composition with deliberate negative space for a headline",
    product: "centred, full object in frame, generous margin, no crop",
    portrait: "head and shoulders, eyes on the lens, shallow depth of field",
    lifestyle: "the product in use, person incidental, mid-distance",
    editorial: "off-centre subject, room to breathe, documentary framing",
    "article-cover": "single clear subject, space at one edge for a headline",
    gallery: "consistent framing with the rest of the set",
    background: "texture or surface only, nothing that competes for attention",
  };

  return {
    type: request.type,
    subject,
    environment: direction.environment,
    composition: composition[request.type] ?? "clear single subject, balanced frame",
    lighting: direction.lighting,
    style: `${direction.register}, ${direction.palette}`,
    mood: direction.mood,
    aspectRatio: request.aspectRatio,
    text: false,
    watermark: false,
  };
}

/** Everything a project needs, in one plan. */
export type AssetPlan = {
  kind: BuildKind;
  direction: VisualDirection;
  requests: AssetRequest[];
  /** Drawn in code rather than fetched — named so nothing tries to source them. */
  drawn: AssetType[];
};

/**
 * What this project needs, from its kind, its blueprint and its brief.
 *
 * The counts come from the blueprint, which is where "a storefront has at least
 * eight products" already lives, so the plan and the page cannot disagree about
 * how many pictures there are.
 */
export function planAssets(opts: {
  kind: BuildKind;
  brief: string;
  quality?: Quality;
  /** Names for the things being photographed, where the caller knows them. */
  subjects?: string[];
}): AssetPlan {
  const { kind, brief } = opts;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const direction = planDirection(kind, brief);
  const blueprint = blueprintFor(kind);
  const requests: AssetRequest[] = [];

  const add = (
    slot: string,
    type: AssetType,
    purpose: string,
    aspectRatio: string,
    alt: string,
    subject: string,
  ) => {
    const request: Omit<AssetRequest, "spec"> = { slot, type, purpose, aspectRatio, quality, alt };
    requests.push(isPhoto(type) ? { ...request, spec: specFor(request, direction, subject) } : request);
  };

  const subject = (index: number, fallback: string) => opts.subjects?.[index] ?? fallback;

  if (kind === "landing") {
    add("hero", "hero", "the opening image", "16/9", "The product in use", subject(0, briefSubject(brief)));
    add("feature-1", "editorial", "first feature section", "4/3", "How it works in practice", subject(1, briefSubject(brief)));
    add("feature-2", "lifestyle", "second feature section", "4/3", "A customer using it", subject(2, briefSubject(brief)));
    for (let i = 0; i < 3; i++) {
      add(`testimonial-${i + 1}`, "avatar", "testimonial portrait", "1/1", "Customer portrait", "");
    }
  }

  if (kind === "ecommerce") {
    add("hero", "hero", "campaign banner", "21/9", "The season's campaign", subject(0, briefSubject(brief)));
    /* Product count comes from the blueprint's own floor, so the plan and the
       page cannot disagree about how many there are. */
    const products = productFloor(blueprint.depth.floors) ?? 8;
    for (let i = 0; i < products; i++) {
      add(`product-${i + 1}`, "product", "catalogue photograph", "4/5", `Product ${i + 1}`, subject(i, briefSubject(brief)));
    }
    add("lifestyle-1", "lifestyle", "collection imagery", "3/2", "The range in use", subject(0, briefSubject(brief)));
    add("promo-1", "editorial", "promotional band", "16/9", "Current offer", subject(0, briefSubject(brief)));
  }

  if (kind === "blog") {
    add("lead", "article-cover", "lead story cover", "16/9", "Lead story", subject(0, briefSubject(brief)));
    for (let i = 0; i < 6; i++) {
      add(`article-${i + 1}`, "article-cover", "article card cover", "3/2", `Article ${i + 1}`, subject(i, briefSubject(brief)));
    }
    add("author", "portrait", "author portrait", "1/1", "The author", "");
  }

  if (kind === "webapp") {
    /* Deliberately almost nothing. Photography inside working software is
       decoration, and the blueprint forbids it. */
    add("logo", "logo", "the product's mark", "1/1", "Product logo", "");
    for (let i = 0; i < 4; i++) {
      add(`avatar-${i + 1}`, "avatar", "team member avatar", "1/1", "Team member", "");
    }
  }

  return {
    kind,
    direction,
    requests,
    drawn: [...new Set(requests.filter((r) => !isPhoto(r.type)).map((r) => r.type))],
  };
}

/* The first count the blueprint's own depth floors name. Read rather than
   duplicated, so raising the storefront's product floor raises the number of
   photographs planned for it in the same edit. */
function productFloor(floors: readonly string[]): number | null {
  for (const floor of floors) {
    const match = floor.match(/at least (\w+) (?:meaningful )?products/i);
    if (match) return words(match[1]);
  }
  return null;
}

const NUMBERS: Record<string, number> = {
  three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
};
const words = (value: string): number => NUMBERS[value.toLowerCase()] ?? (Number(value) || 8);

/* What the project is about, in a few words, for use as a photographic subject.
   Crude on purpose: the caller passes real subjects where it has them, and this
   is only what stands in when it does not. */
function briefSubject(brief: string): string {
  const cleaned = brief
    .replace(/^\s*(build|create|make|design|generate)\s+(me\s+)?(a|an|the)?\s*/i, "")
    .replace(/\b(website|web ?site|page|landing page|store|shop|blog|app|web ?app)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.split(/[,.]/)[0].slice(0, 80) || "the product";
}
