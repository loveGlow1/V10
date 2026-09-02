import type { Library } from "@/lib/builder/assets/asset-library";
import { aiImageProvider } from "@/lib/builder/assets/providers/ai";
import { curatedProvider } from "@/lib/builder/assets/providers/curated";
import { projectProvider } from "@/lib/builder/assets/providers/project";
import { pexelsProvider, unsplashProvider } from "@/lib/builder/assets/providers/stock";
import {
  COST_ORDER,
  PROVIDER_IDS,
  isUsable,
  type AssetProvider,
  type CostLevel,
  type ProviderHealth,
  type ProviderId,
} from "@/lib/builder/assets/providers/types";

/* Which sources exist, in which order, and whether each may be used.
 *
 * The order is configuration rather than code, because it will change. Today a
 * curated photograph is preferred over a generated one; the day generation gets
 * good and cheap enough that ordering inverts, and nothing outside this file
 * should have to be rewritten for it.
 *
 * The default chain is the one the strategy names, and it is chosen so that the
 * two free, always-present sources come first: what the project already has,
 * then the library we own. Everything after them is an enhancement. */

const DEFAULT_ORDER: ProviderId[] = ["project", "curated", "unsplash", "pexels", "ai"];

/**
 * The order to try sources in.
 *
 * `ASSET_PROVIDER_ORDER` overrides it — a comma-separated list of ids. Unknown
 * names are ignored rather than fatal, and anything left out is simply not
 * consulted, which is how a deployment turns a source off without unsetting its
 * key.
 */
export function providerOrder(): ProviderId[] {
  const configured = (process.env.ASSET_PROVIDER_ORDER ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name): name is ProviderId => (PROVIDER_IDS as readonly string[]).includes(name));

  return configured.length > 0 ? configured : DEFAULT_ORDER;
}

/** Every source, built. Construction is cheap and reads no network. */
export function allProviders(library: Library): Record<ProviderId, AssetProvider> {
  return {
    project: projectProvider(library),
    curated: curatedProvider(),
    unsplash: unsplashProvider(),
    pexels: pexelsProvider(),
    ai: aiImageProvider(),
  };
}

export type ProviderStatus = {
  id: ProviderId;
  label: string;
  cost: CostLevel;
  health: ProviderHealth;
  usable: boolean;
};

/**
 * What every source says about itself.
 *
 * For an administrator, and for the health endpoint. Never for a user: that a
 * stock API is unconfigured is not something anybody building a website should
 * be told, let alone asked to fix.
 */
export async function providerStatus(library: Library): Promise<ProviderStatus[]> {
  const providers = allProviders(library);

  return Promise.all(
    providerOrder().map(async (id) => {
      const provider = providers[id];
      const health = await provider.health();
      return { id, label: provider.label, cost: provider.cost, health, usable: isUsable(health) };
    }),
  );
}

/**
 * The chain to actually use for this build: in order, healthy, affordable.
 *
 * `maxCost` is what makes a twelve-product storefront affordable — a project
 * can be told to stay free, and the expensive source is simply not in the chain
 * it is given rather than being refused later.
 *
 * An empty result is a supported outcome, not an error. Every slot resolves to
 * a placeholder, the page is built, and nobody is asked to configure anything.
 */
export async function usableProviders(
  library: Library,
  opts: { maxCost?: CostLevel } = {},
): Promise<AssetProvider[]> {
  const providers = allProviders(library);
  const ceiling = COST_ORDER[opts.maxCost ?? "high"];
  const chain: AssetProvider[] = [];

  for (const id of providerOrder()) {
    const provider = providers[id];
    if (COST_ORDER[provider.cost] > ceiling) continue;
    if (!isUsable(await provider.health())) continue;
    chain.push(provider);
  }

  return chain;
}
