-- ─────────────────────────────────────────────────────────────────────────────
-- The database agent — analyse, wire, and change a connected Supabase safely.
-- See docs/DATABASE-AGENT.md and src/lib/builder/backend/agent/.
--
--   project_backends.db_map       the Database Map (db-map.json): structure only,
--                                 no rows, comments flagged when they read like
--                                 instructions. Owner-readable.
--   project_backends.db_analysis  the analysis card: headline, health, production
--                                 signal.
--   project_backends.db_wiring    the wiring report, the brief the next build
--                                 writes against, generated types, data layer.
--   db_surgeries                  every planned / applied / failed change, with
--                                 its SQL, risk level, rollback and verification.
--                                 Owners read their own; only the service role
--                                 writes, so a plan cannot be edited after it
--                                 was shown.
--   db_agent_approvals            spent approval-token nonces. A token works once.
--   db_agent_audit                every tool call: who, what, when, ref, SQL hash,
--                                 result. Service role only.
--   db_agent_secrets              the connected project's secret key, sealed
--                                 (AES-256-GCM). Service role only, never returned.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.project_backends
  add column if not exists db_map jsonb,
  add column if not exists db_map_at timestamptz,
  add column if not exists db_analysis jsonb,
  add column if not exists db_wiring jsonb;

grant select (db_map, db_map_at, db_analysis, db_wiring) on public.project_backends to authenticated;

create table if not exists public.db_surgeries (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  ref              text not null,
  kind             text not null default 'migration' check (kind in ('migration', 'create_project', 'auth_config')),
  name             text not null,
  request          text,
  summary          text not null,
  level            smallint not null check (level between 0 and 3),
  status           text not null default 'planned' check (status in ('planned', 'applied', 'failed', 'cancelled', 'stale', 'undone')),
  plan             jsonb not null default '{}'::jsonb,
  sql_hash         text not null,
  map_fingerprint  text,
  confirmation     text,
  error            text,
  verification     jsonb,
  undoes           uuid references public.db_surgeries (id) on delete set null,
  created_at       timestamptz not null default now(),
  applied_at       timestamptz,
  cleanup_after    timestamptz
);

create index if not exists db_surgeries_project_idx on public.db_surgeries (project_id, created_at desc);
create index if not exists db_surgeries_user_idx on public.db_surgeries (user_id);
create index if not exists db_surgeries_undoes_idx on public.db_surgeries (undoes);

alter table public.db_surgeries enable row level security;
revoke all on public.db_surgeries from anon, authenticated;
grant select on public.db_surgeries to authenticated;

drop policy if exists "Owners read their database changes" on public.db_surgeries;
create policy "Owners read their database changes"
  on public.db_surgeries for select to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.db_agent_approvals (
  nonce       text primary key,
  project_id  uuid not null references public.projects (id) on delete cascade,
  subject     text not null,
  used_at     timestamptz not null default now()
);
create index if not exists db_agent_approvals_project_idx on public.db_agent_approvals (project_id);
alter table public.db_agent_approvals enable row level security;
revoke all on public.db_agent_approvals from anon, authenticated;

create table if not exists public.db_agent_audit (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  actor       text not null check (actor in ('agent', 'user')),
  tool        text not null,
  ref         text not null,
  sql_hash    text,
  ok          boolean not null,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists db_agent_audit_project_idx on public.db_agent_audit (project_id, created_at desc);
create index if not exists db_agent_audit_user_idx on public.db_agent_audit (user_id);
alter table public.db_agent_audit enable row level security;
revoke all on public.db_agent_audit from anon, authenticated;

create table if not exists public.db_agent_secrets (
  project_id   uuid primary key references public.projects (id) on delete cascade,
  ref          text not null,
  service_key  text not null,
  updated_at   timestamptz not null default now()
);
alter table public.db_agent_secrets enable row level security;
revoke all on public.db_agent_secrets from anon, authenticated;

comment on table public.db_agent_approvals is 'Spent database-agent approval nonces. Service role only: RLS on with no policy BY DESIGN.';
comment on table public.db_agent_audit is 'Every database-agent tool call. Service role only: RLS on with no policy BY DESIGN.';
comment on table public.db_agent_secrets is 'Sealed secret keys of connected Supabase projects. Service role only: RLS on with no policy BY DESIGN, never returned to any client or model.';
