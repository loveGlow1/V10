-- A video made from Home opens in the same workspace as a website: its
-- workspace project, linked here. Null for videos made before this.
alter table public.video_projects
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists video_projects_project_id_idx
  on public.video_projects (project_id)
  where project_id is not null;
