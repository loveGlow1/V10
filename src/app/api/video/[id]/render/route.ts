/* Step 5: generation. The router sends each scene of the chosen version to its
 * engine, plus voice and music, as rows in video_renders.
 *
 * Nothing is queued unless every engine the plan needs is connected (see
 * lib/video/engines.ts). A half-connected render would spend credits on
 * scenes that can never be put together, so the answer is the list of what is
 * missing instead. */

import { NextResponse } from "next/server";

import { enginesNeeded, readiness } from "@/lib/video/engines";
import type { ProductionPlan } from "@/lib/video/plan";

import { videoSession } from "../../shared";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await videoSession();
  if ("error" in session) return session.error;
  const { supabase, userId } = session;

  const { data: video } = await supabase.from("video_projects").select("id, current_version").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });
  const body = ((await request.json().catch(() => null)) ?? {}) as { version?: unknown };
  const version = Number.isInteger(body.version) ? (body.version as number) : video.current_version;

  const { data: row } = await supabase.from("video_versions").select("plan").eq("video_id", id).eq("version", version).maybeSingle();
  if (!row) return NextResponse.json({ error: "Plan the video first." }, { status: 400 });
  const plan = row.plan as ProductionPlan;

  const ready = readiness(plan);
  if (!ready.ready) {
    return NextResponse.json(
      {
        error: "Rendering isn't connected yet for this video.",
        missing: ready.engines.filter((entry) => entry.health !== "available"),
        readiness: ready,
      },
      { status: 409 },
    );
  }

  const rows = [
    ...plan.scenes.map((scene) => ({ video_id: id, user_id: userId, version, scene: scene.n, engine: scene.engine })),
    ...enginesNeeded(plan)
      .filter((engine) => engine === "voice" || engine === "music")
      .map((engine) => ({ video_id: id, user_id: userId, version, scene: null, engine })),
    { video_id: id, user_id: userId, version, scene: null, engine: "compose" },
  ];
  const { error } = await supabase.from("video_renders").insert(rows);
  if (error) return NextResponse.json({ error: "Could not queue the render." }, { status: 500 });
  await supabase.from("video_projects").update({ status: "rendering" }).eq("id", id);
  return NextResponse.json({ queued: rows.length, readiness: ready });
}
