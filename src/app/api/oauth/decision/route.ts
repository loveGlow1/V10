import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase-server";

/* The Allow / Cancel on /oauth/consent.
 *
 * Supabase Auth records the decision under the person's own session and hands
 * back where to send them: the assistant's redirect URI with an authorization
 * code, or with access_denied. A form post rather than a fetch, so the browser
 * follows that redirect itself. 303 so it arrives as a GET. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const authorizationId = String(form?.get("authorization_id") ?? "").trim();
  const approve = form?.get("decision") === "approve";
  const home = new URL("/", request.url);

  if (!authorizationId) return NextResponse.redirect(home, 303);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.redirect(home, 303);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    return NextResponse.redirect(new URL(`/?signin=1&next=${encodeURIComponent(next)}`, request.url), 303);
  }

  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });

  if (error || !data?.redirect_url) {
    // eslint-disable-next-line no-console
    console.error("oauth decision failed:", error?.message);
    const back = new URL("/oauth/consent", request.url);
    back.searchParams.set("authorization_id", authorizationId);
    return NextResponse.redirect(back, 303);
  }

  return NextResponse.redirect(data.redirect_url, 303);
}
