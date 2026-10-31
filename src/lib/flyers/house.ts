/* One brand, the same on every flier: the business name spelled exactly the
 * same way and the same logo, version after version and flier after flier.
 *
 * The name used to be read afresh from every message, so one flier said
 * "QuickStark.Ai", the next "Quickstark", and a revision could respell it;
 * the logo carried from one version of a flier to the next, but a new flier
 * started without it. Now:
 *
 *   a new flier      takes the brand the person has used before — its exact
 *                    spelling and its logo — unless they typed a different
 *                    brand's name (a client's), which is then that brand;
 *   a revision       keeps the name character for character unless the
 *                    person typed a new one.
 *
 * Read from the person's own fliers (flyer_jobs), newest first: the brand
 * they last used is the one they mean. QuickStark's own name is always
 * "QuickStark.ai".
 *
 * Pure apart from houseBrand. */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BrandKit, FlyerRequest } from "./types";

/** A brand name reduced to what makes it that brand: no case, spacing, punctuation or company suffix. Pure. */
export function brandKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(ai|inc|llc|ltd|limited|co|company|hq|official)\b/g, " ")
    .replace(/\s+/g, "");
}

export const sameBrand = (a: string | null | undefined, b: string | null | undefined) => Boolean(brandKey(a)) && brandKey(a) === brandKey(b);

/** QuickStark's own name in full; any other name as given. Pure. */
export function canonicalName(name: string): string {
  return brandKey(name) === "quickstark" ? "QuickStark.ai" : name.trim();
}

/**
 * The name a revision keeps: the one before, exactly, unless the person typed
 * a different one in this message (and the brief took it). Pure.
 */
export function keepName(previous: string, revised: string, change: string): string {
  if (!previous.trim()) return canonicalName(revised);
  if (!revised.trim() || sameBrand(previous, revised)) return canonicalName(previous);
  const typed = change.toLowerCase().includes(revised.trim().toLowerCase());
  return canonicalName(typed ? revised : previous);
}

export type House = { name: string; logoPath?: string; colors?: BrandKit["colors"] };

/**
 * The brand a new flier should carry, from the person's own earlier fliers:
 * the newest with the brand this request names, or — when it names none —
 * the newest with any brand. Null when there is nothing to go on.
 */
export async function houseBrand(client: SupabaseClient, userId: string, named: string | null): Promise<House | null> {
  const { data } = await client
    .from("flyer_jobs")
    .select("request")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(60);
  const brands = (data ?? [])
    .map((row) => (row as { request?: FlyerRequest | null }).request?.brand)
    .filter((brand): brand is BrandKit => Boolean(brand?.name?.trim()));
  const match = named?.trim() ? brands.find((brand) => sameBrand(brand.name, named)) : brands[0];
  if (!match) return null;
  /* The newest flier of that brand that had a logo — a later one made
     without it ("no logo this time") does not lose it for good. */
  const withLogo = brands.find((brand) => sameBrand(brand.name, match.name) && brand.logoPath);
  return { name: canonicalName(match.name), ...(withLogo?.logoPath ? { logoPath: withLogo.logoPath } : {}), colors: match.colors };
}

/**
 * A new flier's request with the house brand applied. Pure.
 *
 * The brand changes only when the person asks for it: a different name counts
 * only when they typed it in their message — never because the model that
 * read the request picked a name out of a sentence ("my salon's opening").
 */
export function withHouse(request: FlyerRequest, house: House | null, message = ""): FlyerRequest {
  const named = request.brand.name.trim();
  const typed = Boolean(named) && message.toLowerCase().includes(named.toLowerCase());
  if (!house || (named && typed && !sameBrand(named, house.name))) {
    return { ...request, brand: { ...request.brand, name: named ? canonicalName(named) : "" } };
  }
  return {
    ...request,
    brand: {
      ...request.brand,
      name: house.name,
      ...(house.logoPath && !request.brand.logoPath ? { logoPath: house.logoPath } : {}),
    },
  };
}
