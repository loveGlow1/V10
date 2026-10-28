import { NextResponse } from "next/server";

import { TOP_UP_NEEDS_PLAN_MESSAGE, mayTopUp } from "@/lib/top-up-access";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* GET { allowed, reason } — whether this account may add credit by hand, so
 * the billing sheet can say so before anyone picks an amount. The payment
 * routes ask the same question themselves; see lib/top-up-access.ts. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const allowed = await mayTopUp(createSupabaseServiceClient(), user.id);
  return NextResponse.json({ allowed, reason: allowed ? null : TOP_UP_NEEDS_PLAN_MESSAGE });
}
