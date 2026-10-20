-- MCP servers are connected by signing in (OAuth), never by a pasted API key.
-- See src/lib/mcp/oauth.ts and /api/integrations/mcp/*.
--
-- auth              'oauth' once signed in, 'none' for a server with nothing
--                   to sign in to. Set only by the server routes.
-- oauth_tokens      sealed access + refresh token.            Service role only.
-- oauth_grant       sealed token endpoint, resource, client.  Service role only.
-- token_expires_at  when the access token lapses; not a secret.
--
-- api_key goes. A key-connected row cannot be carried over — there is no
-- token to give it — so it is switched off and reads as "Sign in" in the pane.

alter table public.mcp_connections
  add column if not exists auth text not null default 'none',
  add column if not exists oauth_tokens text,
  add column if not exists oauth_grant text,
  add column if not exists token_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mcp_connections_auth_check'
  ) then
    alter table public.mcp_connections
      add constraint mcp_connections_auth_check check (auth in ('none', 'oauth'));
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mcp_connections' and column_name = 'api_key'
  ) then
    update public.mcp_connections set enabled = false where api_key is not null;
    alter table public.mcp_connections drop column api_key;
  end if;
end $$;

-- The browser reads whether a row is connected and how, never the tokens.
-- It may create and rename its own rows and switch an open server on; only
-- the service role writes auth and the sealed columns.
revoke all on public.mcp_connections from anon, authenticated;
grant select (id, user_id, server_id, name, url, enabled, auth, token_expires_at, created_at, updated_at)
  on public.mcp_connections to authenticated;
grant insert (user_id, server_id, name, url, enabled)
  on public.mcp_connections to authenticated;
grant update (name, url, enabled)
  on public.mcp_connections to authenticated;
grant delete on public.mcp_connections to authenticated;
