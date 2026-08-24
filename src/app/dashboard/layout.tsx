import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase-server';

export const metadata: Metadata = {
  title: "QuickStart.Ai | Dashboard",
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
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#060606] text-white">
      {/* Deep blue-to-black atmospheric background */}
      <div className="pointer-events-none fixed inset-0 -z-20 bg-gradient-to-b from-[#1E5FAF]/40 via-[#0d1a2e] to-[#060606]" />
      {/* Center glow */}
      <div className="pointer-events-none fixed left-1/2 top-1/4 -z-10 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[#2B6CB0]/20 blur-[140px]" />

      {children}
    </div>
  );
}
