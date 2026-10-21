import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/* No card, no service — for an account that has never paid.
 *
 * public.card_required() in supabase/schema.sql decides: an account with an
 * unexpired card on file, on a paid plan, or that has ever paid (card or
 * crypto) may work; anyone else — a new account, or one from before the rule
 * still holding the free credit it was handed at signup — must save a card
 * first (Stripe setup mode, never charged; see src/lib/stripe-card.ts).
 *
 * Asked before work starts, in every route that spends credits. A database
 * error lets the request through and is logged: a hiccup reading this must not
 * shut every account out. */

export const CARD_REQUIRED_CODE = "card_required";
export const CARD_REQUIRED_MESSAGE =
  "Add a card to keep using QuickStark. You won't be charged — your bank just confirms the card is real.";

export async function cardRequired(service: SupabaseClient, userId: string): Promise<boolean> {
  /* No Stripe on this deployment means no way to add a card: nobody is
     held to a rule they could not meet. */
  if (!process.env.STRIPE_SECRET_KEY) return false;
  const { data, error } = await service.rpc("card_required", { p_user_id: userId });
  if (error) {
    // eslint-disable-next-line no-console
    console.error("card gate: could not read whether a card is required:", error.message);
    return false;
  }
  return data === true;
}

/** A 402 for an account that must add a card first, or null to carry on. */
export async function refuseWithoutCard(service: SupabaseClient | null, userId: string): Promise<NextResponse | null> {
  if (!service || !(await cardRequired(service, userId))) return null;
  return NextResponse.json({ error: CARD_REQUIRED_MESSAGE, code: CARD_REQUIRED_CODE, cardRequired: true }, { status: 402 });
}
