import { NextResponse, after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { currentBalance } from '@/lib/credits-server';
import { requestFromBrief } from '@/lib/flyers/brief';
import { providerChain } from '@/lib/flyers/router';
import { flyerJobCost, isOwnPreviewPath, runFlyerJob } from '@/lib/flyers/run';
import { createSupabaseServiceClient } from '@/lib/supabase-service';
import type { FlyerRequest } from '@/lib/flyers/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

/* The Fliers tab's engine: image generation, not a web page.
 *
 *   { brief, subtype? }                         four drafts, read from the brief
 *   { stage: "final", parentJobId, selectedPreviewPath }
 *                                               the chosen draft, made final
 *   { brand, spec, … }                          a full request, as before
 *
 * The balance is checked before a job starts and each image is charged as it
 * is delivered (lib/flyers/run.ts). On unless FLYERS_API_ENABLED=0. */
const DISABLED = process.env.FLYERS_API_ENABLED === '0';

type Body = Partial<FlyerRequest> & { brief?: unknown; subtype?: unknown };

export async function POST(req: Request) {
  if (DISABLED) {
    return NextResponse.json({ error: 'Flyer generation is switched off on this deployment.' }, { status: 404 });
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Sessions are unavailable.' }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in to make a flier.' }, { status: 401 });

  const raw = (await req.json().catch(() => null)) as Body | null;
  if (!raw) return NextResponse.json({ error: 'Say what the flier is for.' }, { status: 400 });

  let body: FlyerRequest;
  if (raw.stage === 'final' && typeof raw.parentJobId === 'string') {
    /* A final is the chosen draft, made again at full quality from the same
       request. RLS returns only the caller's own jobs, so this proves it too. */
    const { data: parent } = await supabase.from('flyer_jobs').select('id, request').eq('id', raw.parentJobId).maybeSingle();
    if (!parent) return NextResponse.json({ error: 'That draft is not yours or no longer exists.' }, { status: 403 });
    body = { ...(parent.request as FlyerRequest), stage: 'final', variants: 1, parentJobId: parent.id, selectedPreviewPath: raw.selectedPreviewPath };
  } else if (typeof raw.brief === 'string' && raw.brief.trim()) {
    body = await requestFromBrief(raw.brief.trim().slice(0, 3000), typeof raw.subtype === 'string' ? raw.subtype : null);
    body.variants = 4;
  } else {
    body = raw as FlyerRequest;
  }

  if (!body?.spec?.headline || !body?.spec?.format || !body.brand) {
    return NextResponse.json({ error: 'Say what the flier is for — the offer or the event, and anything it must show.' }, { status: 400 });
  }
  const stage = body.stage ?? 'preview';
  if (stage !== 'preview' && stage !== 'final') {
    return NextResponse.json({ error: 'stage must be "preview" or "final"' }, { status: 400 });
  }
  if (body.selectedPreviewPath && !isOwnPreviewPath(body.selectedPreviewPath, user.id)) {
    return NextResponse.json({ error: 'That draft is not yours.' }, { status: 403 });
  }

  /* Said before anything starts or is charged: with no image model connected
     every job would fail, and "try again" would be the wrong advice. */
  if (providerChain({ ...body, stage }).length === 0) {
    return NextResponse.json(
      {
        error: 'No image model is connected yet. Add MINIMAX_API_KEY, OPENAI_API_KEY, IDEOGRAM_API_KEY or GEMINI_API_KEY to the deployment to make fliers.',
        code: 'no_image_model',
      },
      { status: 503 },
    );
  }

  /* Enough credit for every image this job could make, before any is made. */
  const n = Math.min(Math.max(body.variants ?? (stage === 'preview' ? 4 : 1), 1), 4);
  const service = createSupabaseServiceClient();
  const balance = service ? await currentBalance(service, user.id) : null;
  const needed = flyerJobCost(stage, n);
  if (balance && balance.daily + balance.rollover + balance.monthly + balance.topUp < needed) {
    return NextResponse.json({ error: `This needs ${needed} credits. Top up to make it.`, code: 'insufficient_credits' }, { status: 402 });
  }

  const { data: job, error } = await supabase
    .from('flyer_jobs')
    .insert({
      user_id: user.id,
      site_id: body.siteId ?? null,
      stage,
      parent_job_id: body.parentJobId ?? null,
      request: { ...body, stage, variants: n },
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: 'The flier could not be started. Try again.' }, { status: 500 });

  after(() => runFlyerJob(job.id, user.id, { ...body, stage, variants: n }));
  return NextResponse.json({ jobId: job.id, id: job.id, stage, cost: needed }, { status: 202 });
}
