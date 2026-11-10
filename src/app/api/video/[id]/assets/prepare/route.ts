/* An upload's preparation (lib/video/prepare-asset.ts), in an invocation of
 * its own so a long clip has the whole time budget.
 *
 * Started by the register route (../route.ts) with an HMAC token for exactly
 * this video and upload; nothing else can start it. Answers at once and
 * works after the response. */

import { NextResponse, after } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { verifyFalToken } from "@/lib/video/fal";
import { prepareAsset } from "@/lib/video/prepare-asset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const assetId = new URL(request.url).searchParams.get("asset") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(assetId) || !verifyFalToken(id, 0, `asset:${assetId}`, new URL(request.url).searchParams.get("t"))) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "No service key." }, { status: 503 });
  const { data: asset } = await service.from("video_assets").select("id").eq("id", assetId).eq("video_id", id).maybeSingle();
  if (!asset) return NextResponse.json({ error: "No such upload." }, { status: 404 });
  after(() => prepareAsset(service, assetId));
  return NextResponse.json({ ok: true }, { status: 202 });
}
