-- QuickStart.Ai — Supabase schema.
--
-- Safe to run more than once. Paste the whole file into the SQL editor
-- (Supabase Studio → SQL Editor → New query) and run it.
--
-- Covers two tables:
--   user_profiles — already created; this adds the policies and the trigger
--                   that fills it, without which it stays empty forever.
--   project_logs  — read and written by the dashboard, and not yet created.

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared helper: keep updated_at honest without the client having to set it.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- user_profiles
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.user_profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

-- RLS is already on. With it on and no policies, every read returns nothing and
-- every write is refused — which looks identical to an empty table.
drop policy if exists "Owners read their profile" on public.user_profiles;
create policy "Owners read their profile"
  on public.user_profiles for select
  using (auth.uid() = user_id);

drop policy if exists "Owners create their profile" on public.user_profiles;
create policy "Owners create their profile"
  on public.user_profiles for insert
  with check (auth.uid() = user_id);

drop policy if exists "Owners update their profile" on public.user_profiles;
create policy "Owners update their profile"
  on public.user_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- Nothing in the app writes this table, so without this trigger it stays at
-- zero rows no matter how many people sign up. security definer lets it insert
-- past the owner-only policies above, since at this moment there is no session.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, full_name, avatar_url)
  values (
    new.id,
    -- Email sign-up sends full_name; OAuth providers send one or the other.
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Anyone who signed up before the trigger existed has no profile row.
insert into public.user_profiles (user_id, full_name, avatar_url)
select
  id,
  coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name'),
  raw_user_meta_data ->> 'avatar_url'
from auth.users
on conflict (user_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- project_logs — what the dashboard reads and writes.
--
-- The column names match the shape the existing dashboard components already
-- expect (project_name, repository, branch, tech_stack, latest_activity), so
-- nothing has to be renamed on either side.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.project_logs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  project_name     text not null,
  repository       text not null,
  branch           text not null default 'main',
  -- active_development | shipped | paused, matching the card's status colours.
  status           text not null default 'active_development',
  description      text,
  tech_stack       text[] not null default '{}',
  -- The troubleshooter flips latest_activity.status to 'resolved'; keeping the
  -- whole record as jsonb means the shape can grow without a migration.
  latest_activity  jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.project_logs enable row level security;

drop policy if exists "Owners read their project logs" on public.project_logs;
create policy "Owners read their project logs"
  on public.project_logs for select
  using (auth.uid() = user_id);

drop policy if exists "Owners create their project logs" on public.project_logs;
create policy "Owners create their project logs"
  on public.project_logs for insert
  with check (auth.uid() = user_id);

drop policy if exists "Owners update their project logs" on public.project_logs;
create policy "Owners update their project logs"
  on public.project_logs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Owners delete their project logs" on public.project_logs;
create policy "Owners delete their project logs"
  on public.project_logs for delete
  using (auth.uid() = user_id);

drop trigger if exists project_logs_set_updated_at on public.project_logs;
create trigger project_logs_set_updated_at
  before update on public.project_logs
  for each row execute function public.set_updated_at();

create index if not exists project_logs_user_id_updated_at_idx
  on public.project_logs (user_id, updated_at desc);
