import { NextResponse } from "next/server";

import { isBuilderConfigured } from "@/lib/n8n";
import { getMissingSupabaseEnvVars, isSupabaseConfigured } from "@/lib/supabaseClient";

/* Whether this deployment is wired up, without having to try it.
 *
 * `builderConfigured` is the one in the screenshot: N8N_WEBHOOK_URL is a
 * server-side variable, so a deployment missing it looks identical to a working
 * one until someone sends a message and the chat answers "Building is not
 * connected yet". This says so from the outside, before a user finds out. */

/* Never prerendered. This answers about the running deployment's environment,
   and a statically rendered copy would freeze whatever was set at build time. */
export const dynamic = "force-dynamic";

export async function GET() {
  const includeDetails =
    process.env.NODE_ENV !== "production" ||
    process.env.SUPABASE_HEALTH_INCLUDE_DETAILS === "true";

  const missingSupabaseEnvVars = includeDetails ? getMissingSupabaseEnvVars() : undefined;

  return NextResponse.json({
    status: "ok",
    supabaseConfigured: isSupabaseConfigured,
    /* A boolean either way: the webhook URL is a secret, and in production
       even the fact that a token is set is more than a health check owes an
       anonymous caller. */
    builderConfigured: isBuilderConfigured,
    ...(includeDetails ? { builderTokenSet: Boolean(process.env.N8N_WEBHOOK_TOKEN) } : {}),
    ...(missingSupabaseEnvVars ? { missingSupabaseEnvVars } : {}),
  });
}
