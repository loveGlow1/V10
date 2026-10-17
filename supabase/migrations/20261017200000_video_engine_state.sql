-- Whether a video engine is paused for the whole deployment, and until when.
--
-- One row per engine. Written when the n8n render workflow reports that the
-- MiniMax usage credit behind it has run out: every render then skips n8n and
-- goes straight to the main API until paused_until, after which n8n is tried
-- again (the credit may have been topped up or reset). See
-- src/lib/video/credit.ts.
--
-- Service role only: RLS on with no policy BY DESIGN, all grants revoked.

create table if not exists public.video_engine_state (
  engine        text primary key check (char_length(engine) <= 40),
  paused_until  timestamptz,
  reason        text check (reason is null or char_length(reason) <= 500),
  updated_at    timestamptz not null default now()
);

alter table public.video_engine_state enable row level security;
revoke all on public.video_engine_state from anon, authenticated;

comment on table public.video_engine_state is 'Video engines paused deployment-wide (e.g. the n8n MiniMax usage credit ran out). Service role only: RLS on with no policy BY DESIGN.';

notify pgrst, 'reload schema';
