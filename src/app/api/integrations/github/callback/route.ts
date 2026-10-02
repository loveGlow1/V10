import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { exchangeCode, forgetTokens, saveTokens } from "@/lib/github/oauth";
import { viewerLogin } from "@/lib/github/push";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, readOAuthCookie, redirectUriFor, withReason } from "../oauth-cookie";

/* Connect GitHub, step two: GitHub sends them back with a code.
 *
 * The state must match the one we sent, the signed-in person must be the one
 * who left, and only then is the code exchanged — server-side, with the client
 * secret — and the token stored sealed. They land back where they started,
 * with ?github= saying how it went. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const saved = readOAuthCookie(jar.get(OAUTH_COOKIE)?.value);

  const back = (reason: string) => {
    const response = NextResponse.redirect(new URL(withReason(saved?.next ?? "/dashboard", reason), request.url));
    response.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return response;
  };

  /* They pressed Cancel on GitHub's screen. Not an error worth a scary word. */
  if (url.searchParams.get("error")) return back("cancelled");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!saved || !code || !state || state !== saved.state) return back("expired");

  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user || user.id !== saved.userId) return back("expired");

  const service = createSupabaseServiceClient();
  if (!service) return back("unavailable");

  const exchanged = await exchangeCode({ code, verifier: saved.verifier, redirectUri: redirectUriFor(request) });
  if (!exchanged.ok) {
    // eslint-disable-next-line no-console
    console.error(`github-oauth: exchange failed for ${user.id}: ${exchanged.reason}`);
    return back("failed");
  }

  const login = await viewerLogin(exchanged.tokens.accessToken);
  if (!(await saveTokens(service, user.id, exchanged.tokens, login))) {
    await forgetTokens(service, user.id).catch(() => {});
    return back("failed");
  }

  return back("connected");
}
