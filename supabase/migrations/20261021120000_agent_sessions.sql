-- Agent chat sessions (/session/[id]): a conversation with the coding agent,
-- stored as typed message parts — never as a plain string. See
-- src/lib/agent/persist.ts for the part shapes and src/app/api/agent/route.ts
-- for the writer.

create table if not exists public.agent_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  project_id  uuid references public.projects (id) on delete set null,
  title       text,
  preview_url text,
  created_at  timestamptz default now()
);

create table if not exists public.agent_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references public.agent_sessions on delete cascade not null,
  role        text check (role in ('user', 'assistant')) not null,
  parts       jsonb not null default '[]',
  created_at  timestamptz default now()
);

create index if not exists agent_sessions_user_idx on public.agent_sessions (user_id, created_at desc);
create index if not exists agent_messages_session_idx on public.agent_messages (session_id, created_at);

alter table public.agent_sessions enable row level security;
alter table public.agent_messages enable row level security;

drop policy if exists "own sessions" on public.agent_sessions;
create policy "own sessions" on public.agent_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own messages" on public.agent_messages;
create policy "own messages" on public.agent_messages
  for all using (
    exists (select 1 from public.agent_sessions s
            where s.id = session_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.agent_sessions s
            where s.id = session_id and s.user_id = auth.uid())
  );

revoke all on public.agent_sessions from anon;
revoke all on public.agent_messages from anon;
grant select, insert, update, delete on public.agent_sessions to authenticated;
grant select, insert, update, delete on public.agent_messages to authenticated;

-- Screenshots the agent takes, under snapshots/{sessionId}/{timestamp}.png.
-- Private: read through signed URLs the server issues, written only by the
-- service role.
insert into storage.buckets (id, name, public)
values ('snapshots', 'snapshots', false)
on conflict (id) do nothing;
