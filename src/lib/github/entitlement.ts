/* Pushing an app's code to GitHub is a paid-plan feature: Standard and Pro
 * both include it, Free does not. Connecting an account is open to everyone —
 * it is the push that is gated, and it is gated here on the server, because a
 * check the browser makes is a suggestion.
 *
 * Read off the same balance row every other entitlement reads, through
 * currentBalance, which treats anything it does not recognise as free. */

import type { SupabaseClient } from "@supabase/supabase-js";

import { currentBalance } from "@/lib/credits-server";

export const UPGRADE_FOR_GITHUB =
  "Saving your code to GitHub comes with Standard and Pro. Upgrade to push this app to a repository you own.";

export async function canPushToGitHub(service: SupabaseClient, userId: string): Promise<boolean> {
  const balance = await currentBalance(service, userId);
  return Boolean(balance && balance.planId !== "free");
}
