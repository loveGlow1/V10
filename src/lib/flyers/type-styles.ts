/* How a flier's words look: a headline face and a body face that belong
 * together, set in one of four layouts. The same families as the website
 * design systems (lib/builder/design.ts), so a business's flier and site can
 * match.
 *
 *   type style   modern · elegant · bold · playful · retro · neon · romantic ·
 *                natural · friendly · raw
 *   layout       bottom  words low over a dark fade (portrait), left (landscape)
 *                top     words high, the subject below
 *                center  the words in a soft card in the middle
 *                band    a solid band of the brand colour carries the words
 *
 * The brief's model picks both (brief.ts); when it does not, they are read
 * from the vibe and the request. Pure: tools/check-flier-art.mjs reads it. */

export const TYPE_STYLE_IDS = ["modern", "elegant", "bold", "playful", "retro", "neon", "romantic", "natural", "friendly", "raw"] as const;
export type TypeStyleId = (typeof TYPE_STYLE_IDS)[number];

export const LAYOUTS = ["bottom", "top", "center", "band"] as const;
export type FlyerLayout = (typeof LAYOUTS)[number];

type Face = { family: string; slug: string; weight: number };

export type TypeStyle = {
  id: TypeStyleId;
  label: string;
  heading: Face;
  body: Face;
  bodyStrong: Face;
  /** Headline in capitals: condensed and heavy display faces read best that way. */
  upper: boolean;
  /** Headline letter spacing, as a share of its size. */
  tracking: number;
  /** Headline line height. */
  leading: number;
  /** The layout this style looks best in when none is asked for. */
  layout: FlyerLayout;
  /** Vibe words that choose it. */
  match: RegExp;
};

const face = (family: string, slug: string, weight: number): Face => ({ family, slug, weight });

export const TYPE_STYLES: Record<TypeStyleId, TypeStyle> = {
  modern: {
    id: "modern", label: "Modern", heading: face("Inter", "inter", 800), body: face("Inter", "inter", 400), bodyStrong: face("Inter", "inter", 600),
    upper: false, tracking: -0.02, leading: 1.04, layout: "bottom",
    match: /\b(modern|clean|minimal|sleek|corporate|tech|professional)\b/i,
  },
  elegant: {
    id: "elegant", label: "Elegant", heading: face("Playfair Display", "playfair-display", 700), body: face("Inter", "inter", 400), bodyStrong: face("Inter", "inter", 600),
    upper: false, tracking: 0, leading: 1.08, layout: "center",
    match: /\b(luxur\w*|elegan\w*|premium|classic|editorial|fine dining|boutique|gala|sophisticated|upscale)\b/i,
  },
  bold: {
    id: "bold", label: "Bold", heading: face("Anton", "anton", 400), body: face("Barlow", "barlow", 400), bodyStrong: face("Barlow", "barlow", 600),
    upper: true, tracking: 0.01, leading: 0.98, layout: "band",
    match: /\b(bold|loud|sport\w*|fitness|gym|athletic|energetic|high[- ]energy|sale|mega|promo|impact\w*|urgent)\b/i,
  },
  playful: {
    id: "playful", label: "Playful", heading: face("Fredoka", "fredoka", 700), body: face("Nunito", "nunito", 400), bodyStrong: face("Nunito", "nunito", 700),
    upper: false, tracking: -0.01, leading: 1.06, layout: "bottom",
    match: /\b(playful|fun|kids?|children|party|birthday|cheerful|cute|colou?rful|family|toys?)\b/i,
  },
  retro: {
    id: "retro", label: "Retro", heading: face("DM Serif Display", "dm-serif-display", 400), body: face("Work Sans", "work-sans", 400), bodyStrong: face("Work Sans", "work-sans", 600),
    upper: false, tracking: -0.01, leading: 1.02, layout: "band",
    match: /\b(retro|vintage|nostalgic|70s|80s|old[- ]school|barber\w*|diner|throwback)\b/i,
  },
  neon: {
    id: "neon", label: "Neon", heading: face("Unbounded", "unbounded", 800), body: face("DM Sans", "dm-sans", 400), bodyStrong: face("DM Sans", "dm-sans", 600),
    upper: true, tracking: -0.01, leading: 1.0, layout: "bottom",
    match: /\b(neon|night\w*|club\w*|dj|rave|concert|festival|music|gaming|esports?|electric|cyber\w*)\b/i,
  },
  romantic: {
    id: "romantic", label: "Romantic", heading: face("Bodoni Moda", "bodoni-moda", 500), body: face("Jost", "jost", 400), bodyStrong: face("Jost", "jost", 500),
    upper: false, tracking: 0, leading: 1.1, layout: "center",
    match: /\b(romantic|wedding|bridal|soft|dreamy|valentine\w*|love|engagement|florist)\b/i,
  },
  natural: {
    id: "natural", label: "Natural", heading: face("Fraunces", "fraunces", 700), body: face("Nunito Sans", "nunito-sans", 400), bodyStrong: face("Nunito Sans", "nunito-sans", 600),
    upper: false, tracking: -0.015, leading: 1.06, layout: "top",
    match: /\b(natural|organic|earthy|eco\w*|green|outdoor\w*|farm\w*|garden\w*|rustic|warm|handmade)\b/i,
  },
  friendly: {
    id: "friendly", label: "Friendly", heading: face("Lexend", "lexend", 700), body: face("Source Sans 3", "source-sans-3", 400), bodyStrong: face("Source Sans 3", "source-sans-3", 600),
    upper: false, tracking: -0.01, leading: 1.08, layout: "bottom",
    match: /\b(friendly|community|church|charity|school|hopeful|welcoming|approachable|nonprofit|volunteer\w*)\b/i,
  },
  raw: {
    id: "raw", label: "Raw", heading: face("Archivo Black", "archivo-black", 400), body: face("Space Grotesk", "space-grotesk", 400), bodyStrong: face("Space Grotesk", "space-grotesk", 600),
    upper: true, tracking: -0.03, leading: 0.94, layout: "band",
    match: /\b(brutalist|raw|grunge|edgy|street\w*|underground|zine|punk)\b/i,
  },
};

export const isTypeStyle = (value: unknown): value is TypeStyleId => typeof value === "string" && (TYPE_STYLE_IDS as readonly string[]).includes(value);
export const isLayout = (value: unknown): value is FlyerLayout => typeof value === "string" && (LAYOUTS as readonly string[]).includes(value);

/**
 * The type style for a flier: the one asked for, else the first whose words
 * the vibe uses (then the imagery and headline), else modern. A heading font
 * the brand names outright wins when it is one of ours. Pure.
 */
export function typeStyleFor(input: { typeStyle?: unknown; vibe?: string; headingFont?: string; imagery?: string; headline?: string }): TypeStyle {
  if (isTypeStyle(input.typeStyle)) return TYPE_STYLES[input.typeStyle];
  const named = input.headingFont?.toLowerCase().trim();
  if (named) {
    const byFont = Object.values(TYPE_STYLES).find((style) => style.heading.family.toLowerCase() === named);
    if (byFont) return byFont;
  }
  for (const text of [input.vibe, input.imagery, input.headline]) {
    if (!text) continue;
    const hit = Object.values(TYPE_STYLES).find((style) => style !== TYPE_STYLES.modern && style.match.test(text));
    if (hit) return hit;
  }
  return TYPE_STYLES.modern;
}

/** The layout: the one asked for, else the style's own. A landscape flier keeps words to one side whatever is asked. Pure. */
export function layoutFor(style: TypeStyle, asked: unknown): FlyerLayout {
  return isLayout(asked) ? asked : style.layout;
}

/** Where a face's file is (TTF — Satori cannot read WOFF2). Pure. */
export const fontUrl = (f: Face) => `https://cdn.jsdelivr.net/fontsource/fonts/${f.slug}@latest/latin-${f.weight}-normal.ttf`;

/** What the image model is told to keep clear for the words, by layout. Pure. */
export function calmSpace(layout: FlyerLayout, landscape: boolean): string {
  if (landscape) return "Keep the left half of the image calm, darker and uncluttered for the words; put the subject on the right.";
  if (layout === "top") return "Keep the upper third of the image calm and uncluttered for the words; put the subject in the lower part.";
  if (layout === "center") return "Keep the centre of the image soft and uncluttered for a block of words; frame the subject around the edges.";
  if (layout === "band") return "Fill the frame with the subject in the upper two-thirds; the bottom third will be covered by a solid colour band with the words.";
  return "Keep the lower half of the image calm, darker and uncluttered for the words; put the subject in the upper half.";
}
