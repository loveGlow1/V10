-- QuickStart.Ai — Supabase schema.
--
-- Safe to run more than once. Paste the whole file into the SQL editor
-- (Supabase Studio → SQL Editor → New query) and run it.
--
-- Covers three tables:
--   user_profiles   — already created; this adds the policies and the trigger
--                     that fills it, without which it stays empty forever.
--   projects        — read by the dashboard, and not yet created.
--   mcp_connections — the MCP servers configured in account settings.

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
  prompt      text,
  status      text not null default 'Draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- For anyone who ran an earlier copy of this file, before the New project
-- dialog stored the prompt it collects.
alter table public.projects add column if not exists prompt text;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- mcp_connections — one row per MCP server a user has configured.
--
-- server_id is the catalogue id ('stitch', 'memory', 'supabase', 'notion') or
-- 'custom:<uuid>' for a server the user added by hand; name and url are filled
-- for those only.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.mcp_connections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  server_id   text not null,
  name        text,
  url         text,
  api_key     text,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, server_id)
);

alter table public.mcp_connections enable row level security;

drop policy if exists "Owners read their MCP connections" on public.mcp_connections;
create policy "Owners read their MCP connections"
  on public.mcp_connections for select
  using (auth.uid() = user_id);

drop policy if exists "Owners create their MCP connections" on public.mcp_connections;
create policy "Owners create their MCP connections"
  on public.mcp_connections for insert
  with check (auth.uid() = user_id);

drop policy if exists "Owners update their MCP connections" on public.mcp_connections;
create policy "Owners update their MCP connections"
  on public.mcp_connections for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Owners delete their MCP connections" on public.mcp_connections;
create policy "Owners delete their MCP connections"
  on public.mcp_connections for delete
  using (auth.uid() = user_id);

-- RLS keeps one user out of another's rows, but the owner's own browser could
-- still read the key back — and anything that can run script in that page could
-- read it too. Column privileges make api_key write-only: it can be set and
-- replaced, never selected. The settings pane therefore shows "Connected"
-- rather than the key itself, which is all it needs.
revoke all on public.mcp_connections from anon, authenticated;
grant select (id, user_id, server_id, name, url, enabled, created_at, updated_at)
  on public.mcp_connections to authenticated;
grant insert (user_id, server_id, name, url, api_key, enabled)
  on public.mcp_connections to authenticated;
grant update (server_id, name, url, api_key, enabled)
  on public.mcp_connections to authenticated;
grant delete on public.mcp_connections to authenticated;

drop trigger if exists mcp_connections_set_updated_at on public.mcp_connections;
create trigger mcp_connections_set_updated_at
  before update on public.mcp_connections
  for each row execute function public.set_updated_at();

create index if not exists mcp_connections_user_id_idx
  on public.mcp_connections (user_id);
