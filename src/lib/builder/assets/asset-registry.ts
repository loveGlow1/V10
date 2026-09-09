import { createHash } from "node:crypto";

import type { Asset, AssetRequest, AssetSource, VisualDirection } from "@/lib/builder/assets/asset-types";
import type { Supply } from "@/lib/builder/assets/providers/types";

/* Which pictures belong to this project, and to no other.
 *
 * Two customers ask for a bakery. The planner writes the same visual direction
 * for both, because it is reading the same words; the same direction produces
 * the same query; the same query produces the same ranking; and the top result
 * wins both. Nothing about that is an error anywhere in the chain, and the
 * result is two different businesses whose websites show the same photograph of
 * the same bread.
 *
 * That is what this file is for. Every picture a project uses is recorded
 * against it with what it is FOR, what it is OF, how it was shot and where it
 * sits — and with a content key, which is the identity of the picture itself
 * rather than of the row. Two rows with one content key are the same photograph
 * in two places.
 *
 * ── The rule, and where it is hard ────────────────────────────────────────
 *
 * A GENERATED picture belongs to the project it was made for, absolutely. It
 * was paid for by them, it was made from their brief, and serving it to
 * somebody else is serving them a competitor's image. That is enforced: the
 * content key is checked against every other project before a generated asset
 * is used.
 *
 * A LIBRARY picture is different and pretending otherwise would be a lie. A
 * stock photograph is licensed to be used by many people; a curated catalogue
 * of two dozen images cannot give a thousand projects a unique hero each. What
 * is enforced there is variety rather than exclusivity — each project ranks the
 * same candidates in its own order, so two bakeries land on different frames of
 * the same shoot instead of on the same one. See rotationFor.
 *
 * A USER picture is theirs. It is never claimed, never rotated and never
 * refused: they uploaded it, and the whole point of an upload is that it goes
 * where they put it.
 */

export type RegistryEntry = {
  /** The asset row's own id — unique, and the thing a page's URL resolves to. */
  assetId: string;
  projectId: string;
  /** Which slot in the layout this fills. */
  slot: string;
  /** Why this picture is on the page at all. */
  purpose: string;
  /** What it is a picture of. */
  subject: string;
  /** How it was shot: the project's register, lighting and mood. */
  style: string;
  /** Where it sits — the section, the fold, the shape it holds. */
  placement: string;
  /* The identity of the PICTURE, not of this row. Stable across projects, so
     the same photograph used twice is recognisable as the same photograph. */
  contentKey: string;
  source: AssetSource;
  url: string;
};

/**
 * What identifies a picture, across every project on the platform.
 *
 * Built from what the source can actually promise to be stable: a library
 * path, a stock provider's own photo id, the fingerprint of a generation spec.
 * Never the URL — a stored asset's URL contains its row id, so two copies of
 * one photograph would look like two different pictures, which is the exact
 * thing this is meant to detect.
 */
export function contentKeyFor(supply: Supply, request: AssetRequest): string {
  const identity =
    supply.sourceUrl ??
    /* A curated path or a stock id, whichever the provider put in `query`,
       falls back to the spec: for a generated image the spec IS the picture. */
    (supply.provider === "ai"
      ? request.spec
        ? JSON.stringify(request.spec)
        : request.alt
      : supply.url ?? request.alt);

  return `${supply.provider}:${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
}

/**
 * A stable, per-project ordering offset.
 *
 * The whole of the variety mechanism, and it is deliberately arithmetic rather
 * than random: the same project must get the same pictures on every rebuild —
 * an edit that changes a headline cannot be allowed to reshuffle every
 * photograph on the page — while two different projects get different ones.
 * A hash of the project id gives both properties at once and needs no state.
 */
export function rotationFor(projectId: string): number {
  const digest = createHash("sha256").update(projectId).digest();
  return digest.readUInt32BE(0);
}

/**
 * Rotates a ranked list without disturbing its ranking.
 *
 * Candidates within `band` of the top score are treated as equally good — which
 * they are; the difference between 0.71 and 0.69 is not a difference anybody
 * can see — and the project's own offset picks between them. Everything below
 * the band keeps its place, so a weak match never gets promoted over a strong
 * one for the sake of variety.
 */
export function rotate<T>(ranked: { item: T; score: number }[], offset: number, band = 0.08): T[] {
  if (ranked.length <= 1) return ranked.map((entry) => entry.item);

  const top = ranked[0].score;
  const tied = ranked.filter((entry) => top - entry.score <= band);
  const rest = ranked.filter((entry) => top - entry.score > band);

  if (tied.length <= 1) return ranked.map((entry) => entry.item);

  const start = offset % tied.length;
  const rotated = [...tied.slice(start), ...tied.slice(0, start)];

  return [...rotated.map((entry) => entry.item), ...rest.map((entry) => entry.item)];
}

/** Whether a URL is another project's stored asset. */
export function belongsToAnotherProject(url: string, projectId: string): boolean {
  /* Stored assets live at <bucket>/<projectId>/<assetId>.<ext>. Anything under
     a different project's prefix is theirs, whatever else is true about it. */
  const match = /\/project-assets\/([0-9a-f-]{36})\//i.exec(url);
  return match !== null && match[1].toLowerCase() !== projectId.toLowerCase();
}

/** One picture, written down as what it is for. */
export function entryFor(opts: {
  asset: Asset;
  request: AssetRequest;
  direction: VisualDirection;
  contentKey: string;
}): RegistryEntry {
  const { asset, request, direction, contentKey } = opts;

  return {
    assetId: asset.id,
    projectId: asset.projectId,
    slot: request.slot,
    purpose: request.purpose,
    subject: request.spec?.subject ?? request.alt,
    style: [direction.register, direction.lighting, direction.mood].filter(Boolean).join(", "),
    placement: `${request.slot} · ${request.type} · ${request.aspectRatio}`,
    contentKey,
    source: asset.source,
    url: asset.url,
  };
}

/**
 * The registry as a page's worth of prose, for a build step or an audit.
 *
 * Written to be read by a person deciding whether the pictures on this project
 * are its own — which is a question that cannot be answered from a list of
 * URLs, and can be answered from this.
 */
export function describeRegistry(entries: RegistryEntry[]): string {
  if (entries.length === 0) return "no pictures";

  const bySource = new Map<AssetSource, number>();
  for (const entry of entries) bySource.set(entry.source, (bySource.get(entry.source) ?? 0) + 1);

  const distinct = new Set(entries.map((entry) => entry.contentKey)).size;
  const parts = [...bySource.entries()].map(([source, count]) => `${count} ${source}`);

  return `${entries.length} ${entries.length === 1 ? "picture" : "pictures"} (${parts.join(", ")}), ${distinct} distinct`;
}

/** Pictures used more than once in this project, which is nearly always a fault. */
export function duplicatesIn(entries: RegistryEntry[]): RegistryEntry[][] {
  const byKey = new Map<string, RegistryEntry[]>();
  for (const entry of entries) {
    const group = byKey.get(entry.contentKey) ?? [];
    group.push(entry);
    byKey.set(entry.contentKey, group);
  }
  return [...byKey.values()].filter((group) => group.length > 1);
}
