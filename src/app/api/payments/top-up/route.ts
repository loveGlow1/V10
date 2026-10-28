import { NextResponse } from "next/server";

import { MIN_TOP_UP_USD, MONTHLY_TOP_UP_CAP_USD } from "@/lib/crypto-payments";
import { TOP_UP_NEEDS_PLAN_MESSAGE, mayTopUp, overCapMessage, topUpRoomUsd } from "@/lib/top-up-access";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* GET { allowed, reason, roomUsd, capUsd } — whether this account may add
 * credit by hand and how much more this month, so the billing sheet can say
 * so before anyone picks an amount. The payment routes ask the same
 * questions themselves; see lib/top-up-access.ts. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const service = createSupabaseServiceClient();
  const [hadPlan, roomUsd] = await Promise.all([mayTopUp(service, user.id), topUpRoomUsd(service, user.id)]);
  const allowed = hadPlan && roomUsd >= MIN_TOP_UP_USD;
  return NextResponse.json({
    allowed,
    reason: !hadPlan ? TOP_UP_NEEDS_PLAN_MESSAGE : allowed ? null : overCapMessage(roomUsd),
    roomUsd,
    capUsd: MONTHLY_TOP_UP_CAP_USD,
  });
}
