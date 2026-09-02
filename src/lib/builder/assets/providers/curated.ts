import type { AssetProvider, ProviderHealth, Supply } from "@/lib/builder/assets/providers/types";
import type { AssetRequest, AssetType } from "@/lib/builder/assets/asset-types";

/* The QuickStark curated library — the source that has to work on its own.
 *
 * Every other provider in this directory is optional. This one is the reason
 * they can be: a project must be buildable to a launchable standard with no API
 * key, no external service and no network beyond our own storage, and that is
 * only true if we hold enough photographs ourselves.
 *
 * The library is a CATALOGUE plus a BUCKET, kept apart on purpose. The
 * catalogue is code — reviewable, diffable, and the thing that decides which
 * photograph answers "a hero for a luxury restaurant". The bytes live in object
 * storage behind one base URL, so the same catalogue serves a local bucket, a
 * Supabase bucket or a CDN without a line changing here.
 *
 * Which is also why an unpopulated library reports `misconfigured` rather than
 * serving broken addresses: with no base URL there is nowhere for these paths
 * to point, and a picture that 404s is worse than a slot the layout was told to
 * leave plain. */

export type CuratedEntry = {
  /** Path within the bucket. The catalogue never holds absolute URLs. */
  path: string;
  type: AssetType;
  /** What is in the picture, for matching against a request's subject. */
  tags: string[];
  /** Which visual registers it belongs to — see asset-planner. */
  registers: string[];
  aspect: string;
  width: number;
  height: number;
  /** Ours to use, and on what terms. Every entry must say. */
  license: string;
  attribution?: { author: string; source: string; url: string };
};

/* The starting catalogue.
 *
 * Deliberately small and deliberately real in shape: these are the slots a
 * first production configuration has to cover — a hero and supporting imagery
 * for the registers the planner can pick, product photography for a storefront,
 * and article covers for a publication.
 *
 * Populating it is an operations job, not a code change: put the files in the
 * bucket at these paths and the library starts answering. Adding a photograph
 * is one entry here plus one file there. */
export const CATALOGUE: CuratedEntry[] = [
  // ── heroes, by register ────────────────────────────────────────────────
  { path: "hero/luxury-interior-01.webp", type: "hero", tags: ["interior", "luxury", "hospitality", "restaurant", "hotel"], registers: ["luxury editorial"], aspect: "16/9", width: 2400, height: 1350, license: "quickstark-owned" },
  { path: "hero/workshop-daylight-01.webp", type: "hero", tags: ["workshop", "craft", "maker", "tools", "hands"], registers: ["warm documentary"], aspect: "16/9", width: 2400, height: 1350, license: "quickstark-owned" },
  { path: "hero/clinic-room-01.webp", type: "hero", tags: ["clinic", "medical", "dental", "treatment", "care"], registers: ["clean clinical"], aspect: "16/9", width: 2400, height: 1350, license: "quickstark-owned" },
  { path: "hero/depot-dusk-01.webp", type: "hero", tags: ["depot", "fleet", "industrial", "logistics", "yard"], registers: ["technical documentary"], aspect: "16/9", width: 2400, height: 1350, license: "quickstark-owned" },
  { path: "hero/table-laid-01.webp", type: "hero", tags: ["restaurant", "food", "table", "dining", "kitchen"], registers: ["appetite-first food photography"], aspect: "16/9", width: 2400, height: 1350, license: "quickstark-owned" },
  { path: "hero/studio-rail-01.webp", type: "hero", tags: ["fashion", "clothing", "garments", "rail", "studio"], registers: ["editorial fashion"], aspect: "16/9", width: 2400, height: 1350, license: "quickstark-owned" },
  { path: "hero/desk-daylight-01.webp", type: "hero", tags: ["office", "software", "work", "desk", "team"], registers: ["clear commercial", "functional and unadorned"], aspect: "16/9", width: 2400, height: 1350, license: "quickstark-owned" },

  // ── supporting editorial and lifestyle ─────────────────────────────────
  { path: "editorial/hands-at-work-01.webp", type: "editorial", tags: ["hands", "making", "detail", "craft"], registers: ["warm documentary", "editorial reportage"], aspect: "4/3", width: 1800, height: 1350, license: "quickstark-owned" },
  { path: "editorial/counter-service-01.webp", type: "editorial", tags: ["counter", "service", "shop", "customer"], registers: ["warm documentary", "clear commercial"], aspect: "4/3", width: 1800, height: 1350, license: "quickstark-owned" },
  { path: "lifestyle/in-use-01.webp", type: "lifestyle", tags: ["using", "customer", "everyday", "home"], registers: ["clear commercial", "luxury editorial"], aspect: "3/2", width: 1800, height: 1200, license: "quickstark-owned" },
  { path: "lifestyle/street-front-01.webp", type: "lifestyle", tags: ["shopfront", "street", "exterior", "local"], registers: ["warm documentary"], aspect: "3/2", width: 1800, height: 1200, license: "quickstark-owned" },

  // ── product photography, one lighting set so a catalogue looks like one shop
  { path: "product/seamless-neutral-01.webp", type: "product", tags: ["product", "object", "studio", "seamless"], registers: ["luxury editorial", "catalogue-consistent product photography"], aspect: "4/5", width: 1400, height: 1750, license: "quickstark-owned" },
  { path: "product/seamless-neutral-02.webp", type: "product", tags: ["product", "object", "studio", "seamless"], registers: ["luxury editorial", "catalogue-consistent product photography"], aspect: "4/5", width: 1400, height: 1750, license: "quickstark-owned" },
  { path: "product/seamless-neutral-03.webp", type: "product", tags: ["product", "object", "studio", "seamless"], registers: ["catalogue-consistent product photography"], aspect: "4/5", width: 1400, height: 1750, license: "quickstark-owned" },
  { path: "product/seamless-neutral-04.webp", type: "product", tags: ["product", "object", "studio", "seamless"], registers: ["catalogue-consistent product photography"], aspect: "4/5", width: 1400, height: 1750, license: "quickstark-owned" },
  { path: "product/textile-folded-01.webp", type: "product", tags: ["fabric", "textile", "cloth", "folded", "material"], registers: ["editorial fashion", "catalogue-consistent product photography"], aspect: "4/5", width: 1400, height: 1750, license: "quickstark-owned" },
  { path: "product/textile-folded-02.webp", type: "product", tags: ["fabric", "textile", "cloth", "folded", "material"], registers: ["editorial fashion", "catalogue-consistent product photography"], aspect: "4/5", width: 1400, height: 1750, license: "quickstark-owned" },

  // ── article covers ─────────────────────────────────────────────────────
  { path: "article/abstract-warm-01.webp", type: "article-cover", tags: ["abstract", "texture", "warm"], registers: ["editorial reportage"], aspect: "3/2", width: 1800, height: 1200, license: "quickstark-owned" },
  { path: "article/abstract-cool-01.webp", type: "article-cover", tags: ["abstract", "texture", "cool"], registers: ["editorial reportage"], aspect: "3/2", width: 1800, height: 1200, license: "quickstark-owned" },
  { path: "article/desk-notes-01.webp", type: "article-cover", tags: ["notes", "writing", "desk", "paper"], registers: ["editorial reportage"], aspect: "3/2", width: 1800, height: 1200, license: "quickstark-owned" },
  { path: "article/city-window-01.webp", type: "article-cover", tags: ["city", "window", "urban", "light"], registers: ["editorial reportage"], aspect: "3/2", width: 1800, height: 1200, license: "quickstark-owned" },

  // ── backgrounds ────────────────────────────────────────────────────────
  { path: "background/paper-grain-01.webp", type: "background", tags: ["paper", "texture", "neutral"], registers: ["editorial reportage", "warm documentary"], aspect: "16/9", width: 2400, height: 1350, license: "quickstark-owned" },
  { path: "background/concrete-01.webp", type: "background", tags: ["concrete", "texture", "grey"], registers: ["technical documentary"], aspect: "16/9", width: 2400, height: 1350, license: "quickstark-owned" },
];

/** Everything in the catalogue that could answer this request, best first. */
export function search(request: AssetRequest, register: string, used: Set<string>): CuratedEntry[] {
  const subject = (request.spec?.subject ?? request.alt).toLowerCase();

  return CATALOGUE.filter((entry) => entry.type === request.type)
    .map((entry) => {
      let score = 0;
      /* Register first. A photograph from the project's own visual direction is
         worth more than one whose subject matches but whose light is wrong —
         the whole point of a direction is that the set looks like one shoot. */
      if (entry.registers.includes(register)) score += 6;
      score += entry.tags.filter((tag) => subject.includes(tag)).length * 3;
      if (entry.aspect === request.aspectRatio) score += 2;
      /* Anything already used in this project drops to the back, so a
         twelve-product grid does not show the same photograph twelve times. */
      if (used.has(entry.path)) score -= 20;
      return { entry, score };
    })
    .filter(({ score }) => score > -10)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry);
}

/**
 * The curated library, as a provider.
 *
 * `CURATED_ASSETS_BASE_URL` is where the bytes are. Unset, the library reports
 * misconfigured and is skipped exactly as an unconfigured API is — which is the
 * honest state, because a catalogue with nowhere to point is a list of 404s.
 */
export function curatedProvider(): AssetProvider {
  const base = (process.env.CURATED_ASSETS_BASE_URL ?? "").replace(/\/+$/, "");
  const used = new Set<string>();

  return {
    id: "curated",
    label: "QuickStark Asset Library",
    cost: "free",
    capabilities: { bespoke: false, edit: false, upscale: false },

    health(): ProviderHealth {
      if (process.env.CURATED_LIBRARY_ENABLED === "false") return "disabled";
      if (!base) return "misconfigured";
      if (CATALOGUE.length === 0) return "misconfigured";
      return "available";
    },

    async supply(request, context): Promise<Supply | null> {
      if (!base) return null;

      const matches = search(request, context.direction.register, used);
      const entry = matches[0];
      if (!entry) return null;

      used.add(entry.path);

      return {
        url: `${base}/${entry.path}`,
        width: entry.width,
        height: entry.height,
        provider: "curated",
        license: entry.license,
        attribution: entry.attribution,
        query: request.spec?.subject ?? request.alt,
        retrievedAt: new Date().toISOString(),
      };
    },
  };
}
