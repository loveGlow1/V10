-- Form email notifications: whether and where to email an app owner when one
-- of their forms is sent, and a rolling hourly window that caps how many go
-- out. Used for both the QuickStark forms inbox and forms that save to the
-- owner's own Supabase. Mirrors supabase/schema.sql, which declared the table
-- without a migration, so it never reached the live database.
--
-- Service role only: RLS on with no policy BY DESIGN, all grants revoked.

create table if not exists public.form_notifications (
  project_id    uuid primary key references public.projects (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  enabled       boolean not null default true,
  email         text check (email is null or char_length(email) <= 320),
  secret_hash   text,
  installed_at  timestamptz,
  window_start  timestamptz,
  window_count  integer not null default 0,
  last_sent_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.form_notifications enable row level security;
revoke all on public.form_notifications from anon, authenticated;

comment on table public.form_notifications is 'Whether and where to email an app owner about form submissions. Service role only: RLS on with no policy BY DESIGN.';

drop trigger if exists form_notifications_set_updated_at on public.form_notifications;
create trigger form_notifications_set_updated_at
  before update on public.form_notifications
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
