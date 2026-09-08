import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase-server';
import { ThemeProvider } from './components/ThemeProvider';
import { CreditsProvider } from './useCredits';
import { PLAN_ORDER, type CreditBalance, type PlanId } from './credits';
import { WorkspaceTabsProvider } from './WorkspaceTabsContext';

export const metadata: Metadata = {
  title: "QuickStark.Ai | Dashboard",
  description: "Where ideas become reality.",
};

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();

  // The imported shell carries no guard of its own, so the check stays here:
  // without it every dashboard route is public.
  if (!supabase) {
    redirect('/');
  }

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/');
  }

  /* The balance, read here so it is in the HTML rather than fetched after
     hydration. The header used to show a made-up figure while that fetch was in
     flight — the signup balance, which was 15 — and then correct itself, so
     every load flashed a number the account did not have. Read on the server it
     is right at first paint and there is nothing to correct.

     RLS answers this: the select runs under the person's own session, so it can
     only return their row. */
  const { data: balanceRow } = await supabase
    .from('credit_balances')
    .select('daily, rollover, monthly, top_up, plan_id')
    .maybeSingle();

  const balance: CreditBalance | null = balanceRow
    ? {
        daily: Number(balanceRow.daily ?? 0),
        rollover: Number(balanceRow.rollover ?? 0),
        monthly: Number(balanceRow.monthly ?? 0),
        topUp: Number(balanceRow.top_up ?? 0),
      }
    : null;

  /* Read here for the same reason the balance is: the model picker greys what
     the plan cannot reach, and a picker that renders every model unlocked and
     then corrects itself has already shown somebody a model they cannot use. */
  const planId: PlanId = PLAN_ORDER.find((id) => id === balanceRow?.plan_id) ?? 'free';

  return (
    <ThemeProvider>
    {/* Above every dashboard screen, because the set of open workspaces has to
        survive moving between them: a tab strip that reset on navigation would
        be a list of one. */}
    <WorkspaceTabsProvider>
    <CreditsProvider initial={balance} initialPlan={planId}>
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-canvas text-ink">
      {/* The page stays nearly black so nothing competes with the composer; the
          existing blue is kept only as a faint wash rather than a backdrop.

          Dark only. On the light theme there is no dark ground for it to wash,
          and a blue haze over white is not the same idea in a lighter key — it
          is a different one. */}
      <div className="pointer-events-none fixed inset-0 -z-20 bg-gradient-to-b from-[#12203a]/40 via-[#0d0d0f] to-[#0d0d0f] [html[data-theme=light]_&]:hidden" />

      {children}
    </div>
    </CreditsProvider>
    </WorkspaceTabsProvider>
    </ThemeProvider>
  );
}
