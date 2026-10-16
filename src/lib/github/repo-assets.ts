/* A repository's pictures, where a preview can show them.
 *
 * A project carries text; a repository also carries its logo, its photos, its
 * favicon. Those are left out of the project (they are binaries) and left
 * alone in the repository (see isProjectSource in push.ts) — but a page that
 * says <img src="/logo.png"> still has to show a logo. So on an import and on
 * every sync they are copied into the public project-assets bucket and recorded
 * against the project with the repository path they came from; the preview
 * swaps each path for its address (see the asset map in preview/). */

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { storeAsset } from "@/lib/builder/assets/asset-storage";

/* The same picture at the same path is the same row, so a re-sync replaces
   rather than duplicates. */
function assetIdFor(projectId: string, path: string): string {
  const hex = createHash("sha1").update(`${projectId}:${path}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Stores the pictures and records them. Returns how many were stored. Best effort: a picture that will not store is skipped. */
export async function storeRepoPictures(
  service: SupabaseClient,
  projectId: string,
  pictures: { path: string; bytes: Buffer; mime: string }[],
): Promise<number> {
  let stored = 0;
  for (const picture of pictures) {
    const id = assetIdFor(projectId, picture.path);
    const format = picture.path.split(".").pop()!.toLowerCase();
    const saved = await storeAsset({ projectId, assetId: id, bytes: picture.bytes, contentType: picture.mime, format });
    if (!saved) continue;
    const { error } = await service.from("project_assets").upsert({
      id,
      project_id: projectId,
      type: "image",
      source: "github",
      status: "ready",
      url: saved.url,
      format,
      content_key: `repo:${picture.path}`,
    });
    if (!error) stored += 1;
  }
  return stored;
}

/** The project's repository pictures as `repository path → public address`. */
export async function repoAssetMap(client: SupabaseClient, projectId: string): Promise<Record<string, string>> {
  const { data } = await client
    .from("project_assets")
    .select("content_key, url")
    .eq("project_id", projectId)
    .eq("source", "github");
  const map: Record<string, string> = {};
  for (const row of (data ?? []) as { content_key: string | null; url: string }[]) {
    if (row.content_key?.startsWith("repo:") && row.url) map[row.content_key.slice(5)] = row.url;
  }
  return map;
}
