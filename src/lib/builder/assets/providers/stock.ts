import { promptFor, widthFor } from "@/lib/builder/assets/asset-generator";
import type { AssetRequest } from "@/lib/builder/assets/asset-types";
import type { AssetProvider, ProviderHealth, ProviderId, Supply } from "@/lib/builder/assets/providers/types";

/* Pexels and Unsplash: optional, and interchangeable.
 *
 * Both are keyed search APIs that take a query and a width and answer with a
 * photograph, so one adapter shape covers both and enabling either is an
 * environment variable rather than a change here.
 *
 * Everything about how they fail is the point of this file. A missing key is
 * `misconfigured`. A 401 is `misconfigured` and says so on the next health
 * check rather than throwing. A 429 is `rate_limited` and this build stops
 * asking. A timeout or a 5xx is `temporarily_unavailable`. None of them reach a
 * user, none of them stop a build, and none of them put a broken URL on a page:
 * the resolver reads the state, skips the provider, and carries on down the
 * chain to the curated library, which is always there. */

const TIMEOUT_MS = 9_000;

type Adapter = {
  id: ProviderId;
  label: string;
  key(): string | undefined;
  search(query: string, width: number, orientation: string, key: string): Promise<Supply | null>;
};

/* Health is remembered between calls, because the useful states are learned by
   making a request. A key that came back 401 once will come back 401 again, and
   a build that discovered a rate limit should not spend eleven more requests
   rediscovering it. */
const observed = new Map<ProviderId, ProviderHealth>();

async function call(url: string, headers: Record<string, string>, id: ProviderId): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "QuickStark.Ai build orchestrator", ...headers },
      signal: controller.signal,
      cache: "no-store",
    });

    if (response.status === 401 || response.status === 403) observed.set(id, "misconfigured");
    else if (response.status === 429) observed.set(id, "rate_limited");
    else if (response.status >= 500) observed.set(id, "temporarily_unavailable");
    else observed.set(id, "available");

    return response.ok ? response : null;
  } catch {
    observed.set(id, "temporarily_unavailable");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* The subject, not the whole brief. Art direction reads like a photographer's
   note — "folded ochre fabric, raking light, neutral seamless" — and a stock
   search does badly with everything after the first comma. */
function query(request: AssetRequest): string {
  const source = request.spec ? request.spec.subject : request.alt;
  const first = source.split(/[,.;]/)[0].trim();
  return first.length >= 3 ? first : request.alt || "photograph";
}

function orientation(ratio: string): string {
  const [a, b] = ratio.split(/[/:]/).map(Number);
  if (!a || !b) return "landscape";
  if (a / b > 1.15) return "landscape";
  if (a / b < 0.87) return "portrait";
  return "squarish";
}

const ADAPTERS: Adapter[] = [
  {
    id: "unsplash",
    label: "Unsplash",
    key: () => process.env.UNSPLASH_ACCESS_KEY,
    async search(q, width, orient, key) {
      const found = await call(
        `https://api.unsplash.com/search/photos?per_page=1&content_filter=high&orientation=${orient}&query=${encodeURIComponent(q)}`,
        { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
        "unsplash",
      );
      if (!found) return null;

      const body = (await found.json()) as {
        results?: {
          urls?: { raw?: string };
          links?: { html?: string; download_location?: string };
          user?: { name?: string; links?: { html?: string } };
        }[];
      };
      const photo = body.results?.[0];
      if (!photo?.urls?.raw) return null;

      /* Their guidelines ask that using a photograph registers a download.
         Fired and not awaited: a failure here must not cost the page a picture. */
      if (photo.links?.download_location) {
        void call(photo.links.download_location, { Authorization: `Client-ID ${key}` }, "unsplash");
      }

      return {
        url: `${photo.urls.raw}&w=${width}&q=80&fm=jpg&fit=crop`,
        width,
        provider: "unsplash",
        sourceUrl: photo.links?.html,
        license: "Unsplash License",
        attribution: {
          author: photo.user?.name ?? "Unsplash contributor",
          source: "Unsplash",
          url: photo.user?.links?.html ?? "https://unsplash.com",
        },
        query: q,
        retrievedAt: new Date().toISOString(),
      };
    },
  },
  {
    id: "pexels",
    label: "Pexels",
    key: () => process.env.PEXELS_API_KEY,
    async search(q, width, orient, key) {
      const found = await call(
        `https://api.pexels.com/v1/search?per_page=1&orientation=${orient}&query=${encodeURIComponent(q)}`,
        { Authorization: key },
        "pexels",
      );
      if (!found) return null;

      const body = (await found.json()) as {
        photos?: { src?: { original?: string }; photographer?: string; url?: string }[];
      };
      const photo = body.photos?.[0];
      if (!photo?.src?.original) return null;

      return {
        url: `${photo.src.original}?auto=compress&cs=tinysrgb&w=${width}`,
        width,
        provider: "pexels",
        sourceUrl: photo.url,
        license: "Pexels License",
        attribution: {
          author: photo.photographer ?? "Pexels contributor",
          source: "Pexels",
          url: photo.url ?? "https://pexels.com",
        },
        query: q,
        retrievedAt: new Date().toISOString(),
      };
    },
  },
];

function stockProvider(adapter: Adapter): AssetProvider {
  return {
    id: adapter.id,
    label: adapter.label,
    cost: "low",
    capabilities: { bespoke: false, edit: false, upscale: false },

    health(): ProviderHealth {
      if (process.env[`${adapter.id.toUpperCase()}_ENABLED`] === "false") return "disabled";
      if (!adapter.key()) return "misconfigured";
      return observed.get(adapter.id) ?? "available";
    },

    async supply(request): Promise<Supply | null> {
      const key = adapter.key();
      if (!key) return null;
      return adapter.search(query(request), widthFor(request.quality), orientation(request.aspectRatio), key);
    },
  };
}

export const unsplashProvider = (): AssetProvider => stockProvider(ADAPTERS[0]);
export const pexelsProvider = (): AssetProvider => stockProvider(ADAPTERS[1]);

/** Exposed for the checks: nothing else should be reading learned state. */
export const observedHealth = observed;
export { promptFor };
