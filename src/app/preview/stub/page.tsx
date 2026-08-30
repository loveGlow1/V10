/* What the workspace's preview panel shows for a stubbed build.
 *
 * The panel loads whatever the orchestrator put in `preview_url` into a
 * sandboxed iframe. While the provisioning service is a stub (see
 * src/app/api/builder), that address points here.
 *
 * It says what it is on its face rather than mocking up a plausible app. A
 * convincing fake preview is the one thing this page must not be: the point of
 * the stub is to prove the loop works, and a page that looked like a real built
 * app would make it impossible to tell a working loop from a working product. */

export const dynamic = "force-dynamic";

/* One entry, because one build type. WordPress and e-commerce were removed from
   the orchestrator; when a branch comes back, it gets a line here. */
const KINDS: Record<string, { label: string; built: string }> = {
  webapp: { label: "Web app or landing page", built: "Next.js App Router · Tailwind CSS · Supabase" },
};

export default async function StubPreview({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; name?: string; prompt?: string }>;
}) {
  const { kind = "", name = "", prompt = "" } = await searchParams;
  const detail = KINDS[kind] ?? { label: "Build", built: "Stack not reported" };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-6 text-slate-200">
      <div className="w-full max-w-lg space-y-5 rounded-3xl border border-white/10 bg-white/[0.03] p-7">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <p className="text-xs uppercase tracking-[0.25em] text-amber-400">Placeholder preview</p>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-white">{name || "Untitled app"}</h1>
          <p className="text-sm text-slate-400">
            {detail.label} · {detail.built}
          </p>
        </div>

        {prompt ? (
          <blockquote className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm leading-relaxed text-slate-300">
            {prompt}
          </blockquote>
        ) : null}

        <p className="text-sm leading-relaxed text-slate-400">
          Nothing was built. The orchestrator ran end to end and every step answered, but the
          service that generates and deploys the app is still a stub — so this page stands in for
          the preview a real build would produce.
        </p>

        <p className="text-xs leading-relaxed text-slate-500">
          Turn it off by removing <code className="text-slate-400">BUILDER_STUB_ENABLED</code>, and
          the build branches fail honestly again.
        </p>
      </div>
    </main>
  );
}
