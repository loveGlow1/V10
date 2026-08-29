import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase-server';

export const metadata: Metadata = {
  title: "Quickstark.Ai | Dashboard",
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
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#0d0d0f] text-white">
      {/* The page stays nearly black so nothing competes with the composer; the
          existing blue is kept only as a faint wash rather than a backdrop. */}
      <div className="pointer-events-none fixed inset-0 -z-20 bg-gradient-to-b from-[#12203a]/40 via-[#0d0d0f] to-[#0d0d0f]" />

      {children}
    </div>
  );
}
