'use client';

export default function ProjectEditorError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-rose-300">Editor unavailable</p>
      <h1 className="text-3xl font-semibold text-ink">We could not load this project.</h1>
      <p className="max-w-lg text-slate-300">{error.message || 'An unexpected error interrupted the editor shell.'}</p>
      <button className="rounded-xl bg-solid px-4 py-3 font-medium text-slate-950" onClick={reset} type="button">
        Try again
      </button>
    </section>
  );
}
