-- Conversations, one per session (src/lib/project-messages.ts, ChatPanel).
--
-- Every visit to a workspace starts a fresh thread; earlier ones stay, listed
-- under Chats, and can be reopened. A message belongs to one thread. Writers
-- that do not name a thread (the build, the save step, video and flier
-- announcements) land in the project's most recently active thread, which is
-- the one the person is talking in: the panel touches it before every request.

create table if not exists public.project_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists project_threads_recent_idx on public.project_threads (project_id, last_message_at desc);

alter table public.project_threads enable row level security;

create policy project_threads_owner_select on public.project_threads for select using (auth.uid() = user_id);
create policy project_threads_owner_insert on public.project_threads for insert with check (auth.uid() = user_id);
create policy project_threads_owner_update on public.project_threads for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy project_threads_owner_delete on public.project_threads for delete using (auth.uid() = user_id);

alter table public.project_messages
  add column if not exists thread_id uuid references public.project_threads(id) on delete cascade;

create index if not exists project_messages_thread_idx on public.project_messages (thread_id, created_at);

-- A message without a thread goes to the project's most recently active one
-- (made when there is none), and that thread's clock and title follow it.
create or replace function public.project_messages_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.thread_id is null then
    select id into new.thread_id
      from public.project_threads
     where project_id = new.project_id
     order by last_message_at desc
     limit 1;
    if new.thread_id is null then
      insert into public.project_threads (project_id, user_id, title)
      values (new.project_id, new.user_id, left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 80))
      returning id into new.thread_id;
    end if;
  end if;
  update public.project_threads
     set last_message_at = greatest(last_message_at, now()),
         title = case when title = '' and new.role = 'you' then left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 80) else title end
   where id = new.thread_id;
  return new;
end;
$$;

create or replace trigger project_messages_thread before insert on public.project_messages
  for each row execute function public.project_messages_thread();

-- What was said before threads existed: one thread per project, "Earlier conversation".
insert into public.project_threads (project_id, user_id, title, created_at, last_message_at)
select m.project_id, min(m.user_id::text)::uuid, 'Earlier conversation', min(m.created_at), max(m.created_at)
  from public.project_messages m
 where m.thread_id is null
   and not exists (select 1 from public.project_threads t where t.project_id = m.project_id)
 group by m.project_id;

update public.project_messages m
   set thread_id = t.id
  from public.project_threads t
 where m.thread_id is null and t.project_id = m.project_id and t.title = 'Earlier conversation';
