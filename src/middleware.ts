import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { isAppPath, routeFor } from '@/lib/publish/routing';
import { SITE_DOMAIN_HEADER, SITE_SLUG_HEADER } from '@/lib/publish/headers';

/**
 * Two jobs, and the first one has to happen before the second.
 *
 * WHICH SITE IS THIS. Three kinds of address reach this deployment: the app
 * itself, a published project on its own subdomain, and a customer's own
 * domain. Only the first is the dashboard. A request on shop.quickstark.tech
 * is somebody's live website and must be served the published document and
 * nothing else — no session, no API, no app routes.
 *
 * REFRESH THE SESSION. Access tokens are short-lived. Server Components can
 * read cookies but cannot write them, so without this the refreshed token is
 * never persisted and `getUser()` in the dashboard layout starts returning null
 * an hour after sign-in — logging people out mid-session for no visible reason.
 *
 * The order matters: a published site has no session to refresh and must not be
 * given one, so it is answered and returned before any of that runs.
 */
export async function middleware(request: NextRequest) {
  const route = routeFor(request.headers.get('host'));

  if (route.kind !== 'app' && !isAppPath(request.nextUrl.pathname)) {
    /* Rewritten to the public serving route, carrying which site this is in a
       header the middleware sets.
     *
       Set on a FRESH header list built from the incoming request, and this is
       the security-critical part: a caller can send x-quickstark-site-slug
       themselves, and if it were merely added to the request's own headers,
       theirs would arrive alongside ours — or instead of it. Deleting both
       before writing either means whatever the caller sent is gone, and the
       only value the route can read is the one derived from the hostname. */
    const headers = new Headers(request.headers);
    headers.delete(SITE_SLUG_HEADER);
    headers.delete(SITE_DOMAIN_HEADER);

    if (route.kind === 'slug') headers.set(SITE_SLUG_HEADER, route.slug);
    else headers.set(SITE_DOMAIN_HEADER, route.domain);

    /* Every path on a project's hostname serves that project's one document.
       A published page is a single file: there is no /about to 404 on, and a
       404 there would be this app's 404 on somebody else's domain. */
    return NextResponse.rewrite(new URL('/site', request.url), { request: { headers } });
  }

  return appMiddleware(request);
}

async function appMiddleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Nothing to refresh until the project is wired up. Let the request through
  // so the site still renders with auth simply unavailable.
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // The request copy is what downstream Server Components read; the
        // response copy is what reaches the browser. Both need the new values.
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Touching the user is what triggers the refresh; the result is deliberately
  // unused, since route protection lives in the dashboard layout. A network
  // blip reaching Supabase must not take the whole site down with a 500 —
  // the request continues with whatever cookies it arrived with.
  try {
    await supabase.auth.getUser();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Supabase session refresh failed:', error);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next's own assets and static files — auth cookies are
    // irrelevant to those and refreshing on each one wastes a round trip.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)',
  ],
};
