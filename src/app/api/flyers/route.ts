import { NextResponse, after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isOwnPreviewPath, runFlyerJob } from '@/lib/flyers/run';
import type { FlyerRequest } from '@/lib/flyers/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Sessions are unavailable.' }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as FlyerRequest | null;
  if (!body?.brand?.name || !body?.spec?.headline || !body?.spec?.format) {
    return NextResponse.json({ error: 'brand.name, spec.headline, spec.format required' }, { status: 400 });
  }

  const stage = body.stage ?? 'preview';
  if (stage !== 'preview' && stage !== 'final') {
    return NextResponse.json({ error: 'stage must be "preview" or "final"' }, { status: 400 });
  }
  if (body.selectedPreviewPath && !isOwnPreviewPath(body.selectedPreviewPath, user.id)) {
    return NextResponse.json({ error: 'Invalid selectedPreviewPath' }, { status: 403 });
  }
  /* RLS returns only the caller's own jobs, so this also proves ownership. */
  if (body.parentJobId) {
    const { data: parent } = await supabase.from('flyer_jobs').select('id').eq('id', body.parentJobId).maybeSingle();
    if (!parent) return NextResponse.json({ error: 'Invalid parentJobId' }, { status: 403 });
  }

  const { data: job, error } = await supabase
    .from('flyer_jobs')
    .insert({
      user_id: user.id,
      site_id: body.siteId ?? null,
      stage,
      parent_job_id: body.parentJobId ?? null,
      request: body,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  after(() => runFlyerJob(job.id, user.id, { ...body, stage }));
  return NextResponse.json({ jobId: job.id, stage }, { status: 202 });
}
