import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { SidebarNav } from '@/components/dashboard/sidebar-nav';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();

  // Redirect to landing page if Supabase is not configured or the visitor
  // is not authenticated.
  if (!supabase) {
    redirect('/');
  }

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/');
  }

  // The profile row is created by a trigger on sign-up (supabase/schema.sql).
  // It can still be missing — an account made before that trigger existed, or a
  // provider that sent no name — so the session's own metadata backs it up.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('full_name')
    .eq('user_id', user.id)
    .maybeSingle();

  const accountName =
    profile?.full_name ||
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    user.email ||
    'Your workspace';

  return (
    <div className="grid min-h-screen bg-slate-950 text-slate-100 lg:grid-cols-[280px_1fr]">
      <aside className="border-b border-white/10 lg:border-b-0 lg:border-r">
        <SidebarNav accountName={accountName} />
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
