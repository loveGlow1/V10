import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/* Who may top up.
 *
 * Adding credit by hand is for accounts that have paid for a plan — Standard
 * or Pro, by card or crypto, at any time (public.paid_for_plan in
 * supabase/schema.sql). Everyone else upgrades first. The smallest top-up is
 * $15 (MIN_TOP_UP_USD in lib/crypto-payments.ts).
 *
 * Asked by every route that sells a top-up. A database error answers no:
 * selling credit on a guess is the direction that cannot be taken back. */

export const TOP_UP_NEEDS_PLAN_CODE = "top_up_needs_plan";
export const TOP_UP_NEEDS_PLAN_MESSAGE = "Top-ups open once you've had a paid plan. Upgrade to Standard or Pro to keep building.";

export async function mayTopUp(service: SupabaseClient | null, userId: string): Promise<boolean> {
  if (!service) return false;
  const { data, error } = await service.rpc("paid_for_plan", { p_user_id: userId });
  if (error) {
    // eslint-disable-next-line no-console
    console.error("top-up: could not read whether the account has had a plan:", error.message);
    return false;
  }
  return data === true;
}

/** A 403 for an account that may not top up yet, or null to carry on. */
export async function refuseTopUpWithoutPlan(service: SupabaseClient | null, userId: string): Promise<NextResponse | null> {
  if (await mayTopUp(service, userId)) return null;
  return NextResponse.json({ error: TOP_UP_NEEDS_PLAN_MESSAGE, code: TOP_UP_NEEDS_PLAN_CODE }, { status: 403 });
}
