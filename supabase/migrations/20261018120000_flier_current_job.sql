-- Which of a flier's sets of versions is showing — moved by Undo, Redo and
-- the Versions list, and the set the next change is made from. Null means
-- the newest set, which is what every new set resets it to.
alter table public.projects
  add column if not exists flier_current_job uuid references public.flyer_jobs(id) on delete set null;
