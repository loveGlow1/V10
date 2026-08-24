import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the Supabase session on every request.
 *
 * Access tokens are short-lived. Server Components can read cookies but cannot
 * write them, so without this the refreshed token is never persisted and
 * `getUser()` in the dashboard layout starts returning null an hour after
 * sign-in — logging people out mid-session for no visible reason.
 */
export async function middleware(request: NextRequest) {
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
