/* The Director's chat for one video, in sessions (video_messages).
 *
 *   GET    every message, oldest first, and the sessions with their first line
 *   POST   { role, text, session, version?, failed? } — one message, stored
 *          the moment it is sent
 *
 * Owner-only through RLS. */

import { NextResponse } from "next/server";

import { videoSession } from "../../shared";

export type VideoMessage = {
  id: string;
  session: number;
  role: "user" | "director";
  text: string;
  version: number | null;
  failed: boolean;
  created_at: string;
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { data, error } = await session.supabase
    .from("video_messages")
    .select("id, session, role, text, version, failed, created_at")
    .eq("video_id", id)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) return NextResponse.json({ error: "Could not load the conversation." }, { status: 500 });
  return NextResponse.json({ messages: (data ?? []) as VideoMessage[] });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const body = (await request.json().catch(() => null)) as Partial<VideoMessage> | null;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 8000) : "";
  const role = body?.role === "director" ? "director" : "user";
  const number = Math.max(1, Math.floor(Number(body?.session) || 1));
  if (!text) return NextResponse.json({ error: "Nothing to keep." }, { status: 400 });
  const { data, error } = await session.supabase
    .from("video_messages")
    .insert({
      video_id: id,
      user_id: session.userId,
      session: number,
      role,
      text,
      version: Number.isInteger(body?.version) ? body?.version : null,
      failed: body?.failed === true,
    })
    .select("id, session, role, text, version, failed, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "Could not keep the message." }, { status: 500 });
  return NextResponse.json({ message: data as VideoMessage });
}
