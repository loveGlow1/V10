import { NextResponse, after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { runFlyerJob } from '@/lib/flyers/run';
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

  const { data: job, error } = await supabase
    .from('flyer_jobs')
    .insert({ user_id: user.id, site_id: body.siteId ?? null, request: body })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  after(() => runFlyerJob(job.id, user.id, body));
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
