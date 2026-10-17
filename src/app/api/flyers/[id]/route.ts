import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import type { FlyerRequest } from '@/lib/flyers/types';
import { createSupabaseServiceClient } from '@/lib/supabase-service';
import { liveOutputs, markOutput, purgeImages, purgeJobs, type Output } from '@/lib/flyers/trash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* One flier job, for the Flier Studio: where it is, what it made — each image
 * as a short-lived signed URL — and the finals made from its drafts.
 *
 * Read under the caller's own session: RLS returns only their jobs, and the
 * flyers bucket only their own folder. */

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
    .select('id, status, stage, request, outputs, error, parent_job_id, created_at, deleted_at')
    .eq('id', id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: 'No such flier.' }, { status: 404 });
  if (job.deleted_at) return NextResponse.json({ error: 'This flier was deleted. It is in Recently deleted on Your fliers.' }, { status: 404 });

  const sign = async (outputs: Output[]) =>
    Promise.all(
      liveOutputs(outputs).map(async (output) => {
        const { data } = await supabase.storage.from('flyers').createSignedUrl(output.path, 60 * 60);
        return { path: output.path, provider: output.provider, url: data?.signedUrl ?? null };
      }),
    );

  const { data: finals } = await supabase
    .from('flyer_jobs')
    .select('id, status, outputs, error, created_at')
    .eq('parent_job_id', id)
    .is('deleted_at', null)
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

/* ── Deleting and restoring ─────────────────────────────────────────────────
 *
 *   DELETE                     the flier (and finals made from it) to Recently
 *                              deleted, for TRASH_DAYS
 *   DELETE ?path=…             one image of it, the same way
 *   … &forever=1               gone now: files and rows, nothing to restore
 *   PATCH { restore, path? }   back out of Recently deleted
 *
 * Ownership is proved by the read under the caller's session (RLS returns
 * only their jobs); the write then uses the service key, since the table has
 * no update or delete policy for the browser. */

async function owned(id: string) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { failure: NextResponse.json({ error: 'Sessions are unavailable.' }, { status: 503 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { failure: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }) };
  const service = createSupabaseServiceClient();
  if (!service) return { failure: NextResponse.json({ error: 'Deleting is unavailable right now.' }, { status: 503 }) };
  const { data: job } = await supabase.from('flyer_jobs').select('id, outputs, deleted_at').eq('id', id).maybeSingle();
  if (!job) return { failure: NextResponse.json({ error: 'No such flier.' }, { status: 404 }) };
  const { data: finals } = await supabase.from('flyer_jobs').select('id, outputs, deleted_at').eq('parent_job_id', id);
  return { service, job: job as { id: string; outputs: Output[] | null; deleted_at: string | null }, finals: (finals ?? []) as { id: string; outputs: Output[] | null; deleted_at: string | null }[] };
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const found = await owned(id);
  if ('failure' in found) return found.failure;
  const { service, job, finals } = found;
  const url = new URL(req.url);
  const path = url.searchParams.get('path');
  const forever = url.searchParams.get('forever') === '1';

  try {
    if (path) {
      if (!(job.outputs ?? []).some((output) => output.path === path)) return NextResponse.json({ error: 'No such image.' }, { status: 404 });
      const marked = markOutput(job.outputs ?? [], path, true);
      if (forever) await purgeImages(service, { ...job, outputs: marked }, (output) => output.path === path);
      else await service.from('flyer_jobs').update({ outputs: marked }).eq('id', id);
    } else if (forever) {
      await purgeJobs(service, [job, ...finals]);
    } else {
      await service.from('flyer_jobs').update({ deleted_at: new Date().toISOString() }).or(`id.eq.${id},parent_job_id.eq.${id}`);
    }
  } catch {
    return NextResponse.json({ error: 'It could not be deleted. Try again.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, forever });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { restore?: boolean; path?: string } | null;
  if (!body?.restore) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  const found = await owned(id);
  if ('failure' in found) return found.failure;
  const { service, job } = found;
  if (body.path) {
    await service.from('flyer_jobs').update({ outputs: markOutput(job.outputs ?? [], body.path, false) }).eq('id', id);
  } else {
    await service.from('flyer_jobs').update({ deleted_at: null }).or(`id.eq.${id},parent_job_id.eq.${id}`);
  }
  return NextResponse.json({ ok: true });
}
