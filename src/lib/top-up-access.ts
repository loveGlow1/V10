import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { MONTHLY_TOP_UP_CAP_USD } from "@/lib/crypto-payments";

/* Who may top up, and how much.
 *
 * Adding credit by hand is for accounts that have paid for a plan — Standard
 * or Pro, by card or crypto, at any time (public.paid_for_plan in
 * supabase/schema.sql). Everyone else upgrades first. A top-up is $15 to
 * $10,000, and an account adds no more than $10,000 in a calendar month
 * (top_up_room_usd; MONTHLY_TOP_UP_CAP_USD in lib/crypto-payments.ts).
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

export const TOP_UP_OVER_CAP_CODE = "top_up_over_cap";

/** Dollars the account may still top up this calendar month. A failed read
 *  answers none. */
export async function topUpRoomUsd(service: SupabaseClient | null, userId: string): Promise<number> {
  if (!service) return 0;
  const { data, error } = await service.rpc("top_up_room_usd", { p_user_id: userId });
  if (error) {
    // eslint-disable-next-line no-console
    console.error("top-up: could not read this month's top-up room:", error.message);
    return 0;
  }
  const room = Number(data);
  return Number.isFinite(room) ? Math.max(0, Math.floor(room)) : 0;
}

export function overCapMessage(room: number): string {
  const cap = MONTHLY_TOP_UP_CAP_USD.toLocaleString("en-US");
  return room > 0
    ? `You can add up to $${room.toLocaleString("en-US")} more this month — top-ups are limited to $${cap} a month.`
    : `You've reached this month's top-up limit of $${cap}. It resets on the 1st, or upgrade your plan.`;
}

/** A 403 for a top-up of `usd` this account may not buy — no plan yet, or
 *  past this month's limit counting `pendingUsd` of checkouts it has open —
 *  or null to carry on. */
export async function refuseTopUp(
  service: SupabaseClient | null,
  userId: string,
  usd: number,
  pendingUsd = 0,
): Promise<NextResponse | null> {
  if (!(await mayTopUp(service, userId))) {
    return NextResponse.json({ error: TOP_UP_NEEDS_PLAN_MESSAGE, code: TOP_UP_NEEDS_PLAN_CODE }, { status: 403 });
  }
  const room = Math.max(0, (await topUpRoomUsd(service, userId)) - Math.ceil(pendingUsd));
  if (usd > room) return NextResponse.json({ error: overCapMessage(room), code: TOP_UP_OVER_CAP_CODE, roomUsd: room }, { status: 403 });
  return null;
}
