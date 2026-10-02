alter table public.flyer_jobs
  add column if not exists stage text not null default 'preview'
    check (stage in ('preview','final')),
  add column if not exists parent_job_id uuid
    references public.flyer_jobs(id) on delete set null;
