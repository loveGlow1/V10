import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import type { FlyerRequest } from '@/lib/flyers/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* One flier job, for the Flier Studio: where it is, what it made — each image
 * as a short-lived signed URL — and the finals made from its drafts.
 *
 * Read under the caller's own session: RLS returns only their jobs, and the
 * flyers bucket only their own folder. */

type Output = { provider: string; stage: string; path: string };

/* What went wrong, in words the person can act on — never the provider log. */
function failureFor(error: string | null): string {
  const e = error ?? '';
  if (/No image provider is connected/i.test(e)) return 'No image model is connected on this deployment yet, so nothing could be made. Nothing was charged.';
  if (/out of credit|insufficient|1008|quota|billing|402/i.test(e)) return 'The image service is out of credit right now. Nothing was charged.';
  if (/sensitive|safety|moderation|nsfw|policy/i.test(e)) return 'The image service declined this brief. Try wording it differently. Nothing was charged.';
  return 'The images could not be made. Try again in a moment. Nothing was charged.';
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Sessions are unavailable.' }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in to see this flier.' }, { status: 401 });

  const { data: job } = await supabase
    .from('flyer_jobs')
    .select('id, status, stage, request, outputs, error, parent_job_id, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: 'No such flier.' }, { status: 404 });

  const sign = async (outputs: Output[]) =>
    Promise.all(
      (outputs ?? []).map(async (output) => {
        const { data } = await supabase.storage.from('flyers').createSignedUrl(output.path, 60 * 60);
        return { path: output.path, provider: output.provider, url: data?.signedUrl ?? null };
      }),
    );

  const { data: finals } = await supabase
    .from('flyer_jobs')
    .select('id, status, outputs, error, created_at')
    .eq('parent_job_id', id)
    .order('created_at', { ascending: false })
    .limit(5);

  const request = job.request as FlyerRequest;
  return NextResponse.json(
    {
      id: job.id,
      status: job.status,
      stage: job.stage,
      parentId: job.parent_job_id,
      /* The provider's fallback note is for logs, not for the person. */
      error: job.status === 'failed' ? failureFor(job.error) : null,
      headline: request?.spec?.headline ?? '',
      format: request?.spec?.format ?? 'portrait',
      images: await sign(job.outputs as Output[]),
      finals: await Promise.all(
        (finals ?? []).map(async (final) => ({ id: final.id, status: final.status, images: await sign(final.outputs as Output[]) })),
      ),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
