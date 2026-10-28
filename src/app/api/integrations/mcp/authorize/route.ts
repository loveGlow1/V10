import { NextResponse } from "next/server";

import { catalogueServer } from "@/app/dashboard/mcpServers";
import { authorizeUrl, clientFor, discover, pkcePair, randomState, saveOpenConnection } from "@/lib/mcp/oauth";
import { verifyConnector } from "@/lib/mcp/runtime";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, backTo, redirectUriFor, writeOAuthCookie } from "../oauth-cookie";

/* Connect an MCP server, step one: find where it signs in, register with it if
 * it lets us, and send the person there. A plain link from Account Settings
 * lands here — a navigation, because the next page is the provider's.
 *
 *   ?server=notion              a catalogue server
 *   ?server=custom:<uuid>       a custom server the person saved (name + URL)
 *
 * A server with nothing to sign in to (a catalogue one marked "none", or a
 * custom one that answers without asking for credentials) is connected here,
 * on the spot — but only once it has actually answered and listed tools the
 * agent can use (verifyConnector). Nothing is ever marked connected because
 * a button was pressed. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const serverId = new URL(request.url).searchParams.get("server") ?? "";
  const back = (reason: string) => NextResponse.redirect(backTo(request, serverId || null, reason));

  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  /* Signed out: to sign in, and straight back here afterwards, so the link
     that started this connection still finishes it (the home page honours a
     same-site ?next=, and ?signin=1 opens its sign-in straight away). */
  if (!supabase || !user) {
    const here = new URL(request.url);
    const signIn = new URL("/", request.url);
    signIn.searchParams.set("next", `${here.pathname}${here.search}`);
    signIn.searchParams.set("signin", "1");
    return NextResponse.redirect(signIn);
  }

  const service = createSupabaseServiceClient();
  if (!service) return back("unavailable");

  /* Which server, and its address. A custom one is read from the person's own
     row, under their session — so an id that is not theirs finds nothing. */
  const catalogue = catalogueServer(serverId);
  async function connectOpen(url: string, label: string | null) {
    const verified = await verifyConnector(url, null);
    if (!verified.ok) return back(verified.reason);
    const saved = await saveOpenConnection(service!, { userId: user!.id, serverId, name: label, url: catalogue ? null : url });
    return back(saved ? "connected" : "failed");
  }
  let name: string | null = null;
  let mcpUrl: string | null = null;
  if (catalogue) {
    if (!catalogue.url) return back("invalid");
    if (catalogue.auth === "none") return connectOpen(catalogue.url, null);
    mcpUrl = catalogue.url;
  } else if (serverId.startsWith("custom:")) {
    const { data } = await supabase
      .from("mcp_connections")
      .select("name, url")
      .eq("server_id", serverId)
      .maybeSingle();
    name = (data?.name as string | undefined) ?? null;
    mcpUrl = (data?.url as string | undefined) ?? null;
    if (!mcpUrl) return back("invalid");
  } else {
    return back("invalid");
  }

  const found = await discover(mcpUrl);
  if (found.kind === "failed") {
    // eslint-disable-next-line no-console
    console.error(`mcp-oauth: discovery failed for ${serverId}: ${found.reason}`);
    return back("unreachable");
  }
  if (found.kind === "open") return connectOpen(mcpUrl, name);

  const redirectUri = redirectUriFor(request);
  const client = await clientFor(catalogue, found, redirectUri);
  if ("error" in client) return back(client.error === "unconfigured" ? "unavailable" : "no-oauth");

  const { verifier, challenge } = pkcePair();
  const state = randomState();
  const cookie = writeOAuthCookie({
    state,
    verifier,
    userId: user.id,
    serverId,
    name,
    url: mcpUrl,
    redirectUri,
    grant: { tokenEndpoint: found.tokenEndpoint, resource: found.resource, client },
    issuedAt: Date.now(),
  });
  if (!cookie) return back("unavailable");

  const response = NextResponse.redirect(
    authorizeUrl({
      endpoint: found.authorizationEndpoint,
      client,
      redirectUri,
      state,
      challenge,
      resource: found.resource,
      scopes: found.scopes,
      extra: catalogue?.authorizeParams,
    }),
  );
  response.cookies.set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: 600,
  });
  return response;
}
