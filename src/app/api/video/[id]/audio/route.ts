/* Sound made on request in the editor — music and voice-over — saved as the
 * video's own audio, to use, swap, or make again.
 *
 *   POST { type: "music", prompt, seconds?, lyrics?, vocalLanguage? }
 *        ACE-Step 1.5 on Runware: an instrumental bed, or a sung song when
 *        lyrics are given. 30s at the least; the cut trims it.
 *   POST { type: "voice", text, voiceId, language? }
 *        one voice-over line in the voice chosen (voices.ts)
 *
 * Each result is a video_assets row (kind audio, source generated), charged
 * once when it arrives: music at what Runware billed (never more than 10%
 * over the quote), a voice line at the usual voice price. */

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { refuseWithoutCard } from "@/lib/card-gate";
import { chargeCredits, currentBalance } from "@/lib/credits-server";
import { runwareMusic } from "@/lib/runware";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { VOICE_COST, runwareJobCredits, settleRunwareCredits } from "@/lib/video/engines";
import { seconds as mediaLength } from "@/lib/video/probe";
import { speak } from "@/lib/video/providers";
import { isVoiceId, voiceLabel } from "@/lib/video/voices";

import { videoSession } from "../../shared";

export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;
  const service = createSupabaseServiceClient();
  const noCard = await refuseWithoutCard(service, userId);
  if (noCard) return noCard;

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const { data: video } = await supabase.from("video_projects").select("id, title, answers").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });

  let audio: Buffer;
  let cost: number;
  let name: string;
  if (body.type === "music") {
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1000) : "";
    if (prompt.length < 3) return NextResponse.json({ error: "Describe the music: a genre, a mood, the instruments." }, { status: 400 });
    const seconds = Math.min(300, Math.max(30, Math.round(Number(body.seconds) || 30)));
    const quote = runwareJobCredits("music", seconds);
    if (service && !(await covers(service, userId, quote))) return NextResponse.json({ error: `This needs ${quote} credit${quote === 1 ? "" : "s"}. Top up to make music.` }, { status: 402 });
    const made = await runwareMusic({
      prompt,
      seconds,
      lyrics: typeof body.lyrics === "string" ? body.lyrics : undefined,
      vocalLanguage: typeof body.vocalLanguage === "string" ? body.vocalLanguage : undefined,
    });
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: 502 });
    audio = made.audio;
    cost = settleRunwareCredits(quote, made.cost);
    name = `Music · ${prompt.slice(0, 60)}`;
  } else if (body.type === "voice") {
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 1500) : "";
    if (!text) return NextResponse.json({ error: "Write the line to be spoken." }, { status: 400 });
    if (!isVoiceId(body.voiceId)) return NextResponse.json({ error: "Choose a voice." }, { status: 400 });
    if (service && !(await covers(service, userId, VOICE_COST))) return NextResponse.json({ error: "Top up to make a voice-over." }, { status: 402 });
    const language = typeof body.language === "string" && /^[a-z]{2,4}$|^auto$/.test(body.language) ? body.language : "auto";
    const spoken = await speak({ text, voiceId: body.voiceId, language });
    if (!spoken.ok) return NextResponse.json({ error: spoken.error }, { status: 502 });
    audio = spoken.audio;
    cost = VOICE_COST;
    name = `Voice · ${voiceLabel(body.voiceId)} · ${text.slice(0, 50)}`;
  } else {
    return NextResponse.json({ error: "Ask for music or a voice-over." }, { status: 400 });
  }

  const writer = service ?? supabase;
  const path = `${userId}/${id}/uploads/gen-${randomUUID()}.mp3`;
  const { error: stored } = await writer.storage.from("video-assets").upload(path, audio, { contentType: "audio/mpeg", upsert: false });
  if (stored) return NextResponse.json({ error: "It was made but could not be saved. Nothing was charged — try again." }, { status: 500 });
  const durationS = mediaLength(new Uint8Array(audio));
  const { data: row, error } = await supabase
    .from("video_assets")
    .insert({ video_id: id, user_id: userId, kind: "audio", storage_path: path, mime: "audio/mpeg", name: name.slice(0, 200), source: "generated", status: "ready", size_bytes: audio.length, duration_s: durationS, has_audio: true })
    .select("id")
    .single();
  if (error || !row) return NextResponse.json({ error: "It was made but could not be saved. Nothing was charged — try again." }, { status: 500 });

  if (service) {
    await chargeCredits(service, { userId, action: "generate", cost, description: `${name.slice(0, 120)}: ${video.title}`, videoId: id, dedupeKey: `video-audio:${row.id}` });
  }
  const { data: signed } = await supabase.storage.from("video-assets").createSignedUrl(path, 60 * 60);
  return NextResponse.json({
    asset: { id: row.id, kind: "audio", name, mime: "audio/mpeg", status: "ready", durationS, width: null, height: null, hasAudio: true, url: signed?.signedUrl ?? null, posterUrl: null },
    charged: cost,
  });
}

async function covers(service: NonNullable<ReturnType<typeof createSupabaseServiceClient>>, userId: string, cost: number): Promise<boolean> {
  const balance = await currentBalance(service, userId);
  return !balance || balance.daily + balance.rollover + balance.monthly + balance.topUp >= cost;
}
