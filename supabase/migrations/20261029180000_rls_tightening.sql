-- Mirrors the last section of supabase/schema.sql.

-- ─────────────────────────────────────────────────────────────────────────────
-- Row level security, tightened (applied 2026-10-29).
--
-- Every public table has RLS on and every policy reads `auth.uid() = user_id`.
-- What that did not cover: an "insert your own row" policy that checked only
-- the row's user_id let a signed-in person write a row of theirs that POINTS
-- at another account's project or video — a message, an attachment, an agent
-- session, a video step. Its owner never saw it in their own lists, but the
-- server reads some of these by project alone (the build's "fix the database"
-- reads the project's latest live-check finding), so a planted row could
-- steer another account's build. Each such policy now also requires the
-- project or video it names to be the caller's own.
--
-- And grants, as least privilege rather than "RLS will say no":
--   anon           nothing on any public table. Every policy requires a
--                  signed-in user, so this changes no behaviour; it means a
--                  policy loosened by mistake still exposes nothing to the
--                  open internet.
--   authenticated  no TRUNCATE (which RLS does not govern), TRIGGER or
--                  REFERENCES; and nothing on the WhatsApp engine's tables,
--                  which only the service role uses (no policy reads them).
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "Owners write their messages" on public.project_messages;
create policy "Owners write their messages" on public.project_messages
  for insert with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "Owners write their attachment rows" on public.project_attachments;
create policy "Owners write their attachment rows" on public.project_attachments
  for insert with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "own sessions" on public.agent_sessions;
create policy "own sessions" on public.agent_sessions
  for all using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
  );

drop policy if exists "owner writes video_projects" on public.video_projects;
create policy "owner writes video_projects" on public.video_projects
  for insert with check (
    user_id = (select auth.uid())
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
  );
drop policy if exists "owner updates video_projects" on public.video_projects;
create policy "owner updates video_projects" on public.video_projects
  for update using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())))
  );

do $$
declare
  t text;
begin
  foreach t in array array['video_assets', 'video_renders', 'video_versions'] loop
    execute format('drop policy if exists %I on public.%I', 'owner writes ' || t, t);
    execute format(
      'create policy %I on public.%I for insert with check (user_id = (select auth.uid()) and exists (select 1 from public.video_projects v where v.id = video_id and v.user_id = (select auth.uid())))',
      'owner writes ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'owner updates ' || t, t);
    execute format(
      'create policy %I on public.%I for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and exists (select 1 from public.video_projects v where v.id = video_id and v.user_id = (select auth.uid())))',
      'owner updates ' || t, t);
  end loop;
end $$;

drop policy if exists "flyer_jobs_insert_own" on public.flyer_jobs;
create policy "flyer_jobs_insert_own" on public.flyer_jobs
  for insert with check (
    (select auth.uid()) = user_id
    and (site_id is null or exists (select 1 from public.projects p where p.id = site_id and p.user_id = (select auth.uid())))
  );

do $$
declare
  t record;
  name text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('revoke all on public.%I from anon', t.relname);
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t.relname);
  end loop;
  foreach name in array array['clients', 'inventory', 'product_catalog', 'prompt_import', 'wa_contacts', 'bot_events'] loop
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = name) then
      execute format('revoke all on public.%I from authenticated', name);
    end if;
  end loop;
end $$;
