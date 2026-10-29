import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { catalogueServer } from "@/app/dashboard/mcpServers";
import { exchangeCode, saveOAuthConnection } from "@/lib/mcp/oauth";
import { verifyConnector } from "@/lib/mcp/runtime";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, backTo, readOAuthCookie } from "../oauth-cookie";

/* Connect an MCP server, step two: the provider sends them back with a code.
 *
 * The state must match, the signed-in person must be the one who left, and
 * only then is the code exchanged — server-side, with the PKCE verifier — and
 * the tokens stored sealed — after the server has answered with them and
 * listed tools the agent can use, so "Connected" is never a sign-in that
 * leads nowhere. They land on Home with the MCP tab open. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const saved = readOAuthCookie(jar.get(OAUTH_COOKIE)?.value);

  const back = (reason: string) => {
    const response = NextResponse.redirect(backTo(request, saved?.serverId ?? null, reason));
    response.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return response;
  };

  /* They pressed Cancel on the provider's screen. */
  if (url.searchParams.get("error")) return back("cancelled");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!saved || !code || !state || state !== saved.state) return back("expired");

  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user || user.id !== saved.userId) return back("expired");

  const service = createSupabaseServiceClient();
  if (!service) return back("unavailable");

  const tokens = await exchangeCode(saved.grant, code, saved.verifier, saved.redirectUri);
  if (!tokens) {
    // eslint-disable-next-line no-console
    console.error(`mcp-oauth: code exchange failed for ${user.id} on ${saved.serverId}`);
    return back("failed");
  }

  const verified = await verifyConnector(saved.url, tokens.accessToken);
  if (!verified.ok) {
    // eslint-disable-next-line no-console
    console.error(`mcp-oauth: ${saved.serverId} signed in but ${verified.reason} for ${user.id}`);
    return back(verified.reason);
  }

  const custom = !catalogueServer(saved.serverId);
  const ok = await saveOAuthConnection(
    service,
    { userId: user.id, serverId: saved.serverId, name: custom ? saved.name : null, url: custom ? saved.url : null },
    saved.grant,
    tokens,
  );
  return back(ok ? "connected" : "failed");
}
