/* A render's uploaded pieces: the person's own clips and pictures, and their
 * own music file, filed as finished rows of the version — nothing is made,
 * nothing is charged. The production line then treats them like any arrived
 * clip: lip sync where a scene speaks over it, and the final cut.
 *
 * Server-only. */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProductionPlan } from "./plan";

/** Files every upload the plan uses that the version has no row for yet. Returns how many. */
export async function fileUploads(
  supabase: SupabaseClient,
  input: { videoId: string; userId: string; version: number; plan: ProductionPlan },
): Promise<number> {
  const { videoId, userId, version, plan } = input;
  const ids = new Set(plan.scenes.flatMap((scene) => (scene.source ? [scene.source.assetId] : [])));
  const musicId = plan.cut?.music?.source === "upload" ? plan.cut.music.assetId : undefined;
  if (musicId) ids.add(musicId);
  if (!ids.size) return 0;

  const [{ data: assets }, { data: existing }] = await Promise.all([
    supabase.from("video_assets").select("id, storage_path, working_path, status").eq("video_id", videoId).in("id", [...ids]),
    supabase.from("video_renders").select("scene, engine, status").eq("video_id", videoId).eq("version", version),
  ]);
  const byId = new Map((assets ?? []).map((asset) => [asset.id as string, asset]));
  const has = (scene: number | null, engine: string) => (existing ?? []).some((row) => row.scene === scene && row.engine === engine && row.status !== "failed");
  const base = { video_id: videoId, user_id: userId, version };
  const rows: Record<string, unknown>[] = [];

  for (const scene of plan.scenes) {
    if (!scene.source || has(scene.n, "video")) continue;
    const asset = byId.get(scene.source.assetId);
    if (!asset || asset.status === "failed") {
      rows.push({ ...base, scene: scene.n, engine: "video", provider: `upload:${scene.source.assetId}`, status: "failed", error: "This scene's upload was removed or could not be read. Upload it again, or take the scene out." });
      continue;
    }
    rows.push({ ...base, scene: scene.n, engine: "video", provider: `upload:${asset.id}`, status: "done", output_path: `storage:${asset.working_path ?? asset.storage_path}` });
  }
  if (musicId && !has(null, "music")) {
    const asset = byId.get(musicId);
    if (asset && asset.status !== "failed") rows.push({ ...base, scene: null, engine: "music", provider: `upload:${asset.id}`, status: "done", output_path: `storage:${asset.storage_path}` });
  }
  if (!rows.length) return 0;
  /* Replaces a failed row for the same piece. */
  for (const row of rows) {
    const query = supabase.from("video_renders").delete().eq("video_id", videoId).eq("version", version).eq("engine", row.engine as string);
    await (row.scene === null ? query.is("scene", null) : query.eq("scene", row.scene as number));
  }
  const { error } = await supabase.from("video_renders").insert(rows);
  return error ? 0 : rows.filter((row) => row.status === "done").length;
}
