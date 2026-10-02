import { NextResponse } from "next/server";

import { authorizeUrlFor, githubConfigured, pkcePair, randomState } from "@/lib/github/oauth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, redirectUriFor, safeNext, withReason, writeOAuthCookie } from "../oauth-cookie";

/* Connect GitHub, step one: send the person to GitHub to sign in and allow
 * QuickStark. A plain link lands here — a navigation, not a fetch, because the
 * next page is GitHub's. `?next=` is the page to come back to.
 *
 * Connecting is open to every plan, so the account menu's Connect to GitHub
 * works for everybody; PUSHING is what the paid plans unlock, and that is
 * checked where the push happens (/api/projects/[id]/github). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));

  if (!githubConfigured()) return NextResponse.redirect(new URL(withReason(next, "unavailable"), request.url));

  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) return NextResponse.redirect(new URL("/", request.url));

  const { verifier, challenge } = pkcePair();
  const state = randomState();
  const target = authorizeUrlFor(redirectUriFor(request), state, challenge);
  if (!target) return NextResponse.redirect(new URL(withReason(next, "unavailable"), request.url));

  const response = NextResponse.redirect(target);
  response.cookies.set(OAUTH_COOKIE, writeOAuthCookie({ state, verifier, userId: user.id, next }), {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: 600,
  });
  return response;
}
