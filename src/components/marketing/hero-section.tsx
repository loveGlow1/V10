import Link from 'next/link';

export function HeroSection() {
  return (
    <section className="grid items-center gap-8 rounded-[2rem] border border-line/10 bg-layer/5 p-8 lg:grid-cols-[1.15fr_0.85fr] lg:p-12">
      <div className="space-y-6">
        <p className="text-sm uppercase tracking-[0.35em] text-sky-300">Emergent architecture scaffold</p>
        <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-ink">Launch a marketing funnel, workspace dashboard, and AI editor from one Next.js foundation.</h1>
        <p className="max-w-2xl text-lg text-slate-300">
          This scaffold maps the public site, auth flow, dashboard, and immersive editor into isolated App Router
          branches that can be connected to Supabase, Stripe, n8n, and Vercel over time.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link className="rounded-full bg-sky-400 px-5 py-3 font-medium text-slate-950" href="/register">
            Create workspace
          </Link>
          <Link className="rounded-full border border-line/10 px-5 py-3 text-ink" href="/dashboard">
            Explore dashboard scaffold
          </Link>
        </div>
      </div>
      <div className="grid gap-4 rounded-[2rem] border border-line/10 bg-slate-950/60 p-6">
        {[
          'Public conversion pages optimized for SEO and CTA experiments.',
          'Auth and onboarding routes reserved for Supabase and Google sign-in.',
          'Editor flow wired from prompt stream to iframe canvas preview.',
        ].map((item) => (
          <div key={item} className="rounded-2xl border border-line/10 bg-layer/5 p-4 text-sm text-slate-200">
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}
