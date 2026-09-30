import { NextResponse } from "next/server";

import { authorizeUrlFor, oauthConfigured, pkcePair, randomState } from "@/lib/builder/backend/supabase-oauth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, redirectUriFor, writeOAuthCookie } from "../oauth-cookie";

/* Connect Supabase, step one: send the person to Supabase to sign in and allow
 * QuickStark. A plain link from the Database panel lands here — a navigation,
 * not a fetch, because the next page is Supabase's. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const back = (reason: string) =>
    NextResponse.redirect(
      new URL(
        projectId
          ? `/dashboard/project/${encodeURIComponent(projectId)}?view=database&supabase=${reason}`
          : `/dashboard?supabase=${reason}`,
        request.url,
      ),
    );

  if (!oauthConfigured()) return back("unavailable");

  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!user) return NextResponse.redirect(new URL("/", request.url));

  const { verifier, challenge } = pkcePair();
  const state = randomState();
  const target = authorizeUrlFor(redirectUriFor(request), state, challenge);
  if (!target) return back("unavailable");

  const response = NextResponse.redirect(target);
  response.cookies.set(OAUTH_COOKIE, writeOAuthCookie({ state, verifier, userId: user.id, projectId }), {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: 600,
  });
  return response;
}
