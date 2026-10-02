-- ─────────────────────────────────────────────────────────────────────────────
-- Connect GitHub — pushing an app's code to a repository its owner controls.
--
-- github_connections holds the OAuth token a person grants when they press
-- Connect GitHub (src/lib/github/oauth.ts). A token with the `repo` scope is
-- write access to every repository they can reach, so it is sealed with
-- AES-256-GCM before it arrives here, and NO browser role can read, write or
-- even see this table: every privilege is revoked from anon and authenticated,
-- and there are deliberately no policies. Only the service role touches it.
--
-- project_github_repos is which repository each project pushes to. Written
-- only by /api/projects/[id]/github with the service role; owners may read
-- their own rows.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.github_connections (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  access_token  text not null,
  -- Null for an OAuth App token, which never expires. A GitHub App with
  -- expiring user tokens fills both.
  refresh_token text,
  expires_at    timestamptz,
  scope         text,
  login         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.github_connections enable row level security;
revoke all on public.github_connections from anon, authenticated;

comment on table public.github_connections is 'Sealed GitHub OAuth tokens from Connect GitHub. Service role only: RLS on with no policy BY DESIGN, and all grants revoked from anon and authenticated.';

drop trigger if exists github_connections_set_updated_at on public.github_connections;
create trigger github_connections_set_updated_at
  before update on public.github_connections
  for each row execute function public.set_updated_at();

create table if not exists public.project_github_repos (
  project_id      uuid primary key references public.projects (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  owner           text not null,
  repo            text not null,
  branch          text not null default 'main',
  html_url        text not null,
  private         boolean not null default true,
  last_commit_sha text,
  pushed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.project_github_repos enable row level security;
revoke all on public.project_github_repos from anon, authenticated;
grant select on public.project_github_repos to authenticated;

drop policy if exists "Owners read their GitHub links" on public.project_github_repos;
create policy "Owners read their GitHub links"
  on public.project_github_repos for select
  using (auth.uid() = user_id);

drop trigger if exists project_github_repos_set_updated_at on public.project_github_repos;
create trigger project_github_repos_set_updated_at
  before update on public.project_github_repos
  for each row execute function public.set_updated_at();
