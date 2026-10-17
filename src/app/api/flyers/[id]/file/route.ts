/* One flier image, as a file.
 *
 *   ?path=…              the image itself, to show in the chat
 *   ?path=…&download=1   the same bytes as an attachment with a clean file
 *                        name — "Download" saves the image and nothing else
 *
 * A stable address on this app rather than a signed storage link, so a
 * message in the thread can carry it and still work next week. Served under
 * the caller's own session: RLS returns only their jobs, and the flyers
 * bucket only their own folder. A deleted image is not served. */

import { liveOutputs, type Output } from '@/lib/flyers/trash';
import type { FlyerRequest } from '@/lib/flyers/types';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

function fileName(headline: string, index: number) {
  const base = (headline || 'flier').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'flier';
  return `${base}-${index + 1}.png`;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const path = url.searchParams.get('path');
  const supabase = await createSupabaseServerClient();
  if (!supabase || !path) return new Response('Not found', { status: 404 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Sign in first', { status: 401 });

  const { data: job } = await supabase
    .from('flyer_jobs')
    .select('outputs, request, deleted_at')
    .eq('id', id)
    .maybeSingle<{ outputs: Output[] | null; request: FlyerRequest | null; deleted_at: string | null }>();
  const live = job && !job.deleted_at ? liveOutputs(job.outputs) : [];
  const index = live.findIndex((output) => output.path === path);
  if (index < 0) return new Response('Not found', { status: 404 });

  const { data: blob } = await supabase.storage.from('flyers').download(path);
  if (!blob) return new Response('Not found', { status: 404 });

  const name = fileName(job?.request?.spec?.headline ?? '', index);
  return new Response(blob.stream(), {
    headers: {
      'Content-Type': blob.type || 'image/png',
      'Content-Disposition': url.searchParams.get('download') === '1' ? `attachment; filename="${name}"` : `inline; filename="${name}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
