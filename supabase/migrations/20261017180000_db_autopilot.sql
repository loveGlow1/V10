-- The database autopilot's switch: whether QuickStark may apply purely
-- additive database changes an app needs (new tables, their indexes and
-- access rules, optional columns) without the owner pressing Approve. On by
-- default; turned off from the Database panel. Everything that is not purely
-- additive always waits for Approve, whatever this says. See
-- src/lib/builder/backend/agent/autopilot.ts.

alter table public.project_backends
  add column if not exists db_autopilot boolean not null default true;

comment on column public.project_backends.db_autopilot is
  'Whether purely additive database changes the app needs are applied without Approve. Destructive, modifying and access changes to existing tables always wait.';

notify pgrst, 'reload schema';
