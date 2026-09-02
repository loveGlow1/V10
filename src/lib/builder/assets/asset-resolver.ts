import { randomUUID } from "node:crypto";

import { fingerprint, reusable, uploaded, type Library } from "@/lib/builder/assets/asset-library";
import { generateWithFallback, type ImageProvider } from "@/lib/builder/assets/asset-generator";
import { thumbnail } from "@/lib/builder/assets/asset-optimizer";
import { storeAsset } from "@/lib/builder/assets/asset-storage";
import {
  isPhoto,
  type Asset,
  type AssetManifest,
  type AssetRequest,
} from "@/lib/builder/assets/asset-types";
import type { AssetPlan } from "@/lib/builder/assets/asset-planner";

/* Turning a plan into a manifest: for each slot, the best asset actually
 * available, in a fixed order of preference.
 *
 *   1. Something the user uploaded. Their logo is their logo, and nothing here
 *      may ever redraw it or replace their product photograph with a better
 *      one somebody else took.
 *   2. Something this project already made. Cheaper, faster, and the reason two
 *      builds of the same page look like the same page.
 *   3. Something generated or sourced now.
 *   4. A placeholder — and only here, at the end, having tried everything.
 *
 * The order is the whole value. Any single step of it is obvious; what is not
 * obvious, and what a code model gets wrong every time, is that these are
 * ranked rather than alternatives, and that the last one is a failure state
 * rather than a design choice.
 *
 * Nothing here throws. A project with no provider, no storage and no uploads
 * still resolves — every slot to a placeholder — because the alternative is a
 * build that fails over a picture. */

export type ResolveResult = {
  manifest: AssetManifest;
  /** Everything created along the way, for recording against the project. */
  created: Asset[];
  used: { user: number; reused: number; made: number; placeholder: number };
};

export async function resolveAssets(opts: {
  projectId: string;
  plan: AssetPlan;
  library: Library;
  providers: ImageProvider[];
  /** Off by default: storing is the caller's decision and needs a service key. */
  store?: boolean;
}): Promise<ResolveResult> {
  const { projectId, plan, library, providers } = opts;

  const assets: Record<string, string> = {};
  const alt: Record<string, string> = {};
  const unresolved: string[] = [];
  const created: Asset[] = [];
  const used = { user: 0, reused: 0, made: 0, placeholder: 0 };

  for (const request of plan.requests) {
    alt[request.slot] = request.alt;

    /* Drawn assets never reach a provider. A logo, an icon or an avatar is made
       by the code generator, and the manifest says so rather than pointing at a
       picture of one. */
    if (!isPhoto(request.type)) {
      const own = uploaded(library, request);
      if (own) {
        assets[request.slot] = own.url;
        used.user += 1;
      } else {
        assets[request.slot] = "";
        unresolved.push(request.slot);
      }
      continue;
    }

    // 1 — the user's own
    const theirs = uploaded(library, request);
    if (theirs) {
      assets[request.slot] = theirs.url;
      used.user += 1;
      continue;
    }

    // 2 — something this project already has
    const existing = reusable(library, request);
    if (existing) {
      assets[request.slot] = existing.url;
      used.reused += 1;
      continue;
    }

    // 3 — made now
    const made = await make(projectId, request, providers, opts.store === true);
    if (made) {
      assets[request.slot] = made.url;
      created.push(made);
      library.assets.push(made);
      used.made += 1;
      continue;
    }

    // 4 — nothing worked
    assets[request.slot] = "";
    unresolved.push(request.slot);
    used.placeholder += 1;
    created.push(failedAsset(projectId, request));
  }

  return {
    manifest: { projectId, kind: plan.kind, direction: plan.direction, assets, alt, unresolved },
    created,
    used,
  };
}

async function make(
  projectId: string,
  request: AssetRequest,
  providers: ImageProvider[],
  store: boolean,
): Promise<Asset | null> {
  if (!request.spec || providers.length === 0) return null;

  const job = await generateWithFallback(providers, request.spec, request.quality);
  if (job.status !== "ready" || !job.image) return null;

  const id = randomUUID();
  const format = job.image.contentType.includes("png") ? "png" : "jpeg";

  /* Stored where it can be served from, or carried inline when there is nowhere
     to store it. Inline is the lesser answer — it is regenerated with the page
     and cannot be reused — and it is still better than no picture. */
  let url: string;
  if (store) {
    const stored = await storeAsset({
      projectId,
      assetId: id,
      bytes: job.image.bytes,
      contentType: job.image.contentType,
      format,
    });
    if (!stored) return null;
    url = stored.url;
  } else {
    url = `data:${job.image.contentType};base64,${job.image.bytes.toString("base64")}`;
  }

  return {
    id,
    projectId,
    type: request.type,
    source: providers[0]?.kind === "library" ? "external" : "generated",
    status: "ready",
    url,
    thumbnailUrl: url.startsWith("data:") ? undefined : thumbnail(url),
    width: job.image.width,
    height: job.image.height,
    format: format === "png" ? "png" : "jpeg",
    quality: request.quality,
    /* The fingerprint rather than the sentence: it is what reuse looks itself
       up by, and it is stable where a prompt's wording is not. */
    prompt: fingerprint(request.spec),
    provider: job.image.provider,
    altText: request.alt,
    tags: [request.slot, request.type],
    createdAt: new Date().toISOString(),
    generationVersion: 1,
  };
}

function failedAsset(projectId: string, request: AssetRequest): Asset {
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
 * came from, what it cost, what to do when it failed — has already been made.
 */
export function manifestForPrompt(manifest: AssetManifest): string {
  const lines = Object.entries(manifest.assets).map(([slot, url]) =>
    url
      ? `- ${slot}: ${url}   (alt: ${manifest.alt[slot] ?? ""})`
      : `- ${slot}: NOT AVAILABLE — draw a plain toned panel at the right aspect ratio, never an <img> and never a drawing of the subject`,
  );

  return `THE ASSETS FOR THIS BUILD — use these exact URLs and no others. Do not invent an image address, and do not draw a photograph you were not given:

VISUAL DIRECTION (every picture on this page was made to it, so write the design to match):
- Register: ${manifest.direction.register}
- Palette: ${manifest.direction.palette}
- Lighting: ${manifest.direction.lighting}
- Mood: ${manifest.direction.mood}

SLOTS:
${lines.join("\n")}

- Reference a slot by its URL exactly as written, in an <img> with the alt text given, width and height set, loading="lazy" below the fold, and object-fit: cover.
- ${manifest.unresolved.length > 0 ? `These slots have no picture: ${manifest.unresolved.join(", ")}. Lay them out as toned panels holding their aspect ratio — never a broken <img>, and never an SVG drawing of what the photograph would have shown.` : "Every slot has a picture."}`;
}
