"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import { formatCredits, signupBalance, totalCredits, type CreditBalance } from "./credits";

/* The credit figure in the header.
 *
 * It used to be a module constant — formatCredits(totalCredits(signupBalance()))
 * — evaluated once at import and identical for every account, so it never moved
 * no matter what was spent. This reads the account's own row.
 *
 * credit_balances is owner-scoped by RLS and readable but not writable by the
 * client, which is exactly the shape this needs: the number can be shown, and
 * only spend_credits can change it.
 *
 * The signup balance stays as the value shown while the read is in flight, so
 * the header does not flash a zero at someone who has credits. */

export type CreditsState = {
  /** Already formatted for display. */
  label: string;
  balance: CreditBalance;
  loading: boolean;
  /** Re-reads the balance — call after anything that spends. */
  refresh: () => Promise<void>;
};

export function useCredits(): CreditsState {
  const [balance, setBalance] = useState<CreditBalance>(signupBalance);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    const { data, error } = await createSupabaseBrowserClient()
      .from("credit_balances")
      .select("daily, rollover, monthly, top_up")
      .maybeSingle();

    setLoading(false);

    /* No row yet, or the read failed: keep whatever is on screen rather than
       showing a zero balance to someone whose account simply has not opened
       its balance yet. handle_new_user creates it at signup. */
    if (error || !data) return;

    setBalance({
      daily: Number(data.daily ?? 0),
      rollover: Number(data.rollover ?? 0),
      monthly: Number(data.monthly ?? 0),
      topUp: Number(data.top_up ?? 0),
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { label: formatCredits(totalCredits(balance)), balance, loading, refresh };
}
