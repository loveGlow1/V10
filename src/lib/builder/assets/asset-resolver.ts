import { randomUUID } from "node:crypto";

import { fingerprint, type Library } from "@/lib/builder/assets/asset-library";
import { thumbnail } from "@/lib/builder/assets/asset-optimizer";
import { storeAsset } from "@/lib/builder/assets/asset-storage";
import type { AssetProvider, ProviderId } from "@/lib/builder/assets/providers/types";
import {
  isPhoto,
  type Asset,
  type AssetManifest,
  type AssetRequest,
} from "@/lib/builder/assets/asset-types";
import type { AssetPlan } from "@/lib/builder/assets/asset-planner";

/* Filling every slot a plan asked for, by walking the configured chain.
 *
 * The ladder is no longer written here, which is the change that matters. It is
 * a list of providers the registry handed over — already ordered, already
 * health-checked, already filtered to what this build can afford — and this
 * walks it. Reordering sources, disabling one, or adding a sixth is
 * configuration; nothing in this file knows the difference between a curated
 * photograph and a generated one.
 *
 * What is written here, and stays written here, is that nothing throws. A
 * provider that fails is a provider that is skipped. A chain that is empty
 * resolves every slot to a placeholder. A build with no keys, no library and no
 * network still produces a page, and nobody is ever asked to configure
 * anything. */

export type ResolveResult = {
  manifest: AssetManifest;
  /** Everything created along the way, for recording against the project. */
  created: Asset[];
  /** Which source answered how often — for logs and an admin view, never a user. */
  bySource: Partial<Record<ProviderId, number>>;
  unresolved: number;
};

export async function resolveAssets(opts: {
  projectId: string;
  plan: AssetPlan;
  library: Library;
  /** In order, healthy, affordable. See providers/registry.usableProviders. */
  providers: AssetProvider[];
  /** Storing needs a service key; without it a supplied image is carried inline. */
  store?: boolean;
  /* How long the whole resolution may take. /api/build answers inside 55s and
     a storefront is a dozen requests, so this is a real ceiling rather than a
     precaution: past it the remaining slots go unresolved, become toned panels,
     and the build ships on time. A late picture is worth less than a page. */
  deadlineMs?: number;
}): Promise<ResolveResult> {
  const { projectId, plan, library, providers } = opts;

  const assets: Record<string, string> = {};
  const alt: Record<string, string> = {};
  const unresolvedSlots: string[] = [];
  const drawnSlots: string[] = [];
  const created: Asset[] = [];
  const bySource: Partial<Record<ProviderId, number>> = {};

  const deadline = Date.now() + (opts.deadlineMs ?? 20_000);

  for (const request of plan.requests) {
    alt[request.slot] = request.alt;

    /* Out of time. Everything left is unresolved, which the manifest already
       knows how to describe — so this degrades to the same state as having no
       provider at all, which is a state the page handles. */
    if (Date.now() > deadline) {
      assets[request.slot] = "";
      if (isPhoto(request.type)) unresolvedSlots.push(request.slot);
      else drawnSlots.push(request.slot);
      continue;
    }

    /* Drawn assets never reach a source. A logo, an icon or an avatar is made
       by the code generator; only an upload can pre-empt that, and the project
       provider is the one that knows about uploads. */
    const chain = isPhoto(request.type)
      ? providers
      : providers.filter((provider) => provider.id === "project");

    let filled = false;

    for (const provider of chain) {
      let supply = null;
      try {
        supply = await provider.supply(request, {
          projectId,
          direction: plan.direction,
        });
      } catch {
        /* A source that throws is a source that is skipped. Its own health call
           reports why on the next build; this one carries on. */
        supply = null;
      }
      if (!supply) continue;

      const asset = await materialise(projectId, request, supply, opts.store === true);
      if (!asset) continue;

      assets[request.slot] = asset.url;
      /* Only what we newly acquired is reported as created — a reuse from the
         project's own library is not a new asset and must not be recorded as
         one, or every build would double the row count. */
      if (supply.provider !== "project") created.push(asset);
      library.assets.push(asset);
      bySource[supply.provider] = (bySource[supply.provider] ?? 0) + 1;
      filled = true;
      break;
    }

    if (!filled) {
      assets[request.slot] = "";
      /* A drawn slot nobody uploaded for is not a hole — it is the code
         generator's own work, which is what it was always going to be. Only a
         photograph that no source could supply is unresolved. */
      if (isPhoto(request.type)) {
        unresolvedSlots.push(request.slot);
        created.push(unfilled(projectId, request));
      } else {
        drawnSlots.push(request.slot);
      }
    }
  }

  return {
    manifest: {
      projectId,
      kind: plan.kind,
      direction: plan.direction,
      assets,
      alt,
      unresolved: unresolvedSlots,
      drawn: drawnSlots,
    },
    created,
    bySource,
    unresolved: unresolvedSlots.length,
  };
}

/* A supply becomes an asset: stored where it can be served from, or carried
   inline when there is nowhere to store it. A source that answered with a URL
   already has one and is left alone. */
async function materialise(
  projectId: string,
  request: AssetRequest,
  supply: NonNullable<Awaited<ReturnType<AssetProvider["supply"]>>>,
  store: boolean,
): Promise<Asset | null> {
  const id = randomUUID();
  let url = supply.url ?? "";

  if (!url && supply.bytes) {
    const format = (supply.contentType ?? "image/png").includes("png") ? "png" : "jpeg";
    if (store) {
      const stored = await storeAsset({
        projectId,
        assetId: id,
        bytes: supply.bytes,
        contentType: supply.contentType ?? "image/png",
        format,
      });
      if (!stored) return null;
      url = stored.url;
    } else {
      url = `data:${supply.contentType ?? "image/png"};base64,${supply.bytes.toString("base64")}`;
    }
  }

  if (!url) return null;

  return {
    id,
    projectId,
    type: request.type,
    source:
      supply.provider === "project"
        ? "user"
        : supply.provider === "ai"
          ? "generated"
          : "external",
    status: "ready",
    url,
    thumbnailUrl: url.startsWith("data:") ? undefined : thumbnail(url),
    width: supply.width,
    height: supply.height,
    format: url.includes(".png") ? "png" : "jpeg",
    quality: request.quality,
    /* The fingerprint rather than the sentence: it is what reuse looks itself
       up by, and it is stable where wording is not. */
    prompt: request.spec ? fingerprint(request.spec) : undefined,
    provider: supply.provider,
    altText: request.alt,
    tags: [request.slot, request.type],
    createdAt: supply.retrievedAt,
    generationVersion: 1,
  };
}

function unfilled(projectId: string, request: AssetRequest): Asset {
  return {
    id: randomUUID(),
    projectId,
    type: request.type,
    source: "placeholder",
    status: "failed",
    url: "",
    quality: request.quality,
    prompt: request.spec ? fingerprint(request.spec) : undefined,
    altText: request.alt,
    tags: [request.slot, request.type],
    createdAt: new Date().toISOString(),
  };
}

/**
 * The manifest, written for the code generator to read.
 *
 * Flat and boring on purpose. This is the only thing the generating model is
 * told about imagery, and every decision behind it — what was needed, where it
 * came from, what it cost, what to do when nothing answered — has been made.
 *
 * No key, no URL template and no provider name appears here. The generated
 * project receives an address and nothing else.
 */
export function manifestForPrompt(manifest: AssetManifest): string {
  const lines = Object.entries(manifest.assets).map(([slot, url]) => {
    if (url) return `- ${slot}: ${url}   (alt: ${manifest.alt[slot] ?? ""})`;
    if (manifest.drawn.includes(slot)) {
      return `- ${slot}: DRAW THIS YOURSELF in inline SVG or CSS — a mark, a monogram, an icon. It was never a photograph`;
    }
    return `- ${slot}: NOT AVAILABLE — lay it out as a plain toned panel at the right aspect ratio, never an <img> and never a drawing of the subject`;
  });

  return `THE ASSETS FOR THIS BUILD — use these exact URLs and no others. Do not invent an image address:

VISUAL DIRECTION (every picture here was chosen to it, so write the design to match):
- Register: ${manifest.direction.register}
- Palette: ${manifest.direction.palette}
- Lighting: ${manifest.direction.lighting}
- Mood: ${manifest.direction.mood}

SLOTS:
${lines.join("\n")}

- Reference a slot by its URL exactly as written, in an <img> with the alt text given, width and height set, loading="lazy" below the fold, and object-fit: cover.
- ${manifest.drawn.length > 0 ? `Draw these yourself, as you would any icon or logo: ${manifest.drawn.join(", ")}.` : "Nothing here is left for you to draw."}
- ${
    manifest.unresolved.length > 0
      ? `These slots have no picture: ${manifest.unresolved.join(", ")}. Lay them out as toned panels holding their aspect ratio — never a broken <img>, and never an SVG drawing of what the photograph would have shown. Do not mention that an image is missing anywhere in the copy.`
      : "Every slot has a picture."
  }`;
}
