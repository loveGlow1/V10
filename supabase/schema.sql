-- QuickStark.Ai — Supabase schema.
--
-- Safe to run more than once. Paste the whole file into the SQL editor
-- (Supabase Studio → SQL Editor → New query) and run it.
--
-- Covers eight tables:
--   user_profiles   — already created; this adds the policies and the trigger
--                     that fills it, without which it stays empty forever.
--   projects        — read by the dashboard, and not yet created.
--   mcp_connections — the MCP servers configured in account settings.
--   credit_plans    — what each plan grants (mirrors PLANS in credits.ts).
--   credit_balances — one row per account: daily, rollover, monthly, top-up.
--   credit_ledger   — append-only record of every credit movement.
--   documents          — the n8n agent's RAG knowledge base (pgvector).
--   n8n_chat_histories — that same agent's conversation memory.

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared helper: keep updated_at honest without the client having to set it.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
-- Pinned, so the function cannot be pointed at a shadowed now() by whatever
-- schema list the caller happens to carry. Flagged by the database linter.
set search_path = ''
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
--
-- It also opens the new account's credit balance, carrying the signup bonus.
-- That belongs here rather than in the application because an account can be
-- created by an OAuth callback, an email confirmation or a hand-made row in the
-- Supabase dashboard, and every one of those must arrive with the same credit.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Scalars rather than a credit_plans%rowtype: a composite type is resolved
  -- when the function is created, and the credit tables are defined further
  -- down this file. The queries below resolve at call time, which is after the
  -- whole file has been applied.
  v_daily   numeric(10,2);
  v_monthly numeric(10,2);
  v_bonus   numeric(10,2);
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

  select daily_credits, monthly_credits into v_daily, v_monthly
    from public.credit_plans where id = 'free';
  v_bonus := public.signup_bonus_credits();

  -- The bonus goes to the top-up bucket, which is the one that never expires
  -- and is spent last: a gift should still be there tomorrow, and the day's
  -- free allowance should be used before it.
  insert into public.credit_balances (user_id, plan_id, daily, monthly, top_up)
  values (new.id, 'free', v_daily, v_monthly, v_bonus)
  on conflict (user_id) do nothing;

  -- Recorded like any other movement, so a balance is always explainable from
  -- the ledger rather than appearing from nowhere.
  if v_bonus > 0 then
    insert into public.credit_ledger (user_id, action, credits, description)
    values (new.id, 'grant', v_bonus, 'Welcome credit');
  end if;

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

-- What a build returns. The orchestrator (n8n) writes these back when a build
-- finishes, so the workspace can show the preview and the repository after a
-- reload rather than only in the reply that started them.
--
--   intent      which branch the classifier chose: webapp | wordpress |
--               ecommerce | unclassified
--   preview_url where the built app can be seen
--   repo_url    the repository holding its code
--   admin_url   the CMS or store admin, where the stack has one
--
-- Nullable throughout: a project exists from the moment it is named, long
-- before any of these have an answer.
alter table public.projects add column if not exists intent text;
alter table public.projects add column if not exists preview_url text;
alter table public.projects add column if not exists repo_url text;
alter table public.projects add column if not exists admin_url text;
alter table public.projects add column if not exists last_build_at timestamptz;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- The credit economy — credit_plans, credit_balances, credit_ledger.
--
-- The rules these tables enforce are written out in src/app/dashboard/credits.ts;
-- what lives here is everything that must not be decided in a browser. A balance
-- the client could write is not a balance, so no policy below grants insert or
-- update on it to anyone: the only way credits move is public.spend_credits(),
-- which locks the row, drains the buckets in the right order and writes the
-- ledger in one transaction.
--
-- Division of labour with the application:
--   * what an ACTION COSTS is decided in TypeScript (creditCostOf) and passed in,
--     so the composer can preview a charge with the same arithmetic that takes it;
--   * what a PLAN GRANTS is decided here, because daily and cycle renewal have to
--     happen for accounts that are not currently making a request.
-- credit_plans is therefore the mirror of PLANS in credits.ts — change both.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.credit_plans (
  id                text primary key,
  name              text not null,
  monthly_price_usd numeric(10,2) not null,
  -- Refilled every day; whatever is left over is discarded.
  daily_credits     numeric(10,2) not null,
  -- Granted at the top of each billing cycle.
  monthly_credits   numeric(10,2) not null,
  -- Cycles an unused monthly credit survives. 0 = expires with the cycle.
  rollover_cycles   integer not null default 0
);

insert into public.credit_plans (id, name, monthly_price_usd, daily_credits, monthly_credits, rollover_cycles)
values
  ('free',     'Free',       0,   5, 0,   0),
  ('standard', 'Standard',  25,   5, 100, 1),
  ('pro',      'Pro',      150,   5, 600, 1)
on conflict (id) do update set
  name              = excluded.name,
  monthly_price_usd = excluded.monthly_price_usd,
  daily_credits     = excluded.daily_credits,
  monthly_credits   = excluded.monthly_credits,
  rollover_cycles   = excluded.rollover_cycles;

alter table public.credit_plans enable row level security;

-- Plans are public knowledge — they are on the pricing page — so any signed-in
-- account may read them. Nobody may write them from the client.
drop policy if exists "Signed-in users read plans" on public.credit_plans;
create policy "Signed-in users read plans"
  on public.credit_plans for select
  to authenticated
  using (true);

-- Table privileges as well as policies, so the tables do not depend on whatever
-- default grants a project happens to have. RLS decides which rows; these decide
-- which verbs — and no verb but select is granted anywhere below.
revoke all on public.credit_plans from anon, authenticated;
grant select on public.credit_plans to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The welcome credit every new account arrives with.
--
-- Counted in credits, which is what the account holds and what every screen
-- shows; at the top-up pack's rate of fifty credits for ten dollars, this is
-- two dollars' worth. Mirrors SIGNUP_BONUS_CREDITS in
-- src/app/dashboard/credits.ts.
--
-- Read by handle_new_user() above, which runs after this file has been applied
-- in full, so the definition order here does not matter at runtime.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.signup_bonus_credits()
returns numeric
language sql
immutable
set search_path = ''
as $$
  select 10::numeric(10,2);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- credit_balances — one row per account, four buckets.
--
-- Four columns rather than one number because they expire at different times,
-- and the order they are spent in is the difference between a user losing
-- credits and not: daily first (gone tonight), then rollover (gone this cycle),
-- then this cycle's grant, then top-ups, which were paid for outright and never
-- expire.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.credit_balances (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  plan_id            text not null default 'free' references public.credit_plans (id),
  daily              numeric(10,2) not null default 0 check (daily >= 0),
  monthly            numeric(10,2) not null default 0 check (monthly >= 0),
  rollover           numeric(10,2) not null default 0 check (rollover >= 0),
  top_up             numeric(10,2) not null default 0 check (top_up >= 0),
  -- The day the daily bucket was last refilled, and the day the current billing
  -- cycle opened. Both are dates in UTC so a renewal cannot be triggered twice
  -- by a user changing time zone.
  daily_refreshed_on date not null default (now() at time zone 'utc')::date,
  cycle_started_on   date not null default (now() at time zone 'utc')::date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.credit_balances enable row level security;

-- Read-only from the client, deliberately. There is no insert, update or delete
-- policy: a browser that could write this table could grant itself credits.
drop policy if exists "Owners read their balance" on public.credit_balances;
create policy "Owners read their balance"
  on public.credit_balances for select
  using (auth.uid() = user_id);

-- Belt and braces: with no insert/update/delete privilege, a client cannot write
-- this table even if a policy were ever added by mistake.
revoke all on public.credit_balances from anon, authenticated;
grant select on public.credit_balances to authenticated;

drop trigger if exists credit_balances_set_updated_at on public.credit_balances;
create trigger credit_balances_set_updated_at
  before update on public.credit_balances
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- credit_ledger — append-only, one row per credit movement.
--
-- Every charge, grant and top-up lands here, including the zero-credit ones:
-- a publish costs nothing and is still recorded, because "was I charged for
-- deploying?" has to be answerable from the data rather than from trust.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- The four billable categories, plus the two ways credits arrive.
  action        text not null check (action in ('chat', 'generate', 'publish', 'runtime', 'grant', 'topup')),
  -- Negative for a charge, positive for a grant or a purchase.
  credits       numeric(10,2) not null,
  -- What the charge was for, in the user's language ("Added checkout page").
  description   text,
  project_id    uuid references public.projects (id) on delete set null,
  -- The usage the charge was priced from, kept so a disputed charge can be
  -- recomputed rather than argued about.
  output_tokens integer,
  files_touched integer,
  created_at    timestamptz not null default now()
);

alter table public.credit_ledger enable row level security;

-- Same shape as the balance: readable by its owner, written only by the
-- security-definer function below.
drop policy if exists "Owners read their ledger" on public.credit_ledger;
create policy "Owners read their ledger"
  on public.credit_ledger for select
  using (auth.uid() = user_id);

-- Append-only from the application's point of view: only spend_credits and
-- grant_credits write here, and they run as the definer.
revoke all on public.credit_ledger from anon, authenticated;
grant select on public.credit_ledger to authenticated;

create index if not exists credit_ledger_user_id_created_at_idx
  on public.credit_ledger (user_id, created_at desc);

-- Every account needs a balance the first time it is looked at. Rather than a
-- second signup trigger that could fall out of step with the first, the balance
-- is created on demand by the function below.
create or replace function public.ensure_credit_balance(p_user_id uuid)
returns public.credit_balances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance public.credit_balances;
  v_plan    public.credit_plans;
  v_today   date := (now() at time zone 'utc')::date;
begin
  -- The lock is what makes two concurrent charges safe: the second waits here
  -- rather than reading a balance the first is about to change.
  select * into v_balance from public.credit_balances
    where user_id = p_user_id
    for update;

  if not found then
    select * into v_plan from public.credit_plans where id = 'free';
    insert into public.credit_balances (user_id, plan_id, daily, monthly)
      values (p_user_id, 'free', v_plan.daily_credits, v_plan.monthly_credits)
      returning * into v_balance;
    return v_balance;
  end if;

  select * into v_plan from public.credit_plans where id = v_balance.plan_id;

  -- A new day: refill the daily grant and drop yesterday's remainder.
  if v_balance.daily_refreshed_on < v_today then
    v_balance.daily := v_plan.daily_credits;
    v_balance.daily_refreshed_on := v_today;
  end if;

  -- A new cycle: this cycle's unused grant becomes the rollover on a plan that
  -- allows one, the previous rollover expires, and top-ups survive untouched.
  if v_balance.cycle_started_on + interval '1 month' <= v_today then
    v_balance.rollover := case when v_plan.rollover_cycles > 0 then v_balance.monthly else 0 end;
    v_balance.monthly := v_plan.monthly_credits;
    v_balance.cycle_started_on := v_today;
  end if;

  update public.credit_balances set
    daily = v_balance.daily,
    monthly = v_balance.monthly,
    rollover = v_balance.rollover,
    daily_refreshed_on = v_balance.daily_refreshed_on,
    cycle_started_on = v_balance.cycle_started_on
  where user_id = p_user_id
  returning * into v_balance;

  return v_balance;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- spend_credits — the only way credits leave an account.
--
-- Takes a cost that the application has already priced (see creditCostOf), so
-- the estimate a user is shown and the charge they receive are the same number.
-- Refuses rather than partially charging: half a generation is not something
-- the platform can deliver.
--
-- Publishing passes 0 and is recorded at 0. It is the caller's job not to price
-- a deploy, and creditCostOf returns 0 for one before it reads any signal.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.spend_credits(
  p_action        text,
  p_cost          numeric,
  p_description   text default null,
  p_project_id    uuid default null,
  p_output_tokens integer default null,
  p_files_touched integer default null
)
returns public.credit_balances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance     public.credit_balances;
  v_user_id     uuid := auth.uid();
  v_outstanding numeric(10,2);
  v_taken       numeric(10,2);
begin
  if v_user_id is null then
    raise exception 'spend_credits requires an authenticated session'
      using errcode = '28000';
  end if;

  if p_cost < 0 then
    raise exception 'a charge cannot be negative' using errcode = '22023';
  end if;

  v_balance := public.ensure_credit_balance(v_user_id);

  if p_cost > v_balance.daily + v_balance.rollover + v_balance.monthly + v_balance.top_up then
    raise exception 'insufficient credits: % required, % available',
      p_cost, v_balance.daily + v_balance.rollover + v_balance.monthly + v_balance.top_up
      using errcode = '53400';
  end if;

  -- Soonest to expire first.
  v_outstanding := p_cost;

  v_taken := least(v_balance.daily, v_outstanding);
  v_balance.daily := v_balance.daily - v_taken;
  v_outstanding := v_outstanding - v_taken;

  v_taken := least(v_balance.rollover, v_outstanding);
  v_balance.rollover := v_balance.rollover - v_taken;
  v_outstanding := v_outstanding - v_taken;

  v_taken := least(v_balance.monthly, v_outstanding);
  v_balance.monthly := v_balance.monthly - v_taken;
  v_outstanding := v_outstanding - v_taken;

  v_balance.top_up := v_balance.top_up - v_outstanding;

  update public.credit_balances set
    daily = v_balance.daily,
    rollover = v_balance.rollover,
    monthly = v_balance.monthly,
    top_up = v_balance.top_up
  where user_id = v_user_id
  returning * into v_balance;

  insert into public.credit_ledger
    (user_id, action, credits, description, project_id, output_tokens, files_touched)
  values
    (v_user_id, p_action, -p_cost, p_description, p_project_id, p_output_tokens, p_files_touched);

  return v_balance;
end;
$$;

-- Adds bought credits to the pool. Called by a payment webhook once a charge
-- has settled — never from the browser, which is why it takes the account as an
-- argument instead of reading auth.uid(), and why execute is not granted below.
create or replace function public.grant_credits(
  p_user_id     uuid,
  p_credits     numeric,
  p_action      text default 'topup',
  p_description text default null
)
returns public.credit_balances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance public.credit_balances;
begin
  if p_credits <= 0 then
    raise exception 'a grant must be positive' using errcode = '22023';
  end if;

  perform public.ensure_credit_balance(p_user_id);

  update public.credit_balances
    set top_up = top_up + p_credits
    where user_id = p_user_id
    returning * into v_balance;

  insert into public.credit_ledger (user_id, action, credits, description)
    values (p_user_id, p_action, p_credits, p_description);

  return v_balance;
end;
$$;

-- A signed-in account may spend its own credits and read its own balance. It
-- may not grant itself any: grant_credits is left executable only by the
-- service role, which is what the payment webhook runs as.
revoke all on function public.spend_credits(text, numeric, text, uuid, integer, integer) from public, anon;
grant execute on function public.spend_credits(text, numeric, text, uuid, integer, integer) to authenticated;

revoke all on function public.ensure_credit_balance(uuid) from public, anon, authenticated;
revoke all on function public.grant_credits(uuid, numeric, text, text) from public, anon, authenticated;

-- Trigger functions have no business being callable over the REST API. Postgres
-- checks EXECUTE when a trigger is created rather than when it fires, so this
-- leaves on_auth_user_created and the updated_at triggers working while taking
-- /rest/v1/rpc/handle_new_user off the API surface.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Privilege tightening
--
-- Two things RLS does not cover, because neither is about which rows a caller
-- may see.
-- ─────────────────────────────────────────────────────────────────────────────

-- mcp_connections.api_key holds third-party keys. The app writes it and never
-- reads it back (AccountSettingsModal selects server_id, name, url, enabled),
-- so making it write-only over the API costs nothing and means a stored key
-- cannot be fetched again through PostgREST. service_role still reads it.
revoke select (api_key) on public.mcp_connections from anon, authenticated;

-- rls_auto_enable() is SECURITY DEFINER maintenance tooling, and nothing in the
-- app calls it. Postgres grants EXECUTE on a new function to PUBLIC, so
-- revoking from anon and authenticated alone leaves it reachable through that
-- default — PUBLIC has to go first, or it stays callable unauthenticated at
-- /rest/v1/rpc/rls_auto_enable.
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon, authenticated;
grant execute on function public.rls_auto_enable() to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- The n8n agent — documents, n8n_chat_histories.
--
-- Backs the "AI Agent with Postgres Memory and Supabase RAG" workflow in n8n
-- (workflow id tgLFph6yjJ5q8nDL). Two independent paths reach these tables, and
-- the difference matters for how they are secured:
--
--   documents          — over PostgREST, with the service_role key, by the two
--                        Supabase Vector Store nodes.
--   n8n_chat_histories — over the session pooler on port 5432, as the postgres
--                        role, by the Postgres Chat Memory node.
--
-- Both of those roles carry BYPASSRLS, which is what makes the policy-free RLS
-- below workable rather than merely restrictive.
-- ─────────────────────────────────────────────────────────────────────────────

-- pgvector lands in extensions rather than public: the database linter flags
-- extensions in public, and Supabase's own pgvector guidance schema-qualifies
-- it. Every vector type below is written extensions.vector for that reason.
create extension if not exists vector with schema extensions;

-- Column names are not free choices — LangChain's SupabaseVectorStore writes
-- content/metadata/embedding by those exact names, so renaming any of them
-- breaks ingestion silently rather than loudly.
--
-- 1536 dimensions is text-embedding-3-small, which both embeddings nodes in the
-- workflow are pinned to. The pinning is deliberate: a model swap changes the
-- dimension, and a dimension mismatch is rejected at insert time by this column.
create table if not exists public.documents (
  id bigserial primary key,
  content text,
  metadata jsonb,
  embedding extensions.vector(1536)
);

-- HNSW with cosine ops, matching the <=> operator match_documents orders by.
-- An index built for a different operator class is simply not used by that
-- query, so the two have to be chosen together.
create index if not exists documents_embedding_hnsw_idx
  on public.documents
  using hnsw (embedding extensions.vector_cosine_ops);

-- For the `metadata @> filter` containment test below.
create index if not exists documents_metadata_gin_idx
  on public.documents
  using gin (metadata);

-- PostgREST cannot express the pgvector distance operators, so similarity search
-- has to be reached as an RPC. The name match_documents is the n8n node default
-- and is set explicitly on both vector store nodes.
--
-- Left SECURITY INVOKER (the default). It reads a table whose RLS the caller is
-- expected to bypass on its own credentials; making it DEFINER would hand anon
-- a read of the whole knowledge base through /rest/v1/rpc/match_documents.
create or replace function public.match_documents (
  query_embedding extensions.vector(1536),
  match_count int default null,
  filter jsonb default '{}'
) returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
-- Not set to '' like the helpers above: the body has to resolve both the
-- documents table and pgvector's operators, so both schemas are named.
set search_path = public, extensions
as $$
#variable_conflict use_column
begin
  return query
  select
    id,
    content,
    metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where metadata @> filter
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Shape copied exactly from LangChain's PostgresChatMessageHistory.ensureTable().
-- The node issues its own CREATE TABLE IF NOT EXISTS on first message; matching
-- it column for column turns that into a no-op instead of leaving the table to
-- be created on a first run that has to succeed for the agent to answer at all.
create table if not exists public.n8n_chat_histories (
  id serial primary key,
  session_id text not null,
  message jsonb not null
);

-- Every read the memory node makes is by session_id.
create index if not exists n8n_chat_histories_session_id_idx
  on public.n8n_chat_histories (session_id);

-- RLS on with no policies, the same posture the rest of this file takes: the two
-- roles that need these tables bypass RLS, so the agent is unaffected, while the
-- anon key gets nothing. That matters more here than elsewhere — both tables sit
-- in the API-exposed public schema, and between them they hold the whole
-- knowledge base and every conversation anyone has had with the agent.
alter table public.documents enable row level security;
alter table public.n8n_chat_histories enable row level security;

-- Neither table is touched by the web app; n8n owns both. Withholding the
-- privileges as well as the policies means a future policy added by mistake
-- still does not expose them.
revoke all on public.documents from anon, authenticated;
revoke all on public.n8n_chat_histories from anon, authenticated;

-- match_documents is invoker-rights, so a caller without table privileges gets
-- nothing from it anyway. Revoking EXECUTE keeps it off the API surface
-- entirely. PUBLIC first — Postgres grants EXECUTE on a new function to PUBLIC,
-- and revoking from anon and authenticated alone leaves that default in place.
revoke execute on function public.match_documents(extensions.vector, int, jsonb) from public;
revoke execute on function public.match_documents(extensions.vector, int, jsonb) from anon, authenticated;
grant execute on function public.match_documents(extensions.vector, int, jsonb) to service_role;
