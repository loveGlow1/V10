export default function AnalyticsPage() {
  return (
    <section className="space-y-6 px-6 py-8 lg:px-10">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Analytics</p>
        <h1 className="text-3xl font-semibold text-ink">Conversion and usage signals</h1>
        <p className="text-slate-300">Placeholder cards for traffic, activation, retention, and prompt throughput metrics.</p>
      </header>
      <div className="grid gap-5 lg:grid-cols-4">
        {['Visitors', 'Trials', 'Deploys', 'AI Actions'].map((metric) => (
          <article key={metric} className="rounded-3xl border border-line/10 bg-layer/5 p-5">
            <p className="text-sm text-slate-400">{metric}</p>
            <p className="mt-4 text-3xl font-semibold text-ink">--</p>
            <p className="mt-2 text-sm text-slate-500">TODO: connect live warehouse or app telemetry.</p>
          </article>
        ))}
      </div>
      <article className="min-h-80 rounded-3xl border border-dashed border-line/10 bg-slate-900/40 p-6 text-sm text-slate-400">
        TODO: insert charts or streamed analytics snapshots.
      </article>
    </section>
  );
}
