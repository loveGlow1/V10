-- The QuickStark forms inbox: what visitors send through the forms on pages
-- that have no database of their own. Mirrored at the end of schema.sql.
-- See src/lib/forms/inbox.ts and src/app/api/forms/submit/route.ts.

create table if not exists public.form_submissions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  -- The project's owner, so RLS can answer "is this mine" without a join.
  user_id     uuid not null references auth.users (id) on delete cascade,
  form        text not null default 'contact' check (char_length(form) <= 60),
  name        text check (name is null or char_length(name) <= 120),
  email       text check (email is null or char_length(email) <= 320),
  message     text check (message is null or char_length(message) <= 5000),
  data        jsonb not null default '{}'::jsonb,
  -- A one-way token of the sender's address, for rate limiting. Never the address.
  sender      text check (sender is null or char_length(sender) <= 64),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists form_submissions_project_created_idx
  on public.form_submissions (project_id, created_at desc);
create index if not exists form_submissions_project_sender_idx
  on public.form_submissions (project_id, sender, created_at desc);

alter table public.form_submissions enable row level security;

-- Owners read their own project's messages. Every write — a visitor's
-- submission, marking read, deleting — goes through the server.
drop policy if exists "Owners read their form submissions" on public.form_submissions;
create policy "Owners read their form submissions"
  on public.form_submissions for select
  using (auth.uid() = user_id);

revoke all on public.form_submissions from anon, authenticated;
grant select on public.form_submissions to authenticated;

comment on table public.form_submissions is 'The QuickStark forms inbox: messages sent through forms on pages with no database of their own. Written only by the server (service role); owners read their own.';
