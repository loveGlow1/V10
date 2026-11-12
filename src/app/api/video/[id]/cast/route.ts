/* Which characters a video uses.
 *
 *   POST { characterIds }   the video's cast, in order (at most four, ready
 *                           ones the owner has). Answers with the cast as the
 *                           plan holds it, for the studio to put in its draft;
 *                           the next plan, edit or save uses it. */

import { NextResponse } from "next/server";

import { MAX_CAST } from "@/lib/video/cast";
import { loadCast } from "@/lib/video/plan-video";

import { videoSession } from "../../shared";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;
  const body = ((await request.json().catch(() => null)) ?? {}) as { characterIds?: unknown };
  const asked = Array.isArray(body.characterIds) ? body.characterIds.filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) : [];
  const { data: video } = await supabase.from("video_projects").select("id").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });
  const cast = await loadCast(supabase, { user_id: userId, character_ids: [...new Set(asked)].slice(0, MAX_CAST) });
  const { error } = await supabase.from("video_projects").update({ character_ids: cast.map((c) => c.id) }).eq("id", id);
  if (error) return NextResponse.json({ error: "The cast could not be saved." }, { status: 500 });
  return NextResponse.json({ characters: cast });
}
