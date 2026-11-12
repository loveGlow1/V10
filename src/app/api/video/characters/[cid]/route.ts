/* One character.
 *
 *   PATCH { name?, descriptor?, voiceId? }   rename, re-describe, or give a voice
 *   DELETE                                   remove it and its pictures (videos
 *                                            already made keep their scenes) */

import { NextResponse } from "next/server";

import { isVoiceId } from "@/lib/video/voices";

import { videoSession } from "../../shared";

export async function PATCH(request: Request, context: { params: Promise<{ cid: string }> }) {
  const { cid } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 60);
  if (typeof body.descriptor === "string" && body.descriptor.trim().length >= 12) patch.descriptor = body.descriptor.trim().replace(/\s+/g, " ").slice(0, 600);
  if (body.voiceId === null || isVoiceId(body.voiceId)) patch.voice_id = body.voiceId;
  const { error } = await supabase.from("video_characters").update(patch).eq("id", cid).eq("user_id", userId);
  if (error) return NextResponse.json({ error: "The character could not be saved." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ cid: string }> }) {
  const { cid } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;
  const { data: row } = await supabase.from("video_characters").select("reference_paths").eq("id", cid).eq("user_id", userId).maybeSingle();
  if (!row) return NextResponse.json({ error: "No such character." }, { status: 404 });
  if ((row.reference_paths as string[])?.length) await supabase.storage.from("video-assets").remove(row.reference_paths as string[]);
  await supabase.from("video_characters").delete().eq("id", cid).eq("user_id", userId);
  return NextResponse.json({ ok: true });
}
