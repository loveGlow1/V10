-- Re-cutting only what changed (src/lib/video/chapters.ts partFingerprint):
-- each part of a long film records what it was made from, so a later
-- version whose part would come out the same reuses it instead of cutting
-- and charging for it again.
alter table public.video_renders
  add column if not exists fingerprint text,
  add column if not exists detail jsonb;

create index if not exists video_renders_part_fingerprint_idx
  on public.video_renders (video_id, fingerprint)
  where engine = 'part' and status = 'done';
