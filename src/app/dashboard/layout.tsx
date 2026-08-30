import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase-server';
import { ThemeProvider } from './components/ThemeProvider';
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

  return (
    <ThemeProvider>
    {/* Above every dashboard screen, because the set of open workspaces has to
        survive moving between them: a tab strip that reset on navigation would
        be a list of one. */}
    <WorkspaceTabsProvider>
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-canvas text-ink">
      {/* The page stays nearly black so nothing competes with the composer; the
          existing blue is kept only as a faint wash rather than a backdrop.

          Dark only. On the light theme there is no dark ground for it to wash,
          and a blue haze over white is not the same idea in a lighter key — it
          is a different one. */}
      <div className="pointer-events-none fixed inset-0 -z-20 bg-gradient-to-b from-[#12203a]/40 via-[#0d0d0f] to-[#0d0d0f] [html[data-theme=light]_&]:hidden" />

      {children}
    </div>
    </WorkspaceTabsProvider>
    </ThemeProvider>
  );
}
