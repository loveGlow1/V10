/* Connecting an MCP server by signing in, never by pasting a key.
 *
 * This is the authorization flow the MCP specification defines for remote
 * servers, and it is the same for every server that follows it:
 *
 *   1. Ask the server. An MCP endpoint that needs credentials answers 401
 *      with `WWW-Authenticate: Bearer resource_metadata="…"`, naming its
 *      protected-resource metadata (RFC 9728). One that answers without
 *      asking is open, and is saved as such.
 *   2. Read that metadata for the authorization server, then the
 *      authorization server's own metadata (RFC 8414, or OpenID discovery)
 *      for its authorize, token and registration endpoints.
 *   3. Register QuickStark with it on the spot (dynamic client registration,
 *      RFC 7591) — or, for a provider that does not offer that (Google), use
 *      the client this deployment registered once, from the environment.
 *   4. Send the person to sign in, with PKCE (S256) and the `resource`
 *      parameter (RFC 8707) so the token is bound to this server.
 *   5. On the way back, exchange the code server-side and store the tokens
 *      sealed. They never reach the browser.
 *
 * Every address here can come from a person (a custom server), so nothing is
 * fetched until assertPublicHttps has said it is https on a public address —
 * this route must not become a way to make the server call its own network.
 */

import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpServer } from "@/app/dashboard/mcpServers";
import { sealerFor, type Sealer } from "@/lib/sealing";

const TIMEOUT_MS = 8000;

/* ── The sealing key ──────────────────────────────────────────────────────
 *
 * MCP_OAUTH_SECRET when set; otherwise the service role key, which every
 * deployment that can store a connection already holds. Rotating either makes
 * stored tokens unreadable, which reads as "sign in again" — the right failure
 * for a leaked secret. */
export function mcpSealer(): Sealer | null {
  const material = process.env.MCP_OAUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return material ? sealerFor(`quickstark-mcp-oauth:${material}`) : null;
}

/* ── Safety ───────────────────────────────────────────────────────────────*/

function privateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80")) return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? privateAddress(mapped[1]) : false;
  }
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** The URL if it is https on a public address, otherwise null. */
export async function assertPublicHttps(value: unknown): Promise<URL | null> {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return null;
  try {
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (addresses.length === 0 || addresses.some((entry) => privateAddress(entry.address))) return null;
  } catch {
    return null;
  }
  return url;
}

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
  const safe = await assertPublicHttps(url);
  if (!safe) return null;
  try {
    const response = await fetch(safe, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/* ── Discovery ────────────────────────────────────────────────────────────*/

export type Discovery =
  | { kind: "open" }
  | {
      kind: "oauth";
      resource: string;
      scopes: string[];
      authorizationEndpoint: string;
      tokenEndpoint: string;
      registrationEndpoint: string | null;
      tokenAuthMethods: string[];
    }
  | { kind: "failed"; reason: string };

/** Asks the server whether it needs signing in to, and where. */
export async function discover(mcpUrl: string): Promise<Discovery> {
  const endpoint = await assertPublicHttps(mcpUrl);
  if (!endpoint) return { kind: "failed", reason: "The server address must be https on a public host." };

  /* 1. The server itself. An initialize with no credentials either works —
        the server is open — or is refused with directions. */
  let metadataUrl: string | null = null;
  try {
    const probe = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "QuickStark", version: "1" } },
      }),
    });
    await probe.body?.cancel().catch(() => {});
    if (probe.status === 401 || probe.status === 403) {
      const challenge = probe.headers.get("www-authenticate") ?? "";
      metadataUrl = challenge.match(/resource_metadata="([^"]+)"/i)?.[1] ?? null;
    } else if (probe.ok) {
      /* Some servers answer an anonymous initialize and refuse later calls,
         so an answer is only taken as "open" when the server publishes no
         protected-resource metadata either. */
      const advertised = await protectedResourceMetadata(endpoint, null);
      if (!advertised) return { kind: "open" };
    } else {
      return { kind: "failed", reason: `The server answered ${probe.status}.` };
    }
  } catch {
    return { kind: "failed", reason: "The server did not answer." };
  }

  /* 2. Protected-resource metadata, then the authorization server's. */
  const resourceMeta = await protectedResourceMetadata(endpoint, metadataUrl);
  const issuer = str(strings(resourceMeta?.authorization_servers)[0]) ?? endpoint.origin;
  const serverMeta = await authorizationServerMetadata(issuer);
  if (!serverMeta) return { kind: "failed", reason: "The server does not say where to sign in." };

  const authorizationEndpoint = str(serverMeta.authorization_endpoint);
  const tokenEndpoint = str(serverMeta.token_endpoint);
  if (!authorizationEndpoint || !tokenEndpoint) {
    return { kind: "failed", reason: "The server's sign-in is missing its endpoints." };
  }
  const methods = strings(serverMeta.code_challenge_methods_supported);
  if (methods.length > 0 && !methods.includes("S256")) {
    return { kind: "failed", reason: "The server's sign-in does not support PKCE." };
  }

  return {
    kind: "oauth",
    resource: str(resourceMeta?.resource) ?? endpoint.toString(),
    scopes: strings(resourceMeta?.scopes_supported),
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: str(serverMeta.registration_endpoint),
    tokenAuthMethods: strings(serverMeta.token_endpoint_auth_methods_supported),
  };
}

async function protectedResourceMetadata(endpoint: URL, named: string | null) {
  const path = endpoint.pathname === "/" ? "" : endpoint.pathname.replace(/\/$/, "");
  const candidates = [
    named,
    `${endpoint.origin}/.well-known/oauth-protected-resource${path}`,
    `${endpoint.origin}/.well-known/oauth-protected-resource`,
  ].filter((entry): entry is string => Boolean(entry));
  for (const candidate of candidates) {
    const meta = await fetchJson(candidate);
    if (meta && strings(meta.authorization_servers).length > 0) return meta;
  }
  return null;
}

async function authorizationServerMetadata(issuer: string) {
  let base: URL;
  try {
    base = new URL(issuer);
  } catch {
    return null;
  }
  const path = base.pathname === "/" ? "" : base.pathname.replace(/\/$/, "");
  const candidates = [
    `${base.origin}/.well-known/oauth-authorization-server${path}`,
    `${base.origin}/.well-known/openid-configuration${path}`,
    `${base.origin}${path}/.well-known/openid-configuration`,
  ];
  for (const candidate of candidates) {
    const meta = await fetchJson(candidate);
    if (meta && str(meta.authorization_endpoint) && str(meta.token_endpoint)) return meta;
  }
  return null;
}

/* ── The client QuickStark signs in as ────────────────────────────────────*/

export type McpClient = {
  clientId: string;
  clientSecret: string | null;
  /** How the token endpoint wants the client identified. */
  authMethod: "none" | "client_secret_basic" | "client_secret_post";
};

/** Registers on the spot, or uses the client configured for this provider. */
export async function clientFor(
  server: Pick<McpServer, "clientEnv"> | null,
  found: Extract<Discovery, { kind: "oauth" }>,
  redirectUri: string,
): Promise<McpClient | { error: string }> {
  if (server?.clientEnv) {
    const id = process.env[`${server.clientEnv}_OAUTH_CLIENT_ID`];
    const secret = process.env[`${server.clientEnv}_OAUTH_CLIENT_SECRET`];
    if (!id) return { error: "unconfigured" };
    return { clientId: id, clientSecret: secret ?? null, authMethod: secret ? "client_secret_post" : "none" };
  }

  if (!found.registrationEndpoint) return { error: "no-registration" };
  const registered = await fetchJson(found.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "QuickStark",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: found.tokenAuthMethods.length === 0 || found.tokenAuthMethods.includes("none")
        ? "none"
        : found.tokenAuthMethods.includes("client_secret_post")
          ? "client_secret_post"
          : "client_secret_basic",
    }),
  });
  const clientId = str(registered?.client_id);
  if (!clientId) return { error: "registration-failed" };
  const clientSecret = str(registered?.client_secret);
  const said = str(registered?.token_endpoint_auth_method);
  const authMethod =
    said === "client_secret_basic" || said === "client_secret_post" || said === "none"
      ? said
      : clientSecret
        ? "client_secret_post"
        : "none";
  return { clientId, clientSecret, authMethod };
}

/* ── PKCE and the authorize address ───────────────────────────────────────*/

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function randomState(): string {
  return randomBytes(24).toString("base64url");
}

export function authorizeUrl(input: {
  endpoint: string;
  client: McpClient;
  redirectUri: string;
  state: string;
  challenge: string;
  resource: string;
  scopes: string[];
  extra?: Record<string, string>;
}): string {
  const url = new URL(input.endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.client.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", input.resource);
  if (input.scopes.length > 0) url.searchParams.set("scope", input.scopes.join(" "));
  for (const [key, value] of Object.entries(input.extra ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

/* ── Tokens ───────────────────────────────────────────────────────────────*/

export type McpTokens = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds, or null for a token the server did not date. */
  expiresAt: number | null;
};

/** What the token endpoint needs to hand out and renew tokens for this row. */
export type McpGrant = { tokenEndpoint: string; resource: string; client: McpClient };

async function tokenRequest(grant: McpGrant, params: Record<string, string>): Promise<McpTokens | null> {
  const body = new URLSearchParams({ ...params, resource: grant.resource });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (grant.client.authMethod === "client_secret_basic" && grant.client.clientSecret) {
    const pair = `${encodeURIComponent(grant.client.clientId)}:${encodeURIComponent(grant.client.clientSecret)}`;
    headers.Authorization = `Basic ${Buffer.from(pair).toString("base64")}`;
  } else {
    body.set("client_id", grant.client.clientId);
    if (grant.client.authMethod === "client_secret_post" && grant.client.clientSecret) {
      body.set("client_secret", grant.client.clientSecret);
    }
  }
  const answer = await fetchJson(grant.tokenEndpoint, { method: "POST", headers, body: body.toString() });
  const accessToken = str(answer?.access_token);
  if (!accessToken) return null;
  const expiresIn = typeof answer?.expires_in === "number" ? answer.expires_in : Number(answer?.expires_in);
  return {
    accessToken,
    refreshToken: str(answer?.refresh_token),
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
  };
}

export function exchangeCode(grant: McpGrant, code: string, verifier: string, redirectUri: string) {
  return tokenRequest(grant, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
}

/* ── Storage ──────────────────────────────────────────────────────────────
 *
 * The tokens and the client sit in two sealed columns that no browser role
 * can select — see the migration. The row's `auth` says how it was connected
 * and `token_expires_at` is there for the pane to say when it lapses; neither
 * is a secret. */

export async function saveOAuthConnection(
  service: SupabaseClient,
  row: { userId: string; serverId: string; name: string | null; url: string | null },
  grant: McpGrant,
  tokens: McpTokens,
): Promise<boolean> {
  const sealer = mcpSealer();
  if (!sealer) return false;
  const { error } = await service.from("mcp_connections").upsert(
    {
      user_id: row.userId,
      server_id: row.serverId,
      name: row.name,
      url: row.url,
      enabled: true,
      auth: "oauth",
      oauth_tokens: sealer.seal(JSON.stringify(tokens)),
      oauth_grant: sealer.seal(JSON.stringify(grant)),
      token_expires_at: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : null,
    },
    { onConflict: "user_id,server_id" },
  );
  return !error;
}

export async function saveOpenConnection(
  service: SupabaseClient,
  row: { userId: string; serverId: string; name: string | null; url: string | null },
): Promise<boolean> {
  const { error } = await service.from("mcp_connections").upsert(
    {
      user_id: row.userId,
      server_id: row.serverId,
      name: row.name,
      url: row.url,
      enabled: true,
      auth: "none",
      oauth_tokens: null,
      oauth_grant: null,
      token_expires_at: null,
    },
    { onConflict: "user_id,server_id" },
  );
  return !error;
}

/**
 * A usable access token for one connection, renewed first when it is within a
 * minute of expiring. Null when the row is not signed in, the seal no longer
 * opens, or the server refused the refresh — all of which mean "sign in again".
 * For whatever eventually runs MCP servers on someone's behalf; nothing in the
 * browser ever receives this.
 */
export async function accessTokenFor(
  service: SupabaseClient,
  userId: string,
  serverId: string,
): Promise<string | null> {
  const sealer = mcpSealer();
  if (!sealer) return null;
  const { data } = await service
    .from("mcp_connections")
    .select("oauth_tokens, oauth_grant")
    .eq("user_id", userId)
    .eq("server_id", serverId)
    .maybeSingle();
  const tokensRaw = data?.oauth_tokens ? sealer.unseal(data.oauth_tokens as string) : null;
  const grantRaw = data?.oauth_grant ? sealer.unseal(data.oauth_grant as string) : null;
  if (!tokensRaw || !grantRaw) return null;

  let tokens: McpTokens;
  let grant: McpGrant;
  try {
    tokens = JSON.parse(tokensRaw) as McpTokens;
    grant = JSON.parse(grantRaw) as McpGrant;
  } catch {
    return null;
  }
  if (!tokens.expiresAt || tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
  if (!tokens.refreshToken) return null;

  const renewed = await tokenRequest(grant, { grant_type: "refresh_token", refresh_token: tokens.refreshToken });
  if (!renewed) return null;
  const next = { ...renewed, refreshToken: renewed.refreshToken ?? tokens.refreshToken };
  await service
    .from("mcp_connections")
    .update({
      oauth_tokens: sealer.seal(JSON.stringify(next)),
      token_expires_at: next.expiresAt ? new Date(next.expiresAt).toISOString() : null,
    })
    .eq("user_id", userId)
    .eq("server_id", serverId);
  return next.accessToken;
}
