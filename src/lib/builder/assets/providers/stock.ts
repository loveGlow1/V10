import { promptFor, widthFor } from "@/lib/builder/assets/asset-generator";
import type { AssetRequest } from "@/lib/builder/assets/asset-types";
import type { AssetProvider, ProviderHealth, ProviderId, Supply, SupplyContext } from "@/lib/builder/assets/providers/types";
import {
  pickBest,
  searchTerms,
  wantFor,
  WORTH_TRYING_AGAIN,
  type Candidate,
  type Orientation,
  type StockWant,
} from "@/lib/builder/assets/stock-query";

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

/* A page of results rather than one, and the raw record kept beside the
   scoring fields — the scorer needs what the photograph says about itself, and
   the Supply can only be built once one has been chosen. */
type Found = { candidate: Candidate; supply: (width: number) => Supply };

type Adapter = {
  id: ProviderId;
  label: string;
  key(): string | undefined;
  search(query: string, orientation: string, key: string): Promise<Found[]>;
};

/* How many results to weigh per query.
 *
 * It was one, which is not a shortlist. Twenty is enough that the right
 * photograph is usually somewhere in it and small enough to stay one request:
 * both APIs return a page this size as readily as a single result, so the
 * choosing costs nothing but the ranking. */
const PER_PAGE = 20;

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

function orientation(ratio: string): Orientation {
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
    async search(q, orient, key) {
      const found = await call(
        `https://api.unsplash.com/search/photos?per_page=${PER_PAGE}&content_filter=high&orientation=${orient}&query=${encodeURIComponent(q)}`,
        { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
        "unsplash",
      );
      if (!found) return [];

      const body = (await found.json()) as {
        results?: {
          id?: string;
          description?: string | null;
          alt_description?: string | null;
          tags?: { title?: string }[];
          width?: number;
          height?: number;
          urls?: { raw?: string };
          links?: { html?: string; download_location?: string };
          user?: { name?: string; links?: { html?: string } };
        }[];
      };

      const results: Found[] = [];

      for (const photo of body.results ?? []) {
        const raw = photo?.urls?.raw;
        if (!raw || !photo.id) continue;

        results.push({
          candidate: {
            id: photo.id,
            /* Both descriptions, because they are populated inconsistently and
               either can be the only thing a photograph says about itself. */
            description: [photo.description ?? "", photo.alt_description ?? ""].join(" ").trim(),
            tags: (photo.tags ?? []).map((tag) => tag.title ?? "").filter(Boolean),
            width: photo.width,
            height: photo.height,
          },
          supply: (width) => {
            /* Their guidelines ask that USING a photograph registers a download
               — so this fires when one is chosen, rather than for all twenty
               that were merely considered. Not awaited: a failure here must not
               cost the page a picture. */
            if (photo.links?.download_location) {
              void call(photo.links.download_location, { Authorization: `Client-ID ${key}` }, "unsplash");
            }

            return {
              url: `${raw}&w=${width}&q=80&fm=jpg&fit=crop`,
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
        });
      }

      return results;
    },
  },
  {
    id: "pexels",
    label: "Pexels",
    key: () => process.env.PEXELS_API_KEY,
    async search(q, orient, key) {
      const found = await call(
        `https://api.pexels.com/v1/search?per_page=${PER_PAGE}&orientation=${orient}&query=${encodeURIComponent(q)}`,
        { Authorization: key },
        "pexels",
      );
      if (!found) return [];

      const body = (await found.json()) as {
        photos?: {
          id?: number;
          alt?: string | null;
          width?: number;
          height?: number;
          src?: { original?: string };
          photographer?: string;
          url?: string;
        }[];
      };

      const results: Found[] = [];

      for (const photo of body.photos ?? []) {
        const original = photo?.src?.original;
        if (!original || photo.id === undefined) continue;

        results.push({
          candidate: {
            id: String(photo.id),
            /* Pexels puts no tag list on a search result, so its alt text is the
               whole of what the photograph says about itself. */
            description: photo.alt ?? "",
            width: photo.width,
            height: photo.height,
          },
          supply: (width) => ({
            url: `${original}?auto=compress&cs=tinysrgb&w=${width}`,
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
          }),
        });
      }

      return results;
    },
  },
];

/* What the slot is of, in the planner's own words: the spec's subject where
   there is one — the field written for exactly this — and the alt text
   otherwise. */
function subjectOf(request: AssetRequest): string {
  const written = request.spec ? request.spec.subject : request.alt;
  return written.trim() || request.alt || "photograph";
}

/**
 * Walk the query ladder until something worth having comes back.
 *
 * It stops early on purpose. A specific query that returns a strong match is
 * the answer, and running the broader rungs afterwards would only offer worse
 * ones; a specific query that returns nothing, or only weak matches, is exactly
 * when the broader rung is worth the round trip.
 *
 * And it never gives up merely because the scores were low. The best of what
 * was found beats a grey panel on somebody's page — see WORTH_TRYING_AGAIN,
 * which is a reason to keep looking rather than a gate.
 */
async function findBest(
  adapter: Adapter,
  want: StockWant,
  terms: string[],
  taken: ReadonlySet<string>,
  key: string,
  /* Whose project this is, so two customers in the same trade are not handed
     the same photograph. See pickBest. */
  projectId: string,
): Promise<Found | null> {
  let fallback: { found: Found; score: number } | null = null;

  for (const term of terms) {
    const results = await adapter.search(term, want.orientation, key);
    if (results.length === 0) continue;

    const chosen = pickBest(results.map((result) => result.candidate), want, taken, projectId);
    if (!chosen) continue;

    const found = results.find((result) => result.candidate.id === chosen.candidate.id);
    if (!found) continue;

    if (chosen.score >= WORTH_TRYING_AGAIN) return found;

    /* Weak, but real. Kept in case every remaining rung is weaker or empty. */
    if (!fallback || chosen.score > fallback.score) fallback = { found, score: chosen.score };
  }

  return fallback?.found ?? null;
}

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

    async supply(request, context: SupplyContext): Promise<Supply | null> {
      const key = adapter.key();
      if (!key) return null;

      const want = wantFor({
        subject: subjectOf(request),
        type: request.type,
        /* The plan's kind where the resolver passed it. A stock search cannot
           tell a storefront from a newsroom by the slot name alone, and the
           same subject wants a different photograph in each. */
        kind: context.kind ?? "landing",
        direction: context.direction,
        orientation: orientation(request.aspectRatio),
        minWidth: widthFor(request.quality),
      });

      const taken = context.taken ?? new Set<string>();
      const found = await findBest(adapter, want, searchTerms(want), taken, key, context.projectId);
      if (!found) return null;

      /* Claimed before the supply is built, so the next slot in this build
         cannot be handed the same photograph. This is what stops eight product
         slots sharing one picture. */
      taken.add(found.candidate.id);

      return found.supply(widthFor(request.quality));
    },
  };
}

export const unsplashProvider = (): AssetProvider => stockProvider(ADAPTERS[0]);
export const pexelsProvider = (): AssetProvider => stockProvider(ADAPTERS[1]);

/** Exposed for the checks: nothing else should be reading learned state. */
export const observedHealth = observed;
export { promptFor };
