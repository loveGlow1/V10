-- Recently deleted fliers: a deleted flier is hidden at once and kept for
-- 15 days so it can be restored, then /api/cron/flyer-trash removes its
-- images from storage and its row for good. A single deleted image is
-- marked inside outputs ({"trashed": true, "deleted_at": …}) the same way.
alter table public.flyer_jobs
  add column if not exists deleted_at timestamptz;

create index if not exists flyer_jobs_deleted_at_idx
  on public.flyer_jobs (deleted_at)
  where deleted_at is not null;
