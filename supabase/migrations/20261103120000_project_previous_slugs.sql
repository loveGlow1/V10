-- Addresses a project used to answer on, newest last.
--
-- Renaming an app now moves its address with it (my-shop → new-name), and an
-- address somebody already shared must not go dark when that happens: the
-- published site and the /<slug>/preview link both look a slug up here when no
-- project has it any more, and redirect to where the project lives now.
alter table public.projects
  add column if not exists previous_slugs text[] not null default '{}'::text[];

create index if not exists projects_previous_slugs_idx
  on public.projects using gin (previous_slugs);
