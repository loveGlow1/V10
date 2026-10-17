/* Back into the workspace from Your fliers.
 *
 * A flier made in the workspace already has a project there (its job's
 * site_id), and this answers with it. One made before fliers moved into the
 * workspace — in the old Flier Studio — gets one now: a flier project, marked
 * Built at the time the flier was made, and the flier's job linked to it, so
 * the workspace preview shows its versions and the next message in the chat
 * is a change to it (lib/flyers/workspace.ts).
 *
 * The images stay where they are — the flyers bucket, Your fliers and
 * Recently deleted read them exactly as before. Ownership is proved by the
 * read under the caller's session; the writes use the service key, since the
 * browser can update neither flyer_jobs nor a new project's intent. */

import { NextResponse } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseServiceClient } from '@/lib/supabase-service';
import { FLIER_INTENT } from '@/lib/flyers/workspace';
import { recordMessage } from '@/lib/thread-server';
import type { FlyerRequest } from '@/lib/flyers/types';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Sessions are unavailable.' }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { data: job } = await supabase
    .from('flyer_jobs')
    .select('id, site_id, parent_job_id, request, created_at, deleted_at')
    .eq('id', id)
    .maybeSingle<{ id: string; site_id: string | null; parent_job_id: string | null; request: FlyerRequest | null; created_at: string; deleted_at: string | null }>();
  if (!job) return NextResponse.json({ error: 'No such flier.' }, { status: 404 });
  if (job.deleted_at) return NextResponse.json({ error: 'This flier is in Recently deleted. Restore it first.' }, { status: 409 });

  /* A final belongs to its drafts' flier. */
  let root = job;
  if (job.parent_job_id) {
    const { data: parent } = await supabase
      .from('flyer_jobs')
      .select('id, site_id, parent_job_id, request, created_at, deleted_at')
      .eq('id', job.parent_job_id)
      .maybeSingle<typeof job>();
    if (parent) root = parent;
  }

  /* Already in the workspace, and the project is still there. */
  if (root.site_id) {
    const { data: project } = await supabase.from('projects').select('id').eq('id', root.site_id).is('deleted_at', null).maybeSingle();
    if (project) return NextResponse.json({ projectId: project.id });
  }

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: 'This is unavailable right now.' }, { status: 503 });
  const headline = root.request?.spec?.headline ?? '';
  const { data: project, error } = await service
    .from('projects')
    .insert({
      user_id: user.id,
      name: `Flier: ${headline || 'untitled'}`.slice(0, 80),
      intent: FLIER_INTENT,
      status: 'Built',
      prompt: headline || null,
      last_build_at: root.created_at,
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !project) return NextResponse.json({ error: 'The workspace could not be opened. Try again.' }, { status: 500 });

  await service.from('flyer_jobs').update({ site_id: project.id }).or(`id.eq.${root.id},parent_job_id.eq.${root.id}`);
  await recordMessage(service, {
    projectId: project.id,
    userId: user.id,
    role: 'system',
    kind: 'build_ready',
    body: `This is your flier${headline ? ` "${headline}"` : ''}. Its versions are in the preview — tap one to see it full size and save it. Tell me anything to change and I'll make four new versions.`,
    dedupeKey: `flier-open:${root.id}`,
  });
  return NextResponse.json({ projectId: project.id });
}
