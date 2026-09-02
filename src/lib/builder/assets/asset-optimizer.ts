import type { Quality } from "@/lib/builder/assets/asset-types";

/* How an image is delivered, which is not how it was made.
 *
 * A generation model answers at 1600px and a product thumbnail is shown at
 * 280. Serving the first where the second is wanted is most of the weight of a
 * generated page, and it is invisible on a laptop and painful on a phone in
 * Lagos — which is the market half this product's pages are built for.
 *
 * The policy lives here as data rather than as calls to an imaging library,
 * because the actual resizing is done by whatever serves the file. Supabase
 * Storage transforms on the URL; a CDN in front of it would do the same; a
 * provider that takes a width parameter does it before the bytes ever arrive.
 * What must not happen is that each of those three places invents its own
 * sizes. */

/** The widths every image is offered at, smallest first. */
export const DELIVERY_WIDTHS = [320, 480, 768, 1024, 1440, 1920] as const;

/** What a thumbnail is, everywhere in the product. */
export const THUMBNAIL_WIDTH = 320;

/* webp everywhere it is understood, which is everywhere that matters now, and
   jpeg as the one fallback. png only for artwork with transparency, and svg is
   never rasterised — a logo is a logo. */
export const DELIVERY_FORMAT = "webp" as const;

export const COMPRESSION: Record<Quality, number> = {
  draft: 60,
  standard: 72,
  premium: 82,
  ultra: 90,
};

/** The widths worth offering for a slot, given how wide it is ever drawn. */
export function widthsFor(maxDisplayWidth: number): number[] {
  const useful = DELIVERY_WIDTHS.filter((width) => width <= maxDisplayWidth * 2);
  return useful.length > 0 ? [...useful] : [DELIVERY_WIDTHS[0]];
}

/**
 * A srcset for one asset, so the browser takes the size it actually needs.
 *
 * Built from the stored URL by appending a transform, which is the shape both
 * Supabase Storage and every CDN in front of it accept.
 */
export function srcSet(url: string, maxDisplayWidth: number, quality: Quality): string {
  return widthsFor(maxDisplayWidth)
    .map((width) => `${transformed(url, width, quality)} ${width}w`)
    .join(", ");
}

export function transformed(url: string, width: number, quality: Quality): string {
  if (url.startsWith("data:")) return url;
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}width=${width}&quality=${COMPRESSION[quality]}&format=${DELIVERY_FORMAT}`;
}

export function thumbnail(url: string, quality: Quality = "standard"): string {
  return transformed(url, THUMBNAIL_WIDTH, quality);
}

/** The attributes an <img> needs to be delivered well, as a manifest entry. */
export type Delivery = {
  src: string;
  srcset: string;
  sizes: string;
  loading: "lazy" | "eager";
  decoding: "async";
};

/**
 * How one asset should be served.
 *
 * The hero loads eagerly because it is what somebody sees first and a lazy hero
 * is a page that starts empty; everything below it waits its turn.
 */
export function deliveryFor(
  url: string,
  opts: { maxDisplayWidth: number; quality: Quality; aboveTheFold?: boolean; sizes?: string },
): Delivery {
  return {
    src: transformed(url, Math.min(opts.maxDisplayWidth * 2, 1920), opts.quality),
    srcset: srcSet(url, opts.maxDisplayWidth, opts.quality),
    sizes: opts.sizes ?? `(max-width: 768px) 100vw, ${opts.maxDisplayWidth}px`,
    loading: opts.aboveTheFold ? "eager" : "lazy",
    decoding: "async",
  };
}
