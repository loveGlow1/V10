import { NextResponse } from "next/server";

import { refreshFxRates } from "@/lib/money";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* Daily: today's exchange rates into fx_rates, so a payment in naira, cedis,
   rand or euros is valued in dollars at its day's rate — see lib/money.ts. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Same gate as the other crons: Vercel's scheduler sends
   `Authorization: Bearer $CRON_SECRET`, and without it set this refuses. */
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
    return NextResponse.json({ currencies: await refreshFxRates(service) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Refresh failed." }, { status: 502 });
  }
}
