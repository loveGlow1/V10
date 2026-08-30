import { NextResponse } from "next/server";

import { isBuilderConfigured } from "@/lib/n8n";
import { isServiceRoleConfigured } from "@/lib/supabase-service";
import { getMissingSupabaseEnvVars, isSupabaseConfigured } from "@/lib/supabaseClient";

/* Whether this deployment is wired up, without having to try it.
 *
 * `builderConfigured` is the one in the screenshot: N8N_WEBHOOK_URL is a
 * server-side variable, so a deployment missing it looks identical to a working
 * one until someone sends a message and the chat answers "Building is not
 * connected yet". This says so from the outside, before a user finds out.
 *
 * `generationConfigured` and `storageConfigured` are the same question for the
 * two variables a build needs to produce and keep a page. They are booleans
 * about presence, which is exactly what catches the failure they exist for: a
 * variable whose name is a character out is not missing in any way a hosting
 * dashboard shows you — it is simply never read, and the first sign is a build
 * that fails for no visible reason. */

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
    /* What a build needs beyond reaching the orchestrator: a key to generate
       the page with, and one to store it under. Both are read by name, so
       either being false means the name in the environment is not the name the
       code looks for. */
    generationConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    storageConfigured: isServiceRoleConfigured,
    ...(includeDetails ? { builderTokenSet: Boolean(process.env.N8N_WEBHOOK_TOKEN) } : {}),
    ...(missingSupabaseEnvVars ? { missingSupabaseEnvVars } : {}),
  });
}
