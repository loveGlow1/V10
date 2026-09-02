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

      /* Theirs first, matched conservatively: by type, then by a tag naming the
         slot. A wrong match here is worse than no match, because it puts
         somebody's unrelated photograph somewhere they did not choose. */
      const theirs =
        ready.find((asset) => asset.source === "user" && asset.type === request.type) ??
        ready.find(
          (asset) =>
            asset.source === "user" &&
            asset.tags?.some((tag) => tag.toLowerCase() === request.slot.toLowerCase()),
        );

      if (theirs) {
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
