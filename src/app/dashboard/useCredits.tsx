"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";
import { formatCredits, totalCredits, type CreditBalance } from "./credits";

/* The credit figure in the header.
 *
 * It has been wrong twice, in opposite directions, and both times for the same
 * reason: it showed a number nobody had checked.
 *
 * First it was a module constant evaluated at import — the same figure for every
 * account, never moving whatever was spent. Then it read the account's own row,
 * but showed `signupBalance()` while that read was in flight, which meant every
 * load of the dashboard opened with a fabricated 15 and corrected itself a
 * moment later. Lowering the signup grant to five made that visible: people
 * watched their balance apparently drop by ten every time the page loaded.
 *
 * So the balance is read on the server now, in the dashboard layout, and handed
 * to this provider as the value it starts with. It is in the HTML — correct at
 * first paint, with no fetch to wait for and nothing to correct afterwards.
 * There is no placeholder figure anywhere in this file, and there should never
 * be one again: when the balance genuinely is not known, the header says so
 * with a dash rather than guessing.
 *
 * One provider rather than a hook per consumer, because the header and the
 * workspace both want the same number and two independent reads would be two
 * chances to disagree. */

export type CreditsState = {
  /** Already formatted for display, or UNKNOWN when there is nothing to show. */
  label: string;
  /** Null only when the balance could not be read. */
  balance: CreditBalance | null;
  loading: boolean;
  /** Re-reads the balance — call after anything that spends. */
  refresh: () => Promise<void>;
};

/* An em dash, not a zero and not a guess. "We do not know yet" and "you have
   nothing" are different things and must not look alike. */
const UNKNOWN = "—";

const CreditsContext = createContext<CreditsState | null>(null);

export function CreditsProvider({
  initial,
  children,
}: {
  /** What the server read for this account, or null if it could not. */
  initial: CreditBalance | null;
  children: ReactNode;
}) {
  const [balance, setBalance] = useState<CreditBalance | null>(initial);
  const [loading, setLoading] = useState(initial === null);

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

    /* The read failed, or there is no row yet. Whatever is on screen stays:
       replacing a known balance with a dash because one refresh was refused
       would be a worse answer than the one already there. */
    if (error || !data) return;

    setBalance({
      daily: Number(data.daily ?? 0),
      rollover: Number(data.rollover ?? 0),
      monthly: Number(data.monthly ?? 0),
      topUp: Number(data.top_up ?? 0),
    });
  }, []);

  /* Only when the server could not supply one. A seeded balance was read a
     moment ago as part of this very page — fetching it again would cost a round
     trip to confirm what is already on screen. */
  useEffect(() => {
    if (initial === null) void refresh();
  }, [initial, refresh]);

  const value: CreditsState = {
    label: balance ? formatCredits(totalCredits(balance)) : UNKNOWN,
    balance,
    loading,
    refresh,
  };

  return <CreditsContext.Provider value={value}>{children}</CreditsContext.Provider>;
}

export function useCredits(): CreditsState {
  const state = useContext(CreditsContext);
  if (!state) {
    throw new Error("useCredits must be used inside the dashboard's CreditsProvider.");
  }
  return state;
}
