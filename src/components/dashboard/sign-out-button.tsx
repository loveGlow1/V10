'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { createSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase';

export function SignOutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (!isSupabaseConfigured) return;
    setSigningOut(true);
    try {
      await createSupabaseBrowserClient().auth.signOut();
      // refresh() re-runs the layout, which redirects now that the session
      // cookies are gone; push() alone would leave a stale cached shell.
      router.push('/');
      router.refresh();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Sign-out failed:', error);
      setSigningOut(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={signingOut}
      className="w-full rounded-2xl border border-white/10 px-4 py-3 text-sm font-medium text-slate-300 transition hover:border-white/20 hover:bg-white/5 hover:text-white disabled:opacity-60"
    >
      {signingOut ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
