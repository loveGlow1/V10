-- Supabase security advisor findings, fixed.
--
-- spend_credits: a signed-in browser could call it and name the price of its
-- own charge. Every charge goes through spend_credits_for on the server now
-- (the app's service key is live), so its EXECUTE comes off `authenticated` —
-- what supabase/close-spend-credits.sql was written to do once that was true.
--
-- touch_project, soft_delete_project, restore_project: SECURITY INVOKER rather
-- than DEFINER. Each only updates the caller's own project, and the caller may
-- already do exactly that themselves — "Owners update their projects" (RLS) and
-- the column grants cover last_opened_at, archived_at and deleted_at — so the
-- raised privilege bought nothing and RLS now stands behind the auth.uid()
-- filter too.
--
-- wa_contacts_upsert (the WhatsApp engine's trigger, n8n/whatsapp/schema.sql):
-- a fixed search_path, so it resolves wa_contacts in public whatever the
-- caller's path. Mirrors supabase/schema.sql.

revoke execute on function public.spend_credits(text, numeric, text, uuid, integer, integer) from authenticated;

create or replace function public.touch_project(p_project_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.projects
     set last_opened_at = now(),
         archived_at    = null          -- opening un-archives
   where id = p_project_id
     and user_id = auth.uid()
     and deleted_at is null;
end;
$$;

create or replace function public.soft_delete_project(p_project_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.projects
     set deleted_at = now()
   where id = p_project_id
     and user_id = auth.uid();
end;
$$;

create or replace function public.restore_project(p_project_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.projects
     set deleted_at = null
   where id = p_project_id
     and user_id = auth.uid();
end;
$$;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'wa_contacts_upsert') then
    alter function public.wa_contacts_upsert() set search_path = public;
  end if;
end $$;
