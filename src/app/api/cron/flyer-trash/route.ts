import { NextResponse } from "next/server";

import { purgeFlyerTrash } from "@/lib/flyers/trash";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Daily: fliers and images deleted more than TRASH_DAYS ago are removed for
   good — the files from storage, then the rows. See lib/flyers/trash.ts. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Same gate as the other crons: Vercel's scheduler sends
   `Authorization: Bearer $CRON_SECRET`, and without it set this refuses,
   because it deletes. */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "No service key." }, { status: 503 });
  try {
    return NextResponse.json(await purgeFlyerTrash(service));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Purge failed." }, { status: 500 });
  }
}
