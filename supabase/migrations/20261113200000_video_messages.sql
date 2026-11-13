-- The Director's chat in the video studio, kept message by message, in
-- sessions: what the person asked (stored the moment they send it, whatever
-- happens next) and what the Director answered. A new session starts a
-- fresh conversation; the earlier ones stay listed.
create table if not exists public.video_messages (
  id         uuid primary key default gen_random_uuid(),
  video_id   uuid not null references public.video_projects (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session    integer not null default 1 check (session >= 1),
  role       text not null check (role in ('user', 'director')),
  text       text not null check (char_length(text) <= 8000),
  version    integer,
  failed     boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists video_messages_video_idx on public.video_messages (video_id, session, created_at);

alter table public.video_messages enable row level security;

create policy video_messages_owner_select on public.video_messages for select using (user_id = auth.uid());
create policy video_messages_owner_insert on public.video_messages for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.video_projects p where p.id = video_id and p.user_id = auth.uid())
);
create policy video_messages_owner_delete on public.video_messages for delete using (user_id = auth.uid());
