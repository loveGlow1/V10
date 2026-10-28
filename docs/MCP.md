# QuickStark's MCP server

QuickStark can be used from inside AI assistants — Claude, ChatGPT, Cursor,
Claude Code and anything else that speaks the Model Context Protocol. Someone
says "build me a booking site for my barbershop with QuickStark" in their
assistant, approves it once, and gets a preview link back without opening the
dashboard.

```
assistant ──POST /api/mcp (Bearer token)──► src/app/api/mcp/route.ts
                                              │ checks the token with Supabase Auth
                                              ▼
                              src/lib/quickstark-mcp/tools.ts
                     reads under RLS │                 │ builds / publishes through
                                     ▼                 ▼ the app's own routes, as the person
                               Supabase (RLS)    /api/build · /api/publish · /api/projects/[id]/build
```

## The tools

| Tool | What it does | Spends credits |
|---|---|---|
| `list_projects` | The person's projects, newest first, with status, preview and live links | no |
| `get_project` | One project, and how far a running build has got | no |
| `create_app` | New project, built from a plain-English description | yes |
| `edit_app` | Changes an existing app, or answers a question about it | yes |
| `publish_app` | Puts an app live and returns its address | yes |
| `get_credits` | Plan and credits left | no |

Deliberately not offered: deleting anything, database changes (the workspace
shows the SQL and asks — a tool answer sends the person there), GitHub, video
and flyers. `npm run check:mcp` fails if a tool that deletes appears, or if this
table stops naming every tool.

### Nothing is re-implemented

Each tool goes through the same door the workspace does. Reads run under the
person's own token, so RLS answers. `create_app`, `edit_app` and `publish_app`
call `/api/build` and `/api/publish` as the person, so the credit check, the
card gate, the plan's model rules, ownership and the safety screen all apply
exactly as they do in the browser. The tools never touch the service role.

### Questions, and builds that outlast the call

A build can answer with a question instead of building — what kind of thing,
one page or a full app, whether it needs a database. The tool returns the
question with each option and the exact argument value to send back; the
assistant asks the person and calls again. Nothing is built or charged before
then. See `summarise` in `build-reply.ts`.

A build can take longer than a request may wait. The tool reads `/api/build`'s
stream until its result or until `MCP_WAIT_SECONDS` (default 50 — under the
Hobby plan's 60-second function limit), then answers "still running" with where
it had got to. The build carries on — the route records its work whether or not
anyone is still reading — and `get_project` reports on it. On a plan whose
functions may run longer, raise `MCP_WAIT_SECONDS` (at most 280) so more builds
finish inside one call.

## Sign-in

The assistant signs people in with **Supabase Auth's OAuth 2.1 server**, so it
is the QuickStark account they already have — Google, GitHub, Facebook, email.

1. The assistant calls `/api/mcp` with no token and gets `401` with
   `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/api/mcp"`.
2. That document names `https://<project>.supabase.co/auth/v1` as the
   authorization server. Supabase publishes its metadata, registers the
   assistant (dynamic client registration) and runs the PKCE flow.
3. Supabase sends the person to **`/oauth/consent`**, which says who is asking
   and what they will be able to do. Signed out, they sign in first and come
   straight back (`?next=` on the landing page).
4. Allow posts to `/api/oauth/decision`, which records it with Supabase and
   returns the person to the assistant with a code. The assistant swaps it for
   an access token at Supabase.
5. Every call carries that token. `/api/mcp` checks it with Supabase and passes
   it on unchanged to the routes the tools call.

`createSupabaseServerClient` accepts `Authorization: Bearer <token>` when a
request has no session cookie — that is what lets the existing routes serve
these calls without change. The cookie wins when both are present, so the
browser's path is untouched, and a bearer token is never attached by a browser
on its own, so this opens nothing to a cross-site request.

`/.well-known/oauth-authorization-server` on this host passes Supabase's
metadata through for clients built against the 2025-03-26 revision, which look
there instead of following the resource metadata.

## Switching it on

The code ships dormant: until these are done, `/api/mcp` answers every call
with a 401 that no client can get past.

**1. Supabase → Authentication → OAuth Server**

- Enable the OAuth 2.1 server.
- **Authorization Path:** `/oauth/consent`
- **Allow dynamic client registration:** on. MCP clients register themselves;
  without it every assistant would have to be added by hand under
  Authentication → OAuth Apps.

**2. Supabase → Authentication → URL Configuration**

- **Site URL** must be `https://www.quickstark.tech` — the authorization path is
  added to it.

**3. Recommended: Supabase → Project Settings → JWT Keys**

- Move to asymmetric signing keys (RS256/ES256) if the project still uses the
  legacy HS256 secret. Supabase recommends it for OAuth; it is required if a
  client asks for an `openid` ID token.

**4. Deploy**, then check:

```bash
curl -i https://www.quickstark.tech/api/mcp -X POST -d '{}'
```

should answer `401` with the `WWW-Authenticate` header above, and

```bash
curl https://www.quickstark.tech/.well-known/oauth-authorization-server
```

should return Supabase's metadata (a `503` means step 1 is not done).

## Connecting an assistant

The server address is **`https://www.quickstark.tech/api/mcp`**.

- **Claude (claude.ai / desktop):** Settings → Connectors → Add custom
  connector → paste the address → Connect → Allow on QuickStark.
- **Claude Code:** `claude mcp add --transport http quickstark https://www.quickstark.tech/api/mcp`,
  then `/mcp` to sign in.
- **Cursor / VS Code / others:** add a remote (Streamable HTTP) MCP server with
  that address; they open the sign-in page themselves.
- **MCP Inspector**, for testing: `npx @modelcontextprotocol/inspector`, choose
  Streamable HTTP, paste the address, Connect.

Approved assistants can be reviewed and revoked in Supabase under
Authentication → OAuth Apps.

## Transport

Streamable HTTP, stateless: one JSON-RPC message per POST, one JSON reply, no
session id, no server-initiated stream (`GET` answers 405, which the transport
allows). Protocol versions 2025-06-18, 2025-03-26 and 2024-11-05 are accepted.
The protocol layer (`protocol.ts`) has no QuickStark in it.
