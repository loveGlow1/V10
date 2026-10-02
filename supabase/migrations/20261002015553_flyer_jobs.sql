create table public.flyer_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  site_id uuid,
  status text not null default 'queued'
    check (status in ('queued','running','done','failed')),
  request jsonb not null,
  outputs jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.flyer_jobs enable row level security;
create policy "flyer_jobs_select_own" on public.flyer_jobs
  for select using (auth.uid() = user_id);
create policy "flyer_jobs_insert_own" on public.flyer_jobs
  for insert with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.flyer_jobs;

insert into storage.buckets (id, name, public)
values ('flyers', 'flyers', false)
on conflict (id) do nothing;

create policy "flyers_read_own" on storage.objects
  for select using (
    bucket_id = 'flyers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
