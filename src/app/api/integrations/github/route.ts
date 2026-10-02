import { NextResponse } from "next/server";

import { connectionFor, forgetTokens, githubConfigured, revokeGrant } from "@/lib/github/oauth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

import { canPushToGitHub } from "@/lib/github/entitlement";

/* Whether this person has connected GitHub, as which account, and whether
 * their plan lets them push — and Disconnect. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function signedIn() {
  const supabase = await createSupabaseServerClient();
  return supabase ? (await supabase.auth.getUser()).data.user : null;
}

export async function GET() {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const service = createSupabaseServiceClient();
  if (!githubConfigured() || !service) {
    return NextResponse.json({ configured: false, connected: false, login: null, canPush: false });
  }

  const [connection, canPush] = await Promise.all([connectionFor(service, user.id), canPushToGitHub(service, user.id)]);
  return NextResponse.json({
    configured: true,
    connected: Boolean(connection),
    login: connection?.login ?? null,
    canPush,
  });
}

export async function DELETE() {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "This deployment cannot store connections." }, { status: 503 });

  const connection = await connectionFor(service, user.id);
  if (connection) await revokeGrant(connection.token);
  await forgetTokens(service, user.id);
  return NextResponse.json({ connected: false });
}
