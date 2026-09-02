import type { AssetRequest, VisualDirection } from "@/lib/builder/assets/asset-types";

/* What a source of pictures is, and what it owes the builder.
 *
 * The rule this whole directory exists to hold: an image provider is a plug-in
 * source, never a core dependency. QuickStark has to build a complete project
 * with every API key missing, every external provider disabled, every external
 * provider down, and every rate limit reached. Anything that can turn "Pexels
 * is not configured" into a build failure, an error in somebody's face, or a
 * broken image URL is a defect.
 *
 * That is why nothing here throws and why `health` is a value rather than an
 * exception. A provider that cannot serve says so, the resolver skips it, and
 * the chain continues. "Not configured" is an ordinary, expected, silent state —
 * the same state as "disabled", and the user is never told about either. */

/** The sources, by name. Order between them is configuration, not code. */
export const PROVIDER_IDS = ["project", "curated", "pexels", "unsplash", "ai"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/* Why a provider can or cannot serve right now.
 *
 * Five states rather than a boolean because the resolver treats them
 * differently: a disabled provider is skipped forever, a rate-limited one is
 * skipped for this build and worth trying on the next, and a misconfigured one
 * is worth telling an administrator about but never worth telling a user. */
export type ProviderHealth =
  | "available"
  | "disabled"
  | "misconfigured"
  | "rate_limited"
  | "temporarily_unavailable";

export const isUsable = (health: ProviderHealth): boolean => health === "available";

/* What a picture from this source costs, which the resolver is allowed to care
   about. A curated asset is free and a generated one is not, and a project that
   needs twelve product shots should not reach for the expensive source first
   merely because it sits higher in a list somebody wrote once. */
export type CostLevel = "free" | "low" | "medium" | "high";

export const COST_ORDER: Record<CostLevel, number> = { free: 0, low: 1, medium: 2, high: 3 };

/** One picture, from wherever it came. */
export type Supply = {
  /** Where it can be served from. A URL, or bytes for something not yet stored. */
  url?: string;
  bytes?: Buffer;
  contentType?: string;
  width?: number;
  height?: number;
  /* Everything §11 asks an external result to carry, so it can become a proper
     asset record rather than a URL somebody found once. */
  provider: ProviderId;
  sourceUrl?: string;
  license?: string;
  attribution?: { author: string; source: string; url: string };
  query?: string;
  retrievedAt: string;
};

export type SupplyContext = {
  projectId: string;
  direction: VisualDirection;
  /** Assets this project already holds, for the sources that can use them. */
  existing?: unknown;
};

export type AssetProvider = {
  id: ProviderId;
  label: string;
  cost: CostLevel;
  /** What it can do beyond finding one picture. A library cannot edit. */
  capabilities: { bespoke: boolean; edit: boolean; upscale: boolean };
  /**
   * Whether this source can serve right now. Never throws.
   *
   * Called before every attempt rather than cached, because "configured" and
   * "reachable" are different questions and the second one changes.
   */
  health(): ProviderHealth | Promise<ProviderHealth>;
  /**
   * One picture for this request, or null.
   *
   * Null means "nothing suitable", which is ordinary. Anything that went wrong
   * is reported through `health` on the next call rather than thrown here — the
   * caller's job is to move down the chain, not to handle an exception.
   */
  supply(request: AssetRequest, context: SupplyContext): Promise<Supply | null>;
};
