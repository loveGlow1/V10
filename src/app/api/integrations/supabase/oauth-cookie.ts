/* What travels between "send them to Supabase" and "they are back".
 *
 * The PKCE verifier, a random state, who started it and which project to
 * return to — in one httpOnly cookie scoped to these routes, ten minutes long.
 * The callback compares the state Supabase hands back with the one here and
 * the signed-in person with the one who left, so a code arriving from anywhere
 * else is refused. */

export const OAUTH_COOKIE = "qs_supabase_oauth";
export const OAUTH_COOKIE_PATH = "/api/integrations/supabase";

export type OAuthCookie = { state: string; verifier: string; userId: string; projectId: string | null };

export function readOAuthCookie(value: string | undefined): OAuthCookie | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<OAuthCookie>;
    if (typeof parsed.state !== "string" || typeof parsed.verifier !== "string" || typeof parsed.userId !== "string") {
      return null;
    }
    return {
      state: parsed.state,
      verifier: parsed.verifier,
      userId: parsed.userId,
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : null,
    };
  } catch {
    return null;
  }
}

export function writeOAuthCookie(value: OAuthCookie): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** Where Supabase sends them back. Must match the OAuth app's registered redirect URL exactly. */
export function redirectUriFor(request: Request): string {
  return (
    process.env.SUPABASE_OAUTH_REDIRECT_URL ??
    new URL("/api/integrations/supabase/callback", request.url).toString()
  );
}
