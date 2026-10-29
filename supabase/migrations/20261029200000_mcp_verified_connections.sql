-- MCP connections are made by the server, never by a button press.
--
-- Until now the browser could insert a row with enabled = true, and that alone
-- showed a connector as "Connected" — Hugging Face and Memory among them, with
-- nothing behind it. It could also update a connection's url, which would send
-- a signed-in token to whatever host it named. Now:
--
--   * the browser may only add a custom server (name + url) switched off, and
--     delete its own rows — Disconnect is a delete;
--   * enabled, url and auth are written by the connect routes alone, after the
--     server has answered and listed tools (src/lib/mcp/runtime.ts
--     verifyConnector);
--   * rows that were never really connected are removed.

alter table public.mcp_connections alter column enabled set default false;

revoke all on public.mcp_connections from anon, authenticated;
grant select (id, user_id, server_id, name, url, enabled, auth, token_expires_at, created_at, updated_at)
  on public.mcp_connections to authenticated;
grant insert (user_id, server_id, name, url)
  on public.mcp_connections to authenticated;
grant delete on public.mcp_connections to authenticated;

-- Memory had no server behind it; Hugging Face now signs in. A row for either
-- without a sign-in was never a working connection.
delete from public.mcp_connections
where server_id = 'memory'
   or (server_id = 'huggingface' and auth <> 'oauth');
