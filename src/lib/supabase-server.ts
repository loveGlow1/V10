import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';

import { describeMissingSupabaseEnvVars } from './supabaseClient';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let hasLoggedMissingSupabaseConfig = false;

/**
 * Creates a Supabase client for use in Server Components, Route Handlers, and
 * Server Actions. Reads the user's session from cookies so that RLS policies
 * can be applied correctly.
 *
 * Returns `null` when the required environment variables are not set so that
 * callers can handle the unconfigured case gracefully (e.g. redirect to login).
 *
 * Usage:
 *   const supabase = await createSupabaseServerClient();
 *   if (!supabase) redirect('/');
 *   const { data: { user } } = await supabase.auth.getUser();
 */
export async function createSupabaseServerClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    if (!hasLoggedMissingSupabaseConfig) {
      // eslint-disable-next-line no-console
      console.error(describeMissingSupabaseEnvVars());
      hasLoggedMissingSupabaseConfig = true;
    }
    return null;
  }

  const cookieStore = await cookies();

  /* A request with no session cookie but a bearer token is a signed-in caller
     that is not a browser — today, the MCP server calling these routes for an
     AI assistant the person approved (see src/lib/quickstark-mcp). It is the
     same person with the same rights: Supabase checks the token on getUser()
     exactly as it checks the cookie's, and a token is never sent by a browser
     on its own, so this opens nothing to a cross-site request. The cookie wins
     when both are present, so the browser's path is unchanged. */
  if (!hasSessionCookie(cookieStore.getAll())) {
    const bearer = bearerToken((await headers()).get('authorization'));
    if (bearer) return clientForToken(supabaseUrl, supabaseAnonKey, bearer);
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot set cookies — only Route Handlers /
          // Server Actions can. Silently ignore so reads still work.
        }
      },
    },
  });
}

/** A client acting as whoever `token` belongs to, for a caller that holds the token itself. */
export function createSupabaseClientForToken(token: string) {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return clientForToken(supabaseUrl, supabaseAnonKey, token);
}

function hasSessionCookie(all: { name: string }[]): boolean {
  return all.some(({ name }) => name.startsWith('sb-') && name.includes('-auth-token'));
}

/** A JWT from `Authorization: Bearer …`, or null. Anything else is ignored. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!match) return null;
  return match[1].split('.').length === 3 ? match[1] : null;
}

/* The session a bearer token stands for, held in memory for this one request.
 *
 * Through the client's own storage option rather than a header alone, so that
 * every call the routes already make — getUser(), getSession(), a query under
 * RLS — behaves as it does for a cookie. There is no refresh token: refreshing
 * is the token holder's job, and a token that has expired is answered as signed
 * out, which is what it is. */
function clientForToken(url: string, anonKey: string, token: string) {
  const storageKey = 'qs-bearer-session';
  const session = JSON.stringify({
    access_token: token,
    token_type: 'bearer',
    refresh_token: '',
    expires_at: expiryOf(token),
    expires_in: Math.max(0, expiryOf(token) - Math.floor(Date.now() / 1000)),
    user: null,
  });
  const memory = new Map<string, string>([[storageKey, session]]);

  return createClient(url, anonKey, {
    auth: {
      storageKey,
      storage: {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => void memory.set(key, value),
        removeItem: (key) => void memory.delete(key),
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** The token's `exp`, read without verifying it — Supabase verifies on use. */
function expiryOf(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch {
    return 0;
  }
}
