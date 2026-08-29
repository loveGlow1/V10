const settingsGroups = [
  {
    title: 'Stripe',
    description: 'Publishable and secret key placeholders for billing actions.',
    fields: ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  },
  {
    title: 'Vercel',
    description: 'Project and token placeholders for deploy automation.',
    fields: ['VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID', 'VERCEL_API_TOKEN'],
  },
];

export default function SettingsPage() {
  return (
    <section className="space-y-6 px-6 py-8 lg:px-10">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Settings</p>
        <h1 className="text-3xl font-semibold text-ink">Workspace integrations</h1>
        <p className="text-slate-300">Store secrets in a secure backend or secret manager before connecting these fields to persistence.</p>
      </header>
      <div className="grid gap-6 xl:grid-cols-2">
        {settingsGroups.map((group) => (
          <section key={group.title} className="space-y-4 rounded-3xl border border-line/10 bg-layer/5 p-6">
            <div>
              <h2 className="text-xl font-semibold text-ink">{group.title}</h2>
              <p className="text-sm text-slate-400">{group.description}</p>
            </div>
            <div className="space-y-4">
              {group.fields.map((field) => (
                <label key={field} className="block space-y-2 text-sm text-slate-200">
                  <span>{field}</span>
                  <input className="w-full rounded-xl border border-line/10 bg-slate-900 px-4 py-3" type="password" placeholder="Configured securely outside the client" />
                </label>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
