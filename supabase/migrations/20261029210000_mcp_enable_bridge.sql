-- A bridge while the site still switches no-sign-in connectors on from the
-- browser (20261029200000 took that right away before the code that connects
-- them on the server had shipped, and Connect answered "permission denied").
--
-- The browser may again set `enabled` — and only that: name and url stay
-- unchangeable once saved, so a signed-in connection can never be repointed.
-- A guard keeps it to the catalogue connectors that have no sign-in: a custom
-- server or a sign-in connector is switched on only by the connect routes
-- (service role). Removed by 20261029220000 once the server-side connect ships.

grant insert (user_id, server_id, name, url, enabled) on public.mcp_connections to authenticated;
grant update (enabled) on public.mcp_connections to authenticated;

create or replace function public.mcp_connections_browser_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.enabled
     and (tg_op = 'INSERT' or not old.enabled)
     and new.server_id not in ('context7', 'huggingface', 'memory') then
    raise exception 'This connector is connected by signing in, not from the browser.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists mcp_connections_browser_guard on public.mcp_connections;
create trigger mcp_connections_browser_guard
  before insert or update on public.mcp_connections
  for each row execute function public.mcp_connections_browser_guard();
