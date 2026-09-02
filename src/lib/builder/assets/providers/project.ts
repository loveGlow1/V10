import { fingerprint, type Library } from "@/lib/builder/assets/asset-library";
import { isPhoto } from "@/lib/builder/assets/asset-types";
import type { AssetProvider, ProviderHealth, Supply } from "@/lib/builder/assets/providers/types";

/* What the project already has: what somebody uploaded, and what a previous
 * build made.
 *
 * First in the chain and never optional. Two things it protects:
 *
 * Their own work. A logo somebody uploaded is their logo, and nothing may
 * redraw it, improve it or replace it with a better one somebody else took.
 * The same is true of a product photograph of an actual product.
 *
 * Their money. A rebuild that fetches the same picture again pays for it again
 * and, worse, may come back with a different one — so the second build of a
 * page does not look like the first. Reuse is keyed on the fingerprint of the
 * SPEC, so it survives a reworded brief and does not survive a real change. */
export function projectProvider(library: Library): AssetProvider {
  /* Which uploads this resolution has already placed.
   *
   * Without it every product slot in a storefront gets the same photograph:
   * the lookup below is a find(), and a find() with no memory returns the
   * first match twelve times. Somebody who uploaded twelve product shots would
   * see one of them repeated and the other eleven ignored — the precise
   * failure the quality bar forbids, in the one provider that is meant to be
   * about their own work. */
  const placed = new Set<string>();

  return {
    id: "project",
    label: "Project assets",
    cost: "free",
    capabilities: { bespoke: false, edit: false, upscale: false },

    /* Always available. There is nothing to configure and nothing to reach —
       the worst case is that the project holds nothing yet, which is a null
       from supply rather than a health problem. */
    health(): ProviderHealth {
      return "available";
    },

    async supply(request): Promise<Supply | null> {
      const ready = library.assets.filter((asset) => asset.status === "ready" && asset.url);

      /* Theirs first, matched conservatively: a tag naming this exact slot wins,
         then the first unplaced upload of the right type. A wrong match is
         worse than no match, because it puts somebody's unrelated photograph
         somewhere they did not choose — but placing the same one everywhere is
         worse still, so anything already used drops out of the running.
         
         Slot before type, deliberately: a tag is somebody saying where a
         picture goes, and that beats a guess from its type. */
      const mineForSlot = ready.find(
        (asset) =>
          asset.source === "user" &&
          !placed.has(asset.id) &&
          asset.tags?.some((tag) => tag.toLowerCase() === request.slot.toLowerCase()),
      );

      const theirs =
        mineForSlot ??
        ready.find(
          (asset) =>
            asset.source === "user" && !placed.has(asset.id) && asset.type === request.type,
        );

      if (theirs) {
        placed.add(theirs.id);
        return {
          url: theirs.url,
          width: theirs.width,
          height: theirs.height,
          provider: "project",
          license: "user-supplied",
          retrievedAt: new Date().toISOString(),
        };
      }

      /* Then anything this project already made for the same request. Only for
         photographs: a drawn asset has no spec to fingerprint. */
      if (!isPhoto(request.type) || !request.spec) return null;
      const key = fingerprint(request.spec);
      const mine = ready.find((asset) => asset.prompt === key && asset.type === request.type);

      return mine
        ? {
            url: mine.url,
            width: mine.width,
            height: mine.height,
            provider: "project",
            license: mine.provider ? `reused: ${mine.provider}` : "reused",
            retrievedAt: new Date().toISOString(),
          }
        : null;
    },
  };
}
