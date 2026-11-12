/* The final cut, made on this server (lib/video/compose-local.ts).
 *
 * Called by the production line (production.ts) once a version's last clip
 * has landed and there is no FAL_KEY. It runs in an invocation of its own, so
 * joining the scenes has its full time budget rather than what is left of the
 * callback that noticed. The address carries an HMAC token for this video,
 * version and job; nothing else can start it. */

import { NextResponse, after } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { composeLocally, verifyComposeJob } from "@/lib/video/compose-local";
import { verifyFalToken } from "@/lib/video/fal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const version = Number(params.get("v"));
  /* A long film is cut in parts, each its own call, then joined (chapters.ts). */
  const rawPart = params.get("part");
  const part = rawPart === "join" ? "join" : rawPart && /^\d{1,3}$/.test(rawPart) ? Number(rawPart) : undefined;
  const allowed =
    Number.isInteger(version) &&
    version >= 1 &&
    (part === undefined ? verifyFalToken(id, version, "compose-local", params.get("t")) : verifyComposeJob(id, version, part, params.get("t")));
  if (!allowed) return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "No service key." }, { status: 503 });
  after(() => composeLocally(service, id, version, new URL(request.url).origin, part));
  return NextResponse.json({ ok: true }, { status: 202 });
}
