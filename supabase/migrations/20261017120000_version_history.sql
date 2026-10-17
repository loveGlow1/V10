-- Version history: telling versions apart, and finding one by what it showed.
-- Mirrored at the end of supabase/schema.sql. See src/lib/builder/versions.ts.

create or replace function public.project_version_digests(p_project_id uuid)
returns table (build_id uuid, digest text)
language sql
stable
security definer
set search_path = public
as $$
  select b.id,
         md5(coalesce(b.html, '') || '|' || coalesce((
           select string_agg(f.path || ':' || md5(f.content), ',' order by f.path)
           from public.project_files f
           where f.build_id = b.id
         ), ''))
  from public.project_builds b
  where b.project_id = p_project_id;
$$;

-- Whether a file's visible text shows every term: each as a whole word inside
-- a text node (between > and <), so a word in code or an attribute is not it.
create or replace function public.shows_terms(p_content text, p_terms text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select cardinality(p_terms) > 0 and not exists (
    select 1
    from unnest(p_terms) as t(term)
    where t.term !~ '^[a-z0-9]{2,40}$'
       or coalesce(p_content, '') !~* ('>[^<{]*\m' || t.term || '\M[^<{]*<')
  );
$$;

-- Versions that showed the terms somewhere the current version does not:
-- a file (or the page itself) that shows them all, where the same file in
-- p_current is missing or does not. "When it had the rent and buy" means the
-- place that lost them, not a filter on another page that never changed.
create or replace function public.project_versions_showing(p_project_id uuid, p_terms text[], p_current uuid)
returns table (build_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    select b.id, f.path, f.content
    from public.project_builds b
    join public.project_files f on f.build_id = b.id
    where b.project_id = p_project_id
    union all
    select b.id, '<page>', b.html
    from public.project_builds b
    where b.project_id = p_project_id
  ),
  current_files as (
    select f.path, f.content from public.project_files f where f.build_id = p_current
    union all
    select '<page>', b.html from public.project_builds b where b.id = p_current
  )
  select distinct c.id
  from candidates c
  where public.shows_terms(c.content, p_terms)
    and not exists (
      select 1 from current_files cur
      where cur.path = c.path and public.shows_terms(cur.content, p_terms)
    );
$$;


revoke all on function public.project_version_digests(uuid) from public, anon, authenticated;
revoke all on function public.project_versions_showing(uuid, text[], uuid) from public, anon, authenticated;
grant execute on function public.project_version_digests(uuid) to service_role;
grant execute on function public.project_versions_showing(uuid, text[], uuid) to service_role;
