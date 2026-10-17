/* Recently deleted fliers.
 *
 * Deleting is two steps, the way a phone's Photos app does it:
 *
 *   delete       hidden everywhere at once, kept TRASH_DAYS so it can be put
 *                back — a whole flier (deleted_at on its job, and on the
 *                finals made from it) or one image (marked inside outputs)
 *   gone         after TRASH_DAYS the daily purge (/api/cron/flyer-trash)
 *                removes the image files from storage and the rows with them;
 *                "Delete now" in Recently deleted does the same at once
 *
 * Nothing about a purged flier survives: not the files, not the row, not a
 * signed URL that could be re-made from it. */

import type { SupabaseClient } from '@supabase/supabase-js';

export const TRASH_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Output = { provider: string; stage: string; path: string; trashed?: boolean; deleted_at?: string };

/** The images still showing. Pure. */
export const liveOutputs = (outputs: Output[] | null | undefined) => (outputs ?? []).filter((output) => !output.trashed);

/** Whole days left before something deleted at `deletedAt` is gone. Pure. */
export function daysLeft(deletedAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(deletedAt) + TRASH_DAYS * DAY_MS - now) / DAY_MS));
}

/** Whether something deleted at `deletedAt` is due to be removed for good. Pure. */
export const purgeDue = (deletedAt: string | null | undefined, now = Date.now()) =>
  Boolean(deletedAt) && Date.parse(deletedAt as string) + TRASH_DAYS * DAY_MS <= now;

/** Mark one image deleted, or put it back. Pure. */
export const markOutput = (outputs: Output[], path: string, trashed: boolean, now = new Date().toISOString()): Output[] =>
  outputs.map((output) => {
    if (output.path !== path) return output;
    if (!trashed) {
      const { trashed: _t, deleted_at: _d, ...rest } = output;
      void _t;
      void _d;
      return rest;
    }
    return { ...output, trashed: true, deleted_at: now };
  });

type JobRow = { id: string; outputs: Output[] | null; deleted_at: string | null };

/** Remove a set of jobs for good: their files, then their rows. */
export async function purgeJobs(service: SupabaseClient, jobs: JobRow[]): Promise<number> {
  if (!jobs.length) return 0;
  const paths = jobs.flatMap((job) => (job.outputs ?? []).map((output) => output.path));
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await service.storage.from('flyers').remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
  const { error } = await service.from('flyer_jobs').delete().in('id', jobs.map((job) => job.id));
  if (error) throw error;
  return jobs.length;
}

/** Remove one job's deleted images for good, keeping the rest of the job. */
export async function purgeImages(service: SupabaseClient, job: JobRow, due: (output: Output) => boolean): Promise<number> {
  const gone = (job.outputs ?? []).filter((output) => output.trashed && due(output));
  if (!gone.length) return 0;
  const { error } = await service.storage.from('flyers').remove(gone.map((output) => output.path));
  if (error) throw error;
  const kept = (job.outputs ?? []).filter((output) => !gone.includes(output));
  const { error: update } = await service.from('flyer_jobs').update({ outputs: kept }).eq('id', job.id);
  if (update) throw update;
  return gone.length;
}

/** The daily purge: everything deleted more than TRASH_DAYS ago, gone. */
export async function purgeFlyerTrash(service: SupabaseClient, now = Date.now(), limit = 200) {
  const cutoff = new Date(now - TRASH_DAYS * DAY_MS).toISOString();
  const { data: jobs, error } = await service
    .from('flyer_jobs')
    .select('id, outputs, deleted_at')
    .not('deleted_at', 'is', null)
    .lte('deleted_at', cutoff)
    .limit(limit);
  if (error) throw error;
  const fliers = await purgeJobs(service, (jobs ?? []) as JobRow[]);

  const { data: marked, error: markedError } = await service
    .from('flyer_jobs')
    .select('id, outputs, deleted_at')
    .is('deleted_at', null)
    .contains('outputs', [{ trashed: true }])
    .limit(limit);
  if (markedError) throw markedError;
  let images = 0;
  for (const job of (marked ?? []) as JobRow[]) images += await purgeImages(service, job, (output) => purgeDue(output.deleted_at, now));
  return { fliers, images };
}
