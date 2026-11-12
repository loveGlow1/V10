-- The test a web app with sign-in must pass before it is Built
-- (src/lib/builder/verify-run.ts). One row per build: its state, what each
-- round of the browser test found, and the price held until it passes.

create table if not exists public.build_verifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  build_id uuid not null unique references public.project_builds(id) on delete cascade,
  request_id text,
  status text not null default 'checking' check (status in ('checking', 'passed', 'failed', 'skipped')),
  attempts integer not null default 0,
  checks jsonb not null default '[]'::jsonb,
  reason text,
  charge jsonb,
  charged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists build_verifications_project_idx on public.build_verifications (project_id, created_at desc);
create index if not exists build_verifications_checking_idx on public.build_verifications (updated_at) where status = 'checking';

alter table public.build_verifications enable row level security;

-- Owners can read their own; only the server writes.
create policy build_verifications_owner_read on public.build_verifications
  for select using (auth.uid() = user_id);
