/* A person's characters — reusable across all their videos.
 *
 *   GET                      every character, with a picture of each
 *   POST { name, descriptor, voiceId?, photo?: { videoId, assetId }, consent? }
 *        makes one: its reference sheet is made ONCE here (front,
 *        three-quarter, full body) and reused by every scene of every video
 *        it appears in. From a photo of a real person, the owner must
 *        confirm they have the right to that likeness; the confirmation is
 *        recorded. */

import { NextResponse } from "next/server";

import { refuseWithoutCard } from "@/lib/card-gate";
import { chargeCredits, currentBalance } from "@/lib/credits-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { makeSheet } from "@/lib/video/characters";
import { creditsForUsd } from "@/lib/video/engines";
import { isVoiceId } from "@/lib/video/voices";

import { videoSession } from "../shared";

export const maxDuration = 180;

/* Up to three pictures at Seedream's $0.04. */
const SHEET_QUOTE_USD = 0.12;

export async function GET() {
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;
  const { data } = await supabase
    .from("video_characters")
    .select("id, name, descriptor, voice_id, source, status, error, reference_paths, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(60);
  const characters = await Promise.all(
    (data ?? []).map(async (row) => {
      const pictures = await Promise.all(
        ((row.reference_paths as string[]) ?? []).map(async (path) => (await supabase.storage.from("video-assets").createSignedUrl(path, 60 * 60)).data?.signedUrl ?? null),
      );
      return { id: row.id, name: row.name, descriptor: row.descriptor, voiceId: row.voice_id, source: row.source, status: row.status, error: row.error, pictures: pictures.filter(Boolean) };
    }),
  );
  return NextResponse.json({ characters });
}

export async function POST(request: Request) {
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;
  const service = createSupabaseServiceClient();
  const noCard = await refuseWithoutCard(service, userId);
  if (noCard) return noCard;

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  const descriptor = typeof body.descriptor === "string" ? body.descriptor.trim().replace(/\s+/g, " ").slice(0, 600) : "";
  if (!name) return NextResponse.json({ error: "Give the character a name." }, { status: 400 });
  if (descriptor.length < 12) return NextResponse.json({ error: "Describe how they look: age, face, hair, and what they wear. The more exact, the more alike every scene is." }, { status: 400 });
  const voiceId = isVoiceId(body.voiceId) ? body.voiceId : null;

  /* A photograph of a person: theirs, or one they have the right to use. */
  let photo: { bytes: Buffer; type: string } | null = null;
  const fromPhoto = body.photo && typeof body.photo === "object" ? (body.photo as { videoId?: unknown; assetId?: unknown }) : null;
  if (fromPhoto) {
    if (body.consent !== true) return NextResponse.json({ error: "Confirm this is you, or that you have the right to use this person's likeness." }, { status: 400 });
    const { data: asset } = await supabase
      .from("video_assets")
      .select("storage_path, mime, kind")
      .eq("id", String(fromPhoto.assetId ?? ""))
      .eq("video_id", String(fromPhoto.videoId ?? ""))
      .maybeSingle();
    if (!asset || !String(asset.mime).startsWith("image/")) return NextResponse.json({ error: "Choose a picture you uploaded." }, { status: 400 });
    const { data: file } = await (service ?? supabase).storage.from("video-assets").download(asset.storage_path as string);
    if (!file) return NextResponse.json({ error: "That picture could not be read." }, { status: 400 });
    photo = { bytes: Buffer.from(await file.arrayBuffer()), type: String(asset.mime) };
  }

  const quote = creditsForUsd(SHEET_QUOTE_USD);
  if (service) {
    const balance = await currentBalance(service, userId);
    if (balance && balance.daily + balance.rollover + balance.monthly + balance.topUp < quote) return NextResponse.json({ error: "Top up to make a character." }, { status: 402 });
  }

  const { data: row, error } = await supabase
    .from("video_characters")
    .insert({ user_id: userId, name, descriptor, voice_id: voiceId, source: photo ? "photo" : "generated", consent_at: photo ? new Date().toISOString() : null, status: "making" })
    .select("id")
    .single();
  if (error || !row) return NextResponse.json({ error: "The character could not be saved." }, { status: 500 });

  const made = await makeSheet(service ?? supabase, { userId, characterId: row.id as string, descriptor: `${name}, ${descriptor}`, photo });
  if (!made.ok) {
    await supabase.from("video_characters").update({ status: "failed", error: made.error.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", row.id);
    return NextResponse.json({ error: `${made.error} Nothing was charged.`, id: row.id }, { status: 502 });
  }
  await supabase.from("video_characters").update({ status: "ready", error: null, reference_paths: made.paths, updated_at: new Date().toISOString() }).eq("id", row.id);
  const charged = made.usd > 0 ? Math.min(creditsForUsd(made.usd), Math.ceil(quote * 1.1)) : 0;
  if (service && charged) await chargeCredits(service, { userId, action: "generate", cost: charged, description: `Character: ${name}`, dedupeKey: `video-character:${row.id}` });
  return NextResponse.json({ id: row.id, pictures: made.paths.length, charged });
}
