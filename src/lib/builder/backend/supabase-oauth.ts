/* "Connect Supabase" — signing in to Supabase on a customer's behalf.
 *
 * Linking your own database used to mean three values copied out of a
 * dashboard: a project URL, an anon key, and a Postgres connection string with
 * the database password inside it. The third is where people gave up — which
 * of the four strings, pooler or direct, which port — and without it the
 * tables were never created. So none of that is asked for any more. A person
 * presses Connect Supabase, signs in to Supabase, allows QuickStark, picks a
 * project (or has one made), and everything after that goes through
 * Supabase's Management API with the access they granted.
 *
 * ── The flow ──────────────────────────────────────────────────────────────
 *
 * OAuth 2.0 authorization code with PKCE, which is what Supabase's OAuth apps
 * speak. The verifier and a random state travel in an httpOnly cookie between
 * the redirect out and the callback in — see the routes under
 * /api/integrations/supabase. The code is exchanged server-side with the client
 * secret. The browser never sees a token.
 *
 * ── Configuration ─────────────────────────────────────────────────────────
 *
 *   SUPABASE_OAUTH_CLIENT_ID      from the OAuth app registered in the
 *   SUPABASE_OAUTH_CLIENT_SECRET  QuickStark organisation's settings on
 *                                 supabase.com (Organization → OAuth Apps).
 *
 * Its redirect URL must be <site>/api/integrations/supabase/callback. Without
 * both variables `oauthConfigured()` is false and the panel falls back to the
 * paste-your-keys form.
 *
 * ── Tokens at rest ────────────────────────────────────────────────────────
 *
 * The refresh token is long-lived access to somebody's Supabase account, so it
 * is stored sealed (AES-256-GCM) in a table no browser role can read at all,
 * under a key derived from the client secret. Rotating the secret makes the
 * stored tokens unreadable, which reads as "not connected" and costs one more
 * press of Connect Supabase — the right failure for a leaked secret.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

const API = "https://api.supabase.com";

export function oauthConfigured(): boolean {
  return Boolean(process.env.SUPABASE_OAUTH_CLIENT_ID && process.env.SUPABASE_OAUTH_CLIENT_SECRET);
}

function clientCredentials(): { id: string; secret: string } | null {
  const id = process.env.SUPABASE_OAUTH_CLIENT_ID;
  const secret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

/* ── PKCE ────────────────────────────────────────────────────────────────── */

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomState(): string {
  return randomBytes(24).toString("base64url");
}

/** Where the person is sent to sign in to Supabase and allow QuickStark. */
export function authorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  });
  return `${API}/v1/oauth/authorize?${params.toString()}`;
}

export function authorizeUrlFor(redirectUri: string, state: string, challenge: string): string | null {
  const client = clientCredentials();
  if (!client) return null;
  return authorizeUrl({ clientId: client.id, redirectUri, state, challenge });
}

/* ── Tokens ──────────────────────────────────────────────────────────────── */

export type Tokens = { accessToken: string; refreshToken: string; expiresAt: Date };

async function tokenRequest(form: Record<string, string>): Promise<{ ok: true; tokens: Tokens } | { ok: false; reason: string }> {
  const client = clientCredentials();
  if (!client) return { ok: false, reason: "Connect Supabase is not configured on this deployment" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API}/v1/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString("base64")}`,
      },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const said = typeof body.error_description === "string" ? body.error_description : typeof body.message === "string" ? body.message : "";
      return { ok: false, reason: `Supabase refused the sign-in (${response.status})${said ? `: ${said}` : ""}` };
    }
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : form.refresh_token ?? "";
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
    if (!accessToken || !refreshToken) return { ok: false, reason: "Supabase answered without a token" };
    return { ok: true, tokens: { accessToken, refreshToken, expiresAt: new Date(Date.now() + expiresIn * 1000) } };
  } catch {
    return { ok: false, reason: "Supabase did not answer the sign-in" };
  } finally {
    clearTimeout(timer);
  }
}

export function exchangeCode(input: { code: string; verifier: string; redirectUri: string }) {
  return tokenRequest({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  });
}

export function refreshTokens(refreshToken: string) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/* ── Sealing ─────────────────────────────────────────────────────────────── */

function sealingKey(): Buffer | null {
  const client = clientCredentials();
  return client ? createHash("sha256").update(`quickstark-supabase-oauth:${client.secret}`).digest() : null;
}

export function seal(value: string): string | null {
  const key = sealingKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

export function unseal(sealed: string): string | null {
  const key = sealingKey();
  if (!key || !sealed.startsWith("v1.")) return null;
  try {
    const raw = Buffer.from(sealed.slice(3), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

type ConnectionRow = { access_token: string; refresh_token: string; expires_at: string };

export async function saveTokens(service: SupabaseClient, userId: string, tokens: Tokens): Promise<boolean> {
  const access = seal(tokens.accessToken);
  const refresh = seal(tokens.refreshToken);
  if (!access || !refresh) return false;
  const { error } = await service.from("supabase_connections").upsert(
    {
      user_id: userId,
      access_token: access,
      refresh_token: refresh,
      expires_at: tokens.expiresAt.toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    // eslint-disable-next-line no-console
    console.error("supabase-oauth: tokens could not be stored:", error.message);
    return false;
  }
  return true;
}

export async function forgetTokens(service: SupabaseClient, userId: string): Promise<void> {
  await service.from("supabase_connections").delete().eq("user_id", userId);
}

/**
 * A working access token for this person's Supabase account, or null.
 *
 * Refreshed when it expires within the next two minutes, and the new pair is
 * stored before it is used — Supabase rotates refresh tokens, so a refresh
 * that is not written down locks the account out on the next one. Null means
 * "not connected" in every case the caller can act on: never connected, the
 * grant revoked on Supabase's side, or the sealing key rotated.
 */
export async function accessTokenFor(service: SupabaseClient, userId: string): Promise<string | null> {
  if (!oauthConfigured()) return null;

  const { data, error } = await service
    .from("supabase_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle<ConnectionRow>();
  if (error || !data) return null;

  const expiresAt = new Date(data.expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > 120_000) {
    return unseal(data.access_token);
  }

  const refreshToken = unseal(data.refresh_token);
  if (!refreshToken) return null;

  const refreshed = await refreshTokens(refreshToken);
  if (!refreshed.ok) {
    // eslint-disable-next-line no-console
    console.warn(`supabase-oauth: refresh failed for ${userId}: ${refreshed.reason}`);
    return null;
  }
  await saveTokens(service, userId, refreshed.tokens);
  return refreshed.tokens.accessToken;
}

/** Whether this person has connected a Supabase account that still answers. */
export async function isConnected(service: SupabaseClient, userId: string): Promise<boolean> {
  return (await accessTokenFor(service, userId)) !== null;
}
