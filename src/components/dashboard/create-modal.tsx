'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { createSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase';

export function CreateModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
  }

  async function saveDraft() {
    const projectName = name.trim();
    if (!projectName) {
      setError('Give the project a name first.');
      return;
    }
    if (!isSupabaseConfigured) {
      setError('Supabase is not configured, so there is nowhere to save this yet.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('Your session has expired. Sign in again and retry.');
        return;
      }

      // user_id is not defaulted, and the row-level policy checks it against
      // auth.uid(), so the insert has to carry it explicitly.
      const { error: insertError } = await supabase.from('projects').insert({
        user_id: user.id,
        name: projectName,
        prompt: prompt.trim() || null,
        status: 'Draft',
      });

      if (insertError) {
        setError(insertError.message);
        return;
      }

      setName('');
      setPrompt('');
      setOpen(false);
      // The list is rendered on the server, so it only picks the new row up
      // once the route re-renders.
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the project.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button className="rounded-xl bg-sky-400 px-4 py-3 font-medium text-slate-950" onClick={() => setOpen(true)} type="button">
        New project
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg space-y-4 rounded-3xl border border-white/10 bg-slate-950 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Create a new project</h2>
                <p className="text-sm text-slate-400">Saved to your workspace as a draft.</p>
              </div>
              <button className="text-sm text-slate-400" onClick={close} type="button">
                Close
              </button>
            </div>
            <label className="block space-y-2 text-sm text-slate-200">
              <span>Project name</span>
              <input
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3"
                type="text"
                placeholder="Launch campaign site"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block space-y-2 text-sm text-slate-200">
              <span>Initial prompt</span>
              <textarea
                className="min-h-32 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3"
                placeholder="Describe the product, audience, and launch goal."
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            {error ? (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
            ) : null}

            <button
              className="rounded-xl bg-white px-4 py-3 font-medium text-slate-950 disabled:opacity-60"
              type="button"
              onClick={saveDraft}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save draft'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
