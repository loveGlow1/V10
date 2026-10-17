import { NextResponse, after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { currentBalance } from '@/lib/credits-server';
import { flyerJobCost, isOwnPreviewPath, runFlyerJob } from '@/lib/flyers/run';
import { createSupabaseServiceClient } from '@/lib/supabase-service';
import type { FlyerRequest } from '@/lib/flyers/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

/* Off unless switched on (FLYERS_API_ENABLED=1). It now checks the balance
   before a job starts and charges per image delivered (lib/flyers/run.ts),
   so it is safe to turn on; it stays opt-in because no screen calls it yet —
   the builder's own fliers generate their art through lib/flyers/art.ts. */
const ENABLED = process.env.FLYERS_API_ENABLED === '1';

export async function POST(req: Request) {
  if (!ENABLED) {
    return NextResponse.json({ error: 'Flyer generation is not available yet.' }, { status: 404 });
  }
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
  /* Enough credit for every image this job could make, before any is made. */
  const n = Math.min(Math.max(body.variants ?? (stage === 'preview' ? 4 : 1), 1), 4);
  const service = createSupabaseServiceClient();
  const balance = service ? await currentBalance(service, user.id) : null;
  const needed = flyerJobCost(stage, n);
  if (balance && balance.daily + balance.rollover + balance.monthly + balance.topUp < needed) {
    return NextResponse.json({ error: `This needs ${needed} credits. Top up to make it.` }, { status: 402 });
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
