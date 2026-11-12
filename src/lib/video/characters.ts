/* Characters on the server: their reference pictures, made once and read
 * back for every scene that shows them.
 *
 *   castPictures    each character's pictures as short-lived links, read from
 *                   video_characters for the video's OWNER only — a plan can
 *                   name a character id, but never where its pictures are
 *   makeSheet       the reference sheet, made once when the character is
 *                   created: a front portrait (from words, or the person's
 *                   own photo), then the three-quarter and full-body views
 *                   made FROM that portrait so the face is the same in all
 *
 * Server-only. */

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { SHEET_VIEWS, runwareSheetImage } from "@/lib/runware";

export type CharacterRow = {
  id: string;
  user_id: string;
  name: string;
  descriptor: string;
  reference_paths: string[];
  voice_id: string | null;
  source: "generated" | "photo";
  status: "making" | "ready" | "failed";
  error: string | null;
  created_at: string;
};

/** Each ready character's pictures, front first, as links good for an hour. */
export async function castPictures(service: SupabaseClient, ownerId: string, ids: string[]): Promise<Record<string, string[]>> {
  if (!ids.length) return {};
  const { data } = await service.from("video_characters").select("id, reference_paths, status").eq("user_id", ownerId).in("id", ids);
  const out: Record<string, string[]> = {};
  for (const row of data ?? []) {
    if (row.status !== "ready") continue;
    const links: string[] = [];
    for (const path of (row.reference_paths as string[]) ?? []) {
      const { data: signed } = await service.storage.from("video-assets").createSignedUrl(path, 60 * 60);
      if (signed?.signedUrl) links.push(signed.signedUrl);
    }
    if (links.length) out[row.id as string] = links;
  }
  return out;
}

export const characterFolder = (userId: string, characterId: string) => `${userId}/characters/${characterId}`;

/**
 * Makes a character's reference sheet and stores it. With `photo` (the
 * person's own picture, bytes) that photo is the front view as it is; the
 * other views are made from it. Returns the stored paths and the USD spent,
 * or why it failed. Never throws.
 */
export async function makeSheet(
  service: SupabaseClient,
  input: { userId: string; characterId: string; descriptor: string; photo?: { bytes: Buffer; type: string } | null },
): Promise<{ ok: true; paths: string[]; usd: number } | { ok: false; error: string }> {
  const folder = characterFolder(input.userId, input.characterId);
  const paths: string[] = [];
  let usd = 0;
  const store = async (bytes: Buffer, type: string, name: string) => {
    const path = `${folder}/${name}-${randomUUID().slice(0, 8)}.${type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg"}`;
    const { error } = await service.storage.from("video-assets").upload(path, bytes, { contentType: type, upsert: true });
    if (error) throw new Error("A reference picture could not be stored.");
    paths.push(path);
    const { data } = await service.storage.from("video-assets").createSignedUrl(path, 60 * 60);
    if (!data?.signedUrl) throw new Error("A reference picture could not be read back.");
    return data.signedUrl;
  };
  try {
    let front: string;
    if (input.photo) {
      front = await store(input.photo.bytes, input.photo.type, "front");
    } else {
      const made = await runwareSheetImage({ view: SHEET_VIEWS[0], descriptor: input.descriptor });
      if (!made.ok) return made;
      usd += made.cost ?? 0.04;
      front = await store(made.image, "image/jpeg", "front");
    }
    for (const view of SHEET_VIEWS.slice(1)) {
      const made = await runwareSheetImage({ view, descriptor: input.descriptor, references: [front] });
      /* A view that will not come is left out: the front alone still locks the face. */
      if (!made.ok) continue;
      usd += made.cost ?? 0.04;
      await store(made.image, "image/jpeg", view.id);
    }
    return { ok: true, paths, usd };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The character could not be made." };
  }
}
