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
 * `storageConfigured` is the same question for the key a finished page is
 * stored under. A boolean about presence, which is exactly what catches the
 * failure it exists for: a variable whose name is a character out is not
 * missing in any way a hosting dashboard shows you — it is simply never read,
 * and the first sign is a build that fails for no visible reason.
 *
 * `editingConfigured` is the same question for the key the app needs again.
 * Generating a whole page still happens in the orchestrator under n8n's own
 * credential — but editing one, answering a question about it and routing an
 * ambiguous message all run here, and all three need a key of this app's own. */

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
    /* What a finished page needs to be kept, and what an edit needs to happen.
       Both read by name, so a false here means the name in the environment is
       not the name the code looks for — which is invisible in a hosting
       dashboard and otherwise shows up only as a feature that quietly refuses. */
    storageConfigured: isServiceRoleConfigured,
    editingConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    ...(includeDetails ? { builderTokenSet: Boolean(process.env.N8N_WEBHOOK_TOKEN) } : {}),
    ...(missingSupabaseEnvVars ? { missingSupabaseEnvVars } : {}),
  });
}
