/* How an MCP client finds out where to sign in.
 *
 * The MCP authorization spec has the server answer an unauthenticated request
 * with 401 and a `resource_metadata` link (RFC 9728). That document names the
 * authorization server — here, Supabase Auth's own OAuth 2.1 server for this
 * project, so people sign in to QuickStark with the account they already have
 * and approve the assistant on /oauth/consent. Supabase publishes its metadata
 * at /.well-known/oauth-authorization-server/auth/v1 on the project host.
 *
 * Pure, so check:mcp can read what it says. */

export const MCP_PATH = "/api/mcp";
export const RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;

/** The issuer Supabase Auth's OAuth server uses for a project. */
export function authorizationServer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
}

/** Where Supabase serves that issuer's RFC 8414 metadata. */
export function authorizationServerMetadataUrl(supabaseUrl: string): string {
  const base = new URL(supabaseUrl);
  return `${base.origin}/.well-known/oauth-authorization-server/auth/v1`;
}

export function protectedResourceMetadata(origin: string, supabaseUrl: string) {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [authorizationServer(supabaseUrl)],
    bearer_methods_supported: ["header"],
    resource_name: "QuickStark",
    resource_documentation: `${origin}/`,
  };
}

/** The 401 header that points a client at the metadata above. */
export function challenge(origin: string, invalidToken: boolean): string {
  const error = invalidToken ? ', error="invalid_token", error_description="Sign in to QuickStark again."' : "";
  return `Bearer resource_metadata="${origin}${RESOURCE_METADATA_PATH}"${error}`;
}

/* Behind a proxy the request's own origin is the internal one, so the
   forwarded host wins when the platform sets it — as /auth/callback does. */
export function originOf(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  return forwardedHost ? `${forwardedProto}://${forwardedHost}` : new URL(request.url).origin;
}

/* Any origin may call: the endpoint is reached with a bearer token, which a
   browser never attaches on its own, so a permissive CORS policy exposes
   nothing a token holder could not already do. Browser-based MCP clients
   (the MCP Inspector, web IDEs) need it to connect at all. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};
