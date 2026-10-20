import { mcpSealer, type McpGrant } from "@/lib/mcp/oauth";

/* What travels between "send them to sign in" and "they are back".
 *
 * Sealed rather than merely encoded, unlike the Supabase and GitHub cookies:
 * this one carries the token endpoint the code is exchanged at and, for a
 * provider that issued one, a client secret. An editable token endpoint would
 * let a forged cookie send a real authorization code somewhere else. Ten
 * minutes, httpOnly, scoped to these routes. */

export const OAUTH_COOKIE = "qs_mcp_oauth";
export const OAUTH_COOKIE_PATH = "/api/integrations/mcp";

export type McpOAuthCookie = {
  state: string;
  verifier: string;
  userId: string;
  serverId: string;
  name: string | null;
  url: string;
  redirectUri: string;
  grant: McpGrant;
  issuedAt: number;
};

export function writeOAuthCookie(value: McpOAuthCookie): string | null {
  return mcpSealer()?.seal(JSON.stringify(value)) ?? null;
}

export function readOAuthCookie(value: string | undefined): McpOAuthCookie | null {
  if (!value) return null;
  const opened = mcpSealer()?.unseal(value);
  if (!opened) return null;
  try {
    const parsed = JSON.parse(opened) as McpOAuthCookie;
    if (Date.now() - parsed.issuedAt > 10 * 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Where providers send them back. Must match what was registered. */
export function redirectUriFor(request: Request): string {
  return process.env.MCP_OAUTH_REDIRECT_URL ?? new URL("/api/integrations/mcp/callback", request.url).toString();
}

/** Home, with the MCP tab open and a word on how it went. */
export function backTo(request: Request, serverId: string | null, reason: string): URL {
  const url = new URL("/dashboard", request.url);
  url.searchParams.set("mcp", reason);
  if (serverId) url.searchParams.set("server", serverId);
  return url;
}
