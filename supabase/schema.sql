-- QuickStart.Ai — Supabase schema.
--
-- Safe to run more than once. Paste the whole file into the SQL editor
-- (Supabase Studio → SQL Editor → New query) and run it.
--
-- Covers two tables:
--   user_profiles — already created; this adds the policies and the trigger
--                   that fills it, without which it stays empty forever.
--   projects      — read by the dashboard, and not yet created.

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
-- projects — the dashboard reads id, name, updated_at, status from this.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  status      text not null default 'Draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.projects enable row level security;

drop policy if exists "Owners read their projects" on public.projects;
create policy "Owners read their projects"
  on public.projects for select
  using (auth.uid() = user_id);

drop policy if exists "Owners create their projects" on public.projects;
create policy "Owners create their projects"
  on public.projects for insert
  with check (auth.uid() = user_id);

drop policy if exists "Owners update their projects" on public.projects;
create policy "Owners update their projects"
  on public.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Owners delete their projects" on public.projects;
create policy "Owners delete their projects"
  on public.projects for delete
  using (auth.uid() = user_id);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create index if not exists projects_user_id_updated_at_idx
  on public.projects (user_id, updated_at desc);
