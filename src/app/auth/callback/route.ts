import { NextResponse, type NextRequest } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase-server';

/**
 * Completes OAuth and email-confirmation sign-ins.
 *
 * The browser client uses the PKCE flow, so Supabase sends the visitor back
 * with a `?code=` that has to be exchanged for a session here — in a Route
 * Handler, which unlike a Server Component is allowed to write the session
 * cookies. Sending providers straight to /dashboard instead lands the visitor
 * on a page that reads no session and bounces them back to the landing page.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const providerError = searchParams.get('error_description') ?? searchParams.get('error');
  const requestedNext = searchParams.get('next') ?? '/dashboard';

  // Only same-origin paths, so `?next=` cannot be used to bounce someone to
  // another site off the back of a real sign-in.
  const next =
    requestedNext.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/dashboard';

  // Behind a proxy the request's own origin is the internal one, so prefer the
  // forwarded host when the platform sets it.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https';
  const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : new URL(request.url).origin;

  const failed = (reason: string) =>
    NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(reason)}`);

  if (providerError) return failed(providerError);
  if (!code) return failed('Sign-in did not return an authorization code. Please try again.');

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return failed('Authentication is unavailable because Supabase environment configuration is incomplete.');
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return failed(error.message);

  return NextResponse.redirect(`${origin}${next}`);
}
