const tiers = [
  {
    name: 'Starter',
    price: '$0',
    features: ['1 workspace', 'Prompt and preview sandbox', 'Manual deploy review'],
  },
  {
    name: 'Pro',
    price: '$49',
    features: ['Unlimited projects', 'Shared editor sessions', 'Stripe checkout placeholder'],
  },
  {
    name: 'Scale',
    price: 'Custom',
    features: ['Team analytics', 'Custom deployment controls', 'n8n workflow automation'],
  },
];

export function PricingCards({ showPlaceholders = false }: { showPlaceholders?: boolean }) {
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Plans</p>
        <h2 className="text-3xl font-semibold text-ink">Usage tiers ready for Stripe wiring</h2>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {tiers.map((tier) => (
          <article key={tier.name} className="space-y-5 rounded-3xl border border-line/10 bg-layer/5 p-6">
            <div>
              <h3 className="text-2xl font-semibold text-ink">{tier.name}</h3>
              <p className="mt-2 text-4xl font-semibold text-sky-300">{tier.price}</p>
            </div>
            <ul className="space-y-2 text-sm text-slate-300">
              {tier.features.map((feature) => (
                <li key={feature}>• {feature}</li>
              ))}
            </ul>
            <button className="w-full rounded-xl bg-solid px-4 py-3 font-medium text-slate-950" type="button">
              {showPlaceholders ? 'TODO: create Stripe checkout session' : 'Choose plan'}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
