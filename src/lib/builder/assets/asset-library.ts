import type { Asset, AssetRequest, VisualSpec } from "@/lib/builder/assets/asset-types";
import { createHash } from "node:crypto";

/* What a project already has, and what it therefore does not need to make.
 *
 * Generation costs money per image, and a build that runs again — an edit, a
 * retry, a second look at the same page — must not pay for the same photograph
 * twice. So every asset carries the fingerprint of the request that produced
 * it, and an identical request finds it instead of making it.
 *
 * The fingerprint is of the SPEC, not the brief. Two builds from slightly
 * different sentences that resolve to the same picture should share it; two
 * builds that resolve to different pictures should not, however similar the
 * sentences were. */

/** A stable key for one picture request. */
export function fingerprint(spec: VisualSpec): string {
  const canonical = [
    spec.type,
    spec.subject,
    spec.environment,
    spec.composition,
    spec.lighting,
    spec.style,
    spec.mood,
    spec.aspectRatio,
  ]
    .join("|")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}

export type Library = {
  /** Everything this project already holds, ready or otherwise. */
  assets: Asset[];
};

/**
 * An asset already in the project that answers this request.
 *
 * Ready only: a failed asset is not a reason to skip trying again, and a
 * pending one is somebody else's job in flight.
 */
export function reusable(library: Library, request: AssetRequest): Asset | null {
  if (!request.spec) return null;
  const key = fingerprint(request.spec);

  return (
    library.assets.find(
      (asset) => asset.status === "ready" && asset.prompt === key && asset.type === request.type,
    ) ?? null
  );
}

/* An asset the user uploaded that is obviously the right thing.
 *
 * Deliberately conservative. Matching a logo to a logo slot is safe and is the
 * case that matters — nothing should ever redraw a company's own mark — and
 * beyond that a wrong match is worse than no match, because it puts somebody's
 * unrelated photograph in a place they did not choose. */
export function uploaded(library: Library, request: AssetRequest): Asset | null {
  const candidates = library.assets.filter(
    (asset) => asset.source === "user" && asset.status === "ready",
  );

  const byType = candidates.find((asset) => asset.type === request.type);
  if (byType) return byType;

  const tagged = candidates.find((asset) =>
    asset.tags?.some((tag) => tag.toLowerCase() === request.slot.toLowerCase()),
  );
  return tagged ?? null;
}

/** Whether a set of assets varies enough for the slots it is filling. */
export function tooRepetitive(assets: Asset[]): boolean {
  const distinct = new Set(assets.filter((a) => a.status === "ready").map((a) => a.url));
  return assets.length >= 3 && distinct.size < Math.ceil(assets.length / 2);
}
