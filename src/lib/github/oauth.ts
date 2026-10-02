/* "Connect GitHub" — signing in to GitHub on a customer's behalf, so their
 * app's code can be pushed to a repository they own.
 *
 * This is NOT signing in to QuickStark with GitHub. That goes through Supabase
 * Auth (the GitHub provider in the Supabase dashboard) and only ever asks
 * GitHub who you are. This asks for more — permission to create a repository
 * and push to it — and asks only when somebody presses Connect GitHub, so
 * nobody signing in is shown a scope screen they did not come for.
 *
 * ── The flow ──────────────────────────────────────────────────────────────
 *
 * OAuth 2.0 authorization code with PKCE and a random state, which both GitHub
 * OAuth Apps and GitHub Apps accept. The verifier, the state, who started it
 * and where to return travel in an httpOnly cookie between the redirect out
 * and the callback in — see the routes under /api/integrations/github. The
 * code is exchanged server-side with the client secret. The browser never sees
 * a token.
 *
 * ── Configuration ─────────────────────────────────────────────────────────
 *
 *   GITHUB_OAUTH_CLIENT_ID       from an OAuth App (github.com → Settings →
 *   GITHUB_OAUTH_CLIENT_SECRET   Developer settings → OAuth Apps), or a
 *                                GitHub App's client id and secret.
 *
 * Its callback URL must be <site>/api/integrations/github/callback. Without
 * both variables `githubConfigured()` is false and the Integrations drawer says
 * Connect GitHub is not set up here rather than offering a button that fails.
 *
 * ── Tokens at rest ────────────────────────────────────────────────────────
 *
 * An OAuth App token with the `repo` scope is write access to every repository
 * the person can reach, and it does not expire. It is stored sealed
 * (AES-256-GCM, see lib/sealing.ts) in a table no browser role can read, under
 * a key derived from the client secret. A GitHub App with expiring tokens
 * hands back a refresh token as well; that case is handled the same way the
 * Supabase connection handles it.
 */

import { createHash, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sealerFor } from "@/lib/sealing";

const AUTHORIZE = "https://github.com/login/oauth/authorize";
const TOKEN = "https://github.com/login/oauth/access_token";
export const GITHUB_API = "https://api.github.com";

/* `repo` because a pushed app is private by default, and `public_repo` cannot
   create or write a private one. `read:user` for the login shown beside the
   Disconnect button. GitHub Apps ignore scopes and use their own permissions
   (Contents: read and write, Administration: read and write). */
const SCOPES = "repo read:user";

export function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET);
}

function clientCredentials(): { id: string; secret: string } | null {
  const id = process.env.GITHUB_OAUTH_CLIENT_ID;
  const secret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
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

/** Where the person is sent to sign in to GitHub and allow QuickStark. */
export function authorizeUrlFor(redirectUri: string, state: string, challenge: string): string | null {
  const client = clientCredentials();
  if (!client) return null;
  const params = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    allow_signup: "true",
  });
  return `${AUTHORIZE}?${params.toString()}`;
}

/* ── Tokens ──────────────────────────────────────────────────────────────── */

/** expiresAt and refreshToken are null for an OAuth App token, which never expires. */
export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date | null; scope: string };

type TokenResult = { ok: true; tokens: Tokens } | { ok: false; reason: string };

async function tokenRequest(form: Record<string, string>): Promise<TokenResult> {
  const client = clientCredentials();
  if (!client) return { ok: false, reason: "Connect GitHub is not configured on this deployment" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, ...form }).toString(),
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    /* GitHub answers a refused exchange with 200 and an `error` field, so the
       status alone says nothing. */
    if (!response.ok || typeof body.error === "string") {
      const said = typeof body.error_description === "string" ? body.error_description : typeof body.error === "string" ? body.error : "";
      return { ok: false, reason: `GitHub refused the sign-in (${response.status})${said ? `: ${said}` : ""}` };
    }
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    if (!accessToken) return { ok: false, reason: "GitHub answered without a token" };
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : null;
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : null;
    return {
      ok: true,
      tokens: {
        accessToken,
        refreshToken,
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        scope: typeof body.scope === "string" ? body.scope : "",
      },
    };
  } catch {
    return { ok: false, reason: "GitHub did not answer the sign-in" };
  } finally {
    clearTimeout(timer);
  }
}

export function exchangeCode(input: { code: string; verifier: string; redirectUri: string }) {
  return tokenRequest({ code: input.code, redirect_uri: input.redirectUri, code_verifier: input.verifier });
}

function refreshTokens(refreshToken: string) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/**
 * Withdraws the grant on GitHub's side as well, so Disconnect means the token
 * stops working rather than merely being forgotten here. Best effort: a token
 * GitHub has already revoked answers 404, which is the outcome wanted anyway.
 */
export async function revokeGrant(accessToken: string): Promise<void> {
  const client = clientCredentials();
  if (!client) return;
  await fetch(`${GITHUB_API}/applications/${encodeURIComponent(client.id)}/grant`, {
    method: "DELETE",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString("base64")}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ access_token: accessToken }),
    cache: "no-store",
  }).catch(() => {});
}

/* ── Sealing ─────────────────────────────────────────────────────────────── */

function sealer() {
  const client = clientCredentials();
  return client ? sealerFor(`quickstark-github-oauth:${client.secret}`) : null;
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

type ConnectionRow = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  login: string | null;
};

export async function saveTokens(
  service: SupabaseClient,
  userId: string,
  tokens: Tokens,
  login: string | null,
): Promise<boolean> {
  const box = sealer();
  if (!box) return false;
  const access = box.seal(tokens.accessToken);
  const refresh = tokens.refreshToken ? box.seal(tokens.refreshToken) : null;
  const { error } = await service.from("github_connections").upsert(
    {
      user_id: userId,
      access_token: access,
      refresh_token: refresh,
      expires_at: tokens.expiresAt?.toISOString() ?? null,
      scope: tokens.scope,
      ...(login ? { login } : {}),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    // eslint-disable-next-line no-console
    console.error("github-oauth: tokens could not be stored:", error.message);
    return false;
  }
  return true;
}

export async function forgetTokens(service: SupabaseClient, userId: string): Promise<void> {
  await service.from("github_connections").delete().eq("user_id", userId);
}

/**
 * A working access token for this person's GitHub account, and the login it
 * belongs to, or null.
 *
 * Null means "not connected" in every case the caller can act on: never
 * connected, the sealing key rotated, or an expiring token whose refresh was
 * refused. A token revoked on github.com still comes back from here — only
 * GitHub can say it no longer works, and the caller hears that as a 401.
 */
export async function connectionFor(
  service: SupabaseClient,
  userId: string,
): Promise<{ token: string; login: string | null } | null> {
  const box = sealer();
  if (!box) return null;

  const { data, error } = await service
    .from("github_connections")
    .select("access_token, refresh_token, expires_at, login")
    .eq("user_id", userId)
    .maybeSingle<ConnectionRow>();
  if (error || !data) return null;

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : null;
  if (expiresAt === null || !Number.isFinite(expiresAt) || expiresAt - Date.now() > 120_000) {
    const token = box.unseal(data.access_token);
    return token ? { token, login: data.login } : null;
  }

  const refreshToken = data.refresh_token ? box.unseal(data.refresh_token) : null;
  if (!refreshToken) return null;

  /* GitHub rotates refresh tokens, so the new pair is written before it is
     used — a refresh that is not written down locks the account out next time. */
  const refreshed = await refreshTokens(refreshToken);
  if (!refreshed.ok) {
    // eslint-disable-next-line no-console
    console.warn(`github-oauth: refresh failed for ${userId}: ${refreshed.reason}`);
    return null;
  }
  await saveTokens(service, userId, refreshed.tokens, data.login);
  return { token: refreshed.tokens.accessToken, login: data.login };
}
