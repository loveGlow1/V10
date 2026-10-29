-- Apply once the server-side connect (authorize route + verifyConnector) is
-- live: the browser no longer switches anything on, so the bridge from
-- 20261029210000 comes down, and connections it allowed that were never real
-- go — Memory had no server, and Hugging Face now signs in.

revoke insert, update on public.mcp_connections from authenticated;
grant insert (user_id, server_id, name, url) on public.mcp_connections to authenticated;

drop trigger if exists mcp_connections_browser_guard on public.mcp_connections;
drop function if exists public.mcp_connections_browser_guard();

delete from public.mcp_connections
where server_id = 'memory'
   or (server_id = 'huggingface' and auth <> 'oauth');
