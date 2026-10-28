import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripeSecretKey } from "@/lib/stripe-key";

/* No card, no service — unless the account has paid.
 *
 * public.card_status() in supabase/schema.sql decides, the way emergent.sh
 * does it:
 *   ok        an unexpired card is on file, or a crypto payment in the last
 *             8 days.
 *   suggest   no card, but the account paid by card before, or in crypto 8
 *             to 15 days ago: asked to add one, keeps working.
 *   required  everyone else — new accounts, cards taken off without ever
 *             paying, crypto payers past 15 days — must save a card first
 *             (see src/lib/stripe-card.ts; a new account's card starts a free
 *             month of a plan, lib/stripe-plan.ts).
 *
 * Asked before work starts, in every route that spends credits. A database
 * error lets the request through and is logged: a hiccup reading this must not
 * shut every account out. */

export const CARD_REQUIRED_CODE = "card_required";
export const CARD_REQUIRED_MESSAGE =
  "Add a card to keep using QuickStark. Nothing is charged today — your bank just confirms the card is real.";

export type CardStatus = "ok" | "suggest" | "required";

export async function cardStatusOf(service: SupabaseClient, userId: string): Promise<CardStatus> {
  /* No Stripe on this deployment means no way to add a card: nobody is
     held to a rule they could not meet. */
  if (!stripeSecretKey()) return "ok";
  const { data, error } = await service.rpc("card_status", { p_user_id: userId });
  if (error) {
    // eslint-disable-next-line no-console
    console.error("card gate: could not read whether a card is required:", error.message);
    return "ok";
  }
  return data === "required" || data === "suggest" ? data : "ok";
}

export async function cardRequired(service: SupabaseClient, userId: string): Promise<boolean> {
  return (await cardStatusOf(service, userId)) === "required";
}

/** A 402 for an account that must add a card first, or null to carry on. */
export async function refuseWithoutCard(service: SupabaseClient | null, userId: string): Promise<NextResponse | null> {
  if (!service || !(await cardRequired(service, userId))) return null;
  return NextResponse.json({ error: CARD_REQUIRED_MESSAGE, code: CARD_REQUIRED_CODE, cardRequired: true }, { status: 402 });
}
