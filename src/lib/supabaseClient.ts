import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/** Returns the names of the required Supabase env vars that are missing/undefined. */
export function getMissingSupabaseEnvVars(): string[] {
  return [
    !supabaseUrl ? "NEXT_PUBLIC_SUPABASE_URL" : null,
    !supabaseAnonKey ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : null,
  ].filter((value): value is string => value !== null);
}

/** Builds a human-readable diagnostic message for missing Supabase env vars. */
export function describeMissingSupabaseEnvVars(): string {
  return (
    `Supabase is not configured: missing environment variable(s): ${getMissingSupabaseEnvVars().join(", ")}. ` +
    "Set these in your deployment environment (e.g. Vercel Project Settings → Environment Variables) and redeploy."
  );
}

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.error(describeMissingSupabaseEnvVars());
}

function createSharedSupabaseClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
}

const sharedSupabaseClient: SupabaseClient | null = createSharedSupabaseClient();

export function requireSupabaseClient(): SupabaseClient {
  if (!sharedSupabaseClient) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return sharedSupabaseClient;
}
