import { createClient } from "@supabase/supabase-js";

/* The client that writes without a user session.
 *
 * Everything the browser does goes through createSupabaseServerClient, which
 * carries the caller's session so RLS answers for it. One path cannot: the
 * build endpoint is called by n8n, on behalf of a user who is not there, to
 * write a generated page into their workspace. RLS would refuse that write —
 * correctly, since there is no `auth.uid()` behind it.
 *
 * So this uses the service_role key, which bypasses RLS entirely. That is the
 * whole reason to be careful with it:
 *
 *   - it is never NEXT_PUBLIC_ and never reaches the browser;
 *   - the only caller is /api/builder/webapp/generate, and only after the
 *     request's signature has been verified against the project and user it
 *     names (see build-signature.ts);
 *   - it addresses rows by ids that came from that signature, never from
 *     unsigned request fields.
 *
 * Returns null when the key is not set, so a deployment without it fails as a
 * refused build with a reason rather than a crash. */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isServiceRoleConfigured = Boolean(supabaseUrl && serviceRoleKey);

export function createSupabaseServiceClient() {
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      /* No session to persist and none to refresh: this client is constructed
         per request on a server that has no user to be signed in as. */
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
