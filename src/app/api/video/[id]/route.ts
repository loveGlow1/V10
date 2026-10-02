/* One video: the project, its latest plan, every version, its references,
   and whether the engines its plan needs are connected. */

import { NextResponse } from "next/server";

import { readiness } from "@/lib/video/engines";
import type { ProductionPlan } from "@/lib/video/plan";

import { videoSession } from "../shared";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;

  const { data: video } = await session.supabase.from("video_projects").select("*").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });

  const [{ data: versions }, { data: assets }] = await Promise.all([
    session.supabase.from("video_versions").select("version, plan, issues, note, created_at").eq("video_id", id).order("version", { ascending: false }).limit(30),
    session.supabase.from("video_assets").select("id, kind, storage_path, mime").eq("video_id", id).order("created_at"),
  ]);

  const latest = versions?.[0] ?? null;
  return NextResponse.json({
    video,
    latest,
    versions: (versions ?? []).map(({ version, note, created_at }) => ({ version, note, created_at })),
    assets: assets ?? [],
    readiness: latest ? readiness(latest.plan as ProductionPlan) : null,
  });
}
