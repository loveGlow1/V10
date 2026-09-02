import type { Asset, AssetStatus } from "@/lib/builder/assets/asset-types";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Where an asset lives once it exists.
 *
 * Not in the LLM response, which is the point of this file. An image embedded
 * in generated markup is regenerated every time the page is, cannot be reused
 * by the next build, cannot be replaced without rewriting the page, and is
 * carried in full by every reader whether they look at it or not.
 *
 * So bytes go to object storage and the project keeps a record with a stable
 * id. The page references the id's URL, and everything downstream — reuse,
 * optimisation, a CDN, an asset manager somebody can open and look at — becomes
 * possible because there is something to point at.
 *
 * The bucket is public-read on purpose: these are pictures on a public website,
 * and signing every one of them would mean a page whose images expire. */

export const ASSET_BUCKET = "project-assets";

export type StoredAsset = { url: string; path: string };

/** Where one asset sits, which is also its identity in the bucket. */
export function assetPath(projectId: string, assetId: string, format: string): string {
  return `${projectId}/${assetId}.${format}`;
}

/**
 * Puts one asset in the bucket and answers with where it can be served from.
 *
 * Null rather than a throw when storage is not configured: a deployment without
 * a service key still builds pages, it just builds them without stored assets,
 * and that is a state the rest of the pipeline already copes with.
 */
export async function storeAsset(opts: {
  projectId: string;
  assetId: string;
  bytes: Buffer;
  contentType: string;
  format: string;
}): Promise<StoredAsset | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const path = assetPath(opts.projectId, opts.assetId, opts.format);

  const { error } = await supabase.storage.from(ASSET_BUCKET).upload(path, opts.bytes, {
    contentType: opts.contentType,
    upsert: true,
    /* A year: an asset is immutable once written. Replacing a picture writes a
       new id rather than overwriting one, so nothing downstream has to worry
       about a cached URL going stale. */
    cacheControl: "31536000",
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("assets: could not store", path, error.message);
    return null;
  }

  const { data } = supabase.storage.from(ASSET_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/** Records the asset against the project. Metadata is what makes reuse work. */
export async function recordAsset(asset: Asset): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return false;

  const { error } = await supabase.from("project_assets").upsert({
    id: asset.id,
    project_id: asset.projectId,
    type: asset.type,
    source: asset.source,
    status: asset.status,
    url: asset.url,
    thumbnail_url: asset.thumbnailUrl ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    format: asset.format ?? null,
    quality: asset.quality,
    prompt: asset.prompt ?? null,
    provider: asset.provider ?? null,
    alt_text: asset.altText ?? null,
    tags: asset.tags ?? null,
    parent_asset_id: asset.parentAssetId ?? null,
    generation_version: asset.generationVersion ?? null,
    created_at: asset.createdAt,
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("assets: could not record", asset.id, error.message);
    return false;
  }
  return true;
}

/** Everything this project holds. The library reads reuse out of this. */
export async function loadAssets(projectId: string): Promise<Asset[]> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("project_assets")
    .select(
      "id, project_id, type, source, status, url, thumbnail_url, width, height, format, quality, prompt, provider, alt_text, tags, parent_asset_id, generation_version, created_at",
    )
    .eq("project_id", projectId);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    projectId: row.project_id as string,
    type: row.type as Asset["type"],
    source: row.source as Asset["source"],
    status: row.status as AssetStatus,
    url: (row.url as string) ?? "",
    thumbnailUrl: (row.thumbnail_url as string) ?? undefined,
    width: (row.width as number) ?? undefined,
    height: (row.height as number) ?? undefined,
    format: (row.format as Asset["format"]) ?? undefined,
    quality: row.quality as Asset["quality"],
    prompt: (row.prompt as string) ?? undefined,
    provider: (row.provider as string) ?? undefined,
    altText: (row.alt_text as string) ?? undefined,
    tags: (row.tags as string[]) ?? undefined,
    parentAssetId: (row.parent_asset_id as string) ?? undefined,
    generationVersion: (row.generation_version as number) ?? undefined,
    createdAt: row.created_at as string,
  }));
}
