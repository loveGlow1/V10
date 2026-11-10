/* Where Runware reports a production-line job — a lip sync, a talking
 * portrait or the music (lib/video/production.ts).
 *
 * No session: Runware is calling. Two checks before anything is written:
 *
 *   1. the address carries our HMAC token for exactly this video, version
 *      and job (production.ts lineWebhookUrl);
 *   2. the row must still be waiting on a Runware task, and the result is
 *      then ASKED OF RUNWARE ITSELF (getResponse), never read off the body.
 *
 * Then line-results.ts lands it: stored, marked, charged once at what
 * Runware billed, and the line advanced. */

import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { parseJobKey, verifyFalToken } from "@/lib/video/fal";
import { settleRunwareLineJob } from "@/lib/video/line-results";
import { lineTaskOf } from "@/lib/video/production";

export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const version = Number(url.searchParams.get("v"));
  const key = url.searchParams.get("job");
  const job = parseJobKey(key);
  if (!job || job.engine === "compose" || !Number.isInteger(version) || !verifyFalToken(id, version, `line:${key ?? ""}`, url.searchParams.get("t"))) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });

  const query = service.from("video_renders").select("provider, status").eq("video_id", id).eq("version", version).eq("engine", job.engine);
  const { data: row } = await (job.scene === null ? query.is("scene", null) : query.eq("scene", job.scene)).maybeSingle();
  const taskUUID = lineTaskOf(row?.provider);
  /* Not waiting on this task any more: acknowledged, so Runware stops. */
  if (!row || row.status !== "running" || !taskUUID) return NextResponse.json({ ok: true, ignored: true });
  const body = (await request.json().catch(() => null)) as { data?: { taskUUID?: unknown }[]; taskUUID?: unknown } | null;
  const named = String(body?.taskUUID ?? body?.data?.[0]?.taskUUID ?? "");
  if (named && named !== taskUUID) return NextResponse.json({ ok: true, ignored: true });

  const result = await settleRunwareLineJob(service, { videoId: id, version, job, provider: row.provider, origin: url.origin });
  return NextResponse.json({ ok: true, ...(result === "running" ? { pending: true } : {}) });
}
