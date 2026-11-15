-- Every account's first three videos made of its own clips export free.
-- One row per video that used a free export. No foreign key to the video on
-- purpose: deleting the video does not give the free export back.
create table if not exists public.free_exports (
  user_id    uuid not null references auth.users (id) on delete cascade,
  video_id   uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

alter table public.free_exports enable row level security;

drop policy if exists "free_exports_select_own" on public.free_exports;
create policy "free_exports_select_own" on public.free_exports
  for select using (auth.uid() = user_id);

-- Claims a free export for this video: true when the video already has one,
-- or the account still has one left (then it is recorded). The lock makes two
-- exports at once unable to take the same last free slot.
create or replace function public.claim_free_export(p_user_id uuid, p_video_id uuid, p_limit int default 3)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used int;
begin
  perform pg_advisory_xact_lock(hashtext('free_exports:' || p_user_id::text));
  if exists (select 1 from public.free_exports where user_id = p_user_id and video_id = p_video_id) then
    return true;
  end if;
  select count(*) into v_used from public.free_exports where user_id = p_user_id;
  if v_used >= p_limit then
    return false;
  end if;
  insert into public.free_exports (user_id, video_id) values (p_user_id, p_video_id);
  return true;
end;
$$;

revoke all on function public.claim_free_export(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_free_export(uuid, uuid, int) to service_role;
