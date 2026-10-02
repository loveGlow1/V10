/* What travels between "send them to GitHub" and "they are back".
 *
 * The PKCE verifier, a random state, who started it and where to return — in
 * one httpOnly cookie scoped to these routes, ten minutes long. The callback
 * compares the state GitHub hands back with the one here and the signed-in
 * person with the one who left, so a code arriving from anywhere else is
 * refused. Same arrangement as Connect Supabase. */

export const OAUTH_COOKIE = "qs_github_oauth";
export const OAUTH_COOKIE_PATH = "/api/integrations/github";

export type OAuthCookie = { state: string; verifier: string; userId: string; next: string };

/** Only same-origin paths, so `?next=` cannot bounce somebody to another site off a real sign-in. */
export function safeNext(value: string | null | undefined): string {
  /* Backslashes and control characters refused anywhere: URL parsers drop tabs
     and newlines and read "\\" as "/", so "/\t/evil.example" would otherwise
     come out the far side as "//evil.example". */
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return "/dashboard";
  }
  return value;
}

/** `next` with ?github=<reason> added, so the page they land on can say how it went. */
export function withReason(next: string, reason: string): string {
  const url = new URL(next, "http://x");
  url.searchParams.set("github", reason);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readOAuthCookie(value: string | undefined): OAuthCookie | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<OAuthCookie>;
    if (typeof parsed.state !== "string" || typeof parsed.verifier !== "string" || typeof parsed.userId !== "string") {
      return null;
    }
    return { state: parsed.state, verifier: parsed.verifier, userId: parsed.userId, next: safeNext(parsed.next) };
  } catch {
    return null;
  }
}

export function writeOAuthCookie(value: OAuthCookie): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** Where GitHub sends them back. Must match the OAuth app's registered callback URL. */
export function redirectUriFor(request: Request): string {
  return (
    process.env.GITHUB_OAUTH_REDIRECT_URL ??
    new URL("/api/integrations/github/callback", request.url).toString()
  );
}
