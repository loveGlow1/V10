import { NextResponse, after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { currentBalance } from '@/lib/credits-server';
import { requestFromBrief } from '@/lib/flyers/brief';
import { providerChain } from '@/lib/flyers/router';
import { flyerJobCost, isOwnPreviewPath, runFlyerJob } from '@/lib/flyers/run';
import { createSupabaseServiceClient } from '@/lib/supabase-service';
import type { FlyerRequest } from '@/lib/flyers/types';
import { daysLeft, liveOutputs, type Output as StoredOutput } from '@/lib/flyers/trash';
import { refuseWithoutCard } from "@/lib/card-gate";

export const runtime = 'nodejs';
export const maxDuration = 300;

/* The Fliers tab's engine: image generation, not a web page.
 *
 *   { brief, subtype? }                         four drafts, read from the brief
 *   { again: jobId }                            four more drafts of that brief
 *   { stage: "final", parentJobId, selectedPreviewPath }
 *                                               the chosen draft, made final
 *   { brand, spec, … }                          a full request, as before
 *
 * The balance is checked before a job starts and each image is charged as it
 * is delivered (lib/flyers/run.ts). On unless FLYERS_API_ENABLED=0. */
const DISABLED = process.env.FLYERS_API_ENABLED === '0';

type Row = { id: string; status: string; request: FlyerRequest | null; outputs: StoredOutput[] | null; created_at: string; parent_job_id?: string | null; deleted_at?: string | null; site_id?: string | null };

/* Your fliers: one card per brief, newest first. The picture is the newest
 * finished final when there is one, else the first draft. Read under the
 * caller's session, so RLS returns only their jobs and their folder. */
export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Sessions are unavailable.' }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in to see your fliers.' }, { status: 401 });
  const sign = async (path: string | null | undefined) =>
    path ? ((await supabase.storage.from('flyers').createSignedUrl(path, 60 * 60)).data?.signedUrl ?? null) : null;

  /* Recently deleted: whole fliers, and single images of fliers still kept,
     each with the days left before it is gone for good. */
  if (new URL(req.url).searchParams.get('trash') === '1') {
    const { data: deleted } = await supabase
      .from('flyer_jobs')
      .select('id, status, request, outputs, created_at, parent_job_id, deleted_at')
      .not('deleted_at', 'is', null)
      .is('parent_job_id', null)
      .order('deleted_at', { ascending: false })
      .limit(100)
      .returns<Row[]>();
    const { data: marked } = await supabase
      .from('flyer_jobs')
      .select('id, status, request, outputs, created_at, parent_job_id, deleted_at')
      .is('deleted_at', null)
      .contains('outputs', [{ trashed: true }])
      .limit(100)
      .returns<Row[]>();
    const items = [
      ...(await Promise.all(
        (deleted ?? []).map(async (row) => ({
          kind: 'flier' as const,
          id: row.id,
          path: null,
          headline: row.request?.spec?.headline ?? '',
          format: row.request?.spec?.format ?? 'portrait',
          thumb: await sign(row.outputs?.[0]?.path),
          deletedAt: row.deleted_at as string,
          daysLeft: daysLeft(row.deleted_at as string),
        })),
      )),
      ...(await Promise.all(
        (marked ?? []).flatMap((row) =>
          (row.outputs ?? [])
            .filter((output) => output.trashed && output.deleted_at)
            .map(async (output) => ({
              kind: 'image' as const,
              id: row.id,
              path: output.path,
              headline: row.request?.spec?.headline ?? '',
              format: row.request?.spec?.format ?? 'portrait',
              thumb: await sign(output.path),
              deletedAt: output.deleted_at as string,
              daysLeft: daysLeft(output.deleted_at as string),
            })),
        ),
      )),
    ].sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const { data: drafts, error } = await supabase
    .from('flyer_jobs')
    .select('id, status, request, outputs, created_at, site_id')
    .eq('stage', 'preview')
    .is('parent_job_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(60)
    .returns<Row[]>();
  if (error) return NextResponse.json({ error: 'Could not load your fliers.' }, { status: 500 });

  const ids = (drafts ?? []).map((row) => row.id);
  const { data: finals } = ids.length
    ? await supabase
        .from('flyer_jobs')
        .select('id, status, outputs, created_at, parent_job_id')
        .in('parent_job_id', ids)
        .is('deleted_at', null)
        .eq('status', 'done')
        .order('created_at', { ascending: false })
        .returns<Row[]>()
    : { data: [] as Row[] };
  const finalFor = new Map<string, Row>();
  for (const final of finals ?? []) {
    if (final.parent_job_id && !finalFor.has(final.parent_job_id) && liveOutputs(final.outputs)[0]?.path) finalFor.set(final.parent_job_id, final);
  }

  const fliers = await Promise.all(
    (drafts ?? []).map(async (row) => {
      const final = finalFor.get(row.id);
      const path = liveOutputs(final?.outputs)[0]?.path ?? liveOutputs(row.outputs)[0]?.path ?? null;
      /* Every image of it deleted one by one: nothing left to show. */
      if (!path && row.status === 'done') return null;
      const thumb = await sign(path);
      return {
        id: row.id,
        /* Made in the workspace: that is where it opens. */
        projectId: row.site_id ?? null,
        finalId: final?.id ?? null,
        status: row.status,
        headline: row.request?.spec?.headline ?? '',
        format: row.request?.spec?.format ?? 'portrait',
        created_at: row.created_at,
        thumb,
      };
    }),
  );
  return NextResponse.json({ fliers: fliers.filter(Boolean) }, { headers: { 'Cache-Control': 'no-store' } });
}

type Body = Partial<FlyerRequest> & { brief?: unknown; subtype?: unknown; again?: unknown };

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
  if (typeof raw.again === 'string') {
    /* Four more drafts of a brief already read: its request again, as new
       drafts. RLS returns only the caller's own jobs, so this proves it too. */
    const { data: earlier } = await supabase.from('flyer_jobs').select('id, request').eq('id', raw.again).maybeSingle();
    if (!earlier) return NextResponse.json({ error: 'That flier is not yours or no longer exists.' }, { status: 403 });
    body = { ...(earlier.request as FlyerRequest), stage: 'preview', variants: 4, parentJobId: undefined, selectedPreviewPath: undefined };
  } else if (raw.stage === 'final' && typeof raw.parentJobId === 'string') {
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
  /* No card, no service, for an account that has never paid. */
  const noCard = await refuseWithoutCard(service, user.id);
  if (noCard) return noCard;
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
