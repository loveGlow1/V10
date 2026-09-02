import type { ImageProvider, ImageSlot, Shot } from "@/lib/builder/images";

/* Where the real pixels come from.
 *
 * Two sources, one shape. Both are keyed search APIs that take a query and a
 * width and answer with a photograph, which is the whole of what a slot needs —
 * so the adapters are small and swapping one for the other is an environment
 * variable rather than a change here.
 *
 * Unsplash is the better library and has terms attached: attribution is
 * required, and their guidelines ask that a download be registered when an
 * image is actually used. Both are honoured below. Pexels asks for attribution
 * where practical and does not require the ping.
 *
 * A third kind of source — an image MODEL rather than a library — fits the same
 * interface and is the right answer when a page needs a picture no stock
 * library has (a specific product, a named person, a bespoke composition). It
 * is not wired up here because it costs money per image and is slow enough to
 * change how a build is paced, which is a decision rather than a default. The
 * interface is what makes it a small change when it is wanted. */

const UA = "QuickStark.Ai build orchestrator";

/* Enough for a search and a download on a slow day, and short enough that a
   provider having a bad one cannot hold a build open — fillImages bounds each
   slot again on its own. */
const TIMEOUT_MS = 10_000;

async function get(url: string, headers: Record<string, string> = {}): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, ...headers },
      signal: controller.signal,
      cache: "no-store",
    });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* What to search for.
 *
 * The art direction is written for a person and reads like a photographer's
 * brief — "folded ochre wax print fabric, raking light, neutral seamless" — and
 * a stock search does badly with the second half of that. So the query is the
 * first clause, which is the subject, and the rest is dropped. */
function query(slot: ImageSlot): string {
  const subject = (slot.shot || slot.alt).split(/[,.;]/)[0].trim();
  return subject.length >= 3 ? subject : slot.alt || "photograph";
}

function orientation(ratio: string): "landscape" | "portrait" | "squarish" {
  const [a, b] = ratio.split("/").map(Number);
  if (!a || !b) return "landscape";
  if (a / b > 1.15) return "landscape";
  if (a / b < 0.87) return "portrait";
  return "squarish";
}

const unsplash = (key: string): ImageProvider => ({
  name: "unsplash",
  async shotFor(slot, width) {
    const search = await get(
      `https://api.unsplash.com/search/photos?per_page=1&content_filter=high&orientation=${orientation(
        slot.ratio,
      )}&query=${encodeURIComponent(query(slot))}`,
      { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
    );
    if (!search) return null;

    const body = (await search.json()) as {
      results?: {
        urls?: { raw?: string };
        links?: { download_location?: string };
        user?: { name?: string; links?: { html?: string } };
      }[];
    };
    const photo = body.results?.[0];
    const raw = photo?.urls?.raw;
    if (!raw) return null;

    /* Their guidelines ask that using a photo registers a download. Fired and
       not awaited on the critical path, and a failure here must not cost the
       page its picture. */
    if (photo?.links?.download_location) {
      void get(photo.links.download_location, { Authorization: `Client-ID ${key}` });
    }

    const file = await get(`${raw}&w=${width}&q=75&fm=jpg&fit=crop`);
    if (!file) return null;

    return {
      bytes: Buffer.from(await file.arrayBuffer()),
      contentType: "image/jpeg",
      credit: {
        author: photo.user?.name ?? "Unsplash contributor",
        source: "Unsplash",
        url: photo.user?.links?.html ?? "https://unsplash.com",
      },
    } satisfies Shot;
  },
});

const pexels = (key: string): ImageProvider => ({
  name: "pexels",
  async shotFor(slot, width) {
    const search = await get(
      `https://api.pexels.com/v1/search?per_page=1&orientation=${orientation(
        slot.ratio,
      )}&query=${encodeURIComponent(query(slot))}`,
      { Authorization: key },
    );
    if (!search) return null;

    const body = (await search.json()) as {
      photos?: { src?: { original?: string }; photographer?: string; url?: string }[];
    };
    const photo = body.photos?.[0];
    const original = photo?.src?.original;
    if (!original) return null;

    const file = await get(`${original}?auto=compress&cs=tinysrgb&w=${width}`);
    if (!file) return null;

    return {
      bytes: Buffer.from(await file.arrayBuffer()),
      contentType: "image/jpeg",
      credit: {
        author: photo.photographer ?? "Pexels contributor",
        source: "Pexels",
        url: photo.url ?? "https://pexels.com",
      },
    } satisfies Shot;
  },
});

/**
 * The provider this deployment is configured for, or null.
 *
 * Null is a supported state, not a broken one: every slot keeps its placeholder
 * and the page is built, stored and served exactly as it would have been. That
 * is what makes turning photographs on a deployment decision rather than a
 * dependency.
 */
export function providerFromEnv(): ImageProvider | null {
  if (process.env.UNSPLASH_ACCESS_KEY) return unsplash(process.env.UNSPLASH_ACCESS_KEY);
  if (process.env.PEXELS_API_KEY) return pexels(process.env.PEXELS_API_KEY);
  return null;
}

export const isImageProviderConfigured = Boolean(
  process.env.UNSPLASH_ACCESS_KEY || process.env.PEXELS_API_KEY,
);
