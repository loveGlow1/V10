/* Where fal reports a finished job — lip sync, avatar, music or the final
 * compose (lib/video/fal.ts, production.ts).
 *
 * No session: fal is calling. The address carries an HMAC token for exactly
 * this video, version and job, and fal signs the request (Ed25519) as well;
 * a bad token, or a signature that is present and wrong, is refused. Then
 * line-results.ts lands it the way every production job lands: stored,
 * marked, charged once, and the line advanced. A finished compose finishes
 * the video. */

import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { COMPOSE_COST, productionJobCost } from "@/lib/video/engines";
import { outputUrl, parseJobKey, verifyFalSignature, verifyFalToken } from "@/lib/video/fal";
import { landLineJob } from "@/lib/video/line-results";

export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const version = Number(url.searchParams.get("v"));
  const key = url.searchParams.get("job");
  const job = parseJobKey(key);
  if (!job || !Number.isInteger(version) || !verifyFalToken(id, version, key ?? "", url.searchParams.get("t"))) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const raw = await request.text();
  if ((await verifyFalSignature(request.headers, raw)) === "invalid") {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }
  const body = (JSON.parse(raw || "{}") ?? {}) as { status?: string; payload?: unknown; error?: string; payload_error?: string };

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });
  const { data: video } = await service.from("video_projects").select("id, pipeline").eq("id", id).maybeSingle();
  if (!video) return NextResponse.json({ error: "No such video." }, { status: 404 });

  const media = body.status === "OK" ? outputUrl(body.payload) : null;
  const kind = job.engine === "music" ? "music" : video.pipeline === "clone" ? "avatar" : "lipsync";
  await landLineJob(service, {
    videoId: id,
    version,
    job,
    mediaUrl: media,
    error: media ? null : String(body.error ?? body.payload_error ?? "fal returned no media."),
    cost: job.engine === "compose" ? COMPOSE_COST : productionJobCost("fal", kind, 0),
    dedupeKey: `video-fal:${id}:${version}:${key}`,
    origin: url.origin,
  });
  return NextResponse.json({ ok: true });
}
