import type { BuildKind } from "@/lib/builder/kinds";

/* What a picture on a generated project IS, before anything goes and gets one.
 *
 * The rule this file exists to enforce is the architectural one: the model that
 * writes the code does not decide what visual assets are required, does not
 * make them, does not store them and does not optimise them. It is handed a
 * manifest and it uses what is in it. Everything here is the vocabulary that
 * manifest is built from.
 *
 * The second rule is the one that decides whether a thing is a photograph at
 * all. A chart, an icon, a dashboard, a progress bar and a diagram are drawn in
 * code — they have to stay responsive, they have to stay legible in both
 * themes, and a picture of a chart is unreadable. People, food, rooms, clothes
 * and landscapes are photographs. That distinction is not advice in a prompt
 * here; it is a property of the type, so nothing downstream can get it wrong. */

/** Every kind of visual a project can carry. */
export const ASSET_TYPES = [
  "logo",
  "brand-mark",
  "hero",
  "product",
  "editorial",
  "lifestyle",
  "portrait",
  "background",
  "illustration",
  "icon",
  "screenshot",
  "avatar",
  "article-cover",
  "gallery",
  "decorative",
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

/* How an asset is made: with a camera, or with code.
 *
 * "drawn" is not a lesser option — it is the correct one for anything the
 * interface has to keep responsive and interactive, and generating a PNG of a
 * chart is a downgrade dressed as an upgrade. */
export type Medium = "photo" | "drawn";

export const MEDIUM: Record<AssetType, Medium> = {
  logo: "drawn",
  "brand-mark": "drawn",
  hero: "photo",
  product: "photo",
  editorial: "photo",
  lifestyle: "photo",
  portrait: "photo",
  background: "photo",
  illustration: "drawn",
  icon: "drawn",
  screenshot: "drawn",
  avatar: "drawn",
  "article-cover": "photo",
  gallery: "photo",
  decorative: "drawn",
};

export const isPhoto = (type: AssetType): boolean => MEDIUM[type] === "photo";

/** Where an asset came from. Priority between them lives in asset-resolver. */
export type AssetSource = "user" | "generated" | "external" | "placeholder";

/** Where an asset is in its life. A project ships whatever these say. */
export type AssetStatus = "pending" | "generating" | "ready" | "failed";

/* What "good" costs.
 *
 * premium is the default because the product is judged on whether a real
 * company would launch the result, and draft imagery loses that argument on
 * sight. ultra is held back for when somebody asks and is paying. */
export const QUALITY_LEVELS = ["draft", "standard", "premium", "ultra"] as const;
export type Quality = (typeof QUALITY_LEVELS)[number];
export const DEFAULT_QUALITY: Quality = "premium";

/** The longest edge asked for, by quality. Delivery sizes are the optimiser's. */
export const QUALITY_WIDTH: Record<Quality, number> = {
  draft: 640,
  standard: 1024,
  premium: 1600,
  ultra: 2400,
};

/* One project, one look.
 *
 * Established once, before a single image is requested, and inherited by every
 * request after it. Without this an eight-image project comes back as one
 * luxury photograph, one cartoon, one stock desk and one 3D render — four
 * images that were each individually fine and together look like four different
 * companies. */
export type VisualDirection = {
  /** Two or three words: "luxury editorial", "warm documentary", "clean technical". */
  register: string;
  palette: string;
  lighting: string;
  /** What the pictures are set in — a studio, a home, a workshop, outdoors. */
  environment: string;
  mood: string;
  /** Anything this project's pictures must never contain. */
  avoid: string[];
};

/* A request for one picture, in the shape a generation model actually answers
 * well. The raw user prompt is never sent: "make a luxury skincare image"
 * produces a different photograph every time, and none of them match the last
 * one. */
export type VisualSpec = {
  type: AssetType;
  subject: string;
  environment: string;
  composition: string;
  lighting: string;
  style: string;
  mood: string;
  aspectRatio: string;
  /** Always false. Text inside a generated image is unfixable and always wrong. */
  text: false;
  watermark: false;
};

/** What the planner asks for: a slot in the project, and how to fill it. */
export type AssetRequest = {
  /** Stable within a project — this is the key the manifest is addressed by. */
  slot: string;
  type: AssetType;
  purpose: string;
  aspectRatio: string;
  quality: Quality;
  /** Alt text, written by the planner because it describes the intent. */
  alt: string;
  /** Only for photographs. A drawn asset has no spec — the code makes it. */
  spec?: VisualSpec;
};

/** An asset that exists, in whatever state it exists in. See §34. */
export type Asset = {
  id: string;
  projectId: string;
  type: AssetType;
  source: AssetSource;
  status: AssetStatus;
  /** Where it is served from once ready. Empty while pending or failed. */
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  format?: "webp" | "jpeg" | "png" | "svg";
  quality: Quality;
  /** The spec it was made from, so the same request can be recognised again. */
  prompt?: string;
  provider?: string;
  createdAt: string;
  altText?: string;
  tags?: string[];
  /** Set when this asset is a variant or a regeneration of another. */
  parentAssetId?: string;
  generationVersion?: number;
};

/** What the code generator is given, and all it is given. */
export type AssetManifest = {
  projectId: string;
  kind: BuildKind;
  direction: VisualDirection;
  /** slot → served URL. Every slot the plan asked for appears here. */
  assets: Record<string, string>;
  /** slot → alt text, so the markup can be written accessibly. */
  alt: Record<string, string>;
  /** Slots with no picture, named so the layout can hold their shape anyway. */
  unresolved: string[];
  /* Slots the code generator makes itself — a logo, an icon, an avatar
     monogram. Not a failure and not a placeholder: these were never going to be
     photographs, and telling a generator to leave a blank panel where it should
     draw a monogram is how a page ends up with holes in it. */
  drawn: string[];
};
