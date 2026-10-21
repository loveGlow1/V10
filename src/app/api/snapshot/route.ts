import { NextResponse } from "next/server";

import { loadSession } from "@/lib/agent/persist";
import { takeSnapshot } from "@/lib/agent/snapshot";
import { Workspace } from "@/lib/agent/tools";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

/* A screenshot of a session's project, on request — the same capture the
 * agent's take_snapshot makes, for the owner of the session only.
 *
 *   POST { sessionId, path?, mobile? } → { url, path, mobileUrl? }
 *
 * The session is read under the caller's own sign-in, so somebody else's id
 * finds nothing. Screenshots cost no credits: no model runs. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!supabase || !user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Screenshots are unavailable right now." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { sessionId?: unknown; path?: unknown; mobile?: unknown } | null;
  const session = await loadSession(supabase, typeof body?.sessionId === "string" ? body.sessionId : "");
  if (!session) return NextResponse.json({ error: "That session does not exist." }, { status: 404 });

  const path = typeof body?.path === "string" && body.path.length <= 300 ? body.path : null;
  let html: string | null = null;
  if (!session.preview_url && session.project_id) {
    const workspace = new Workspace(service, { userId: user.id, projectId: session.project_id, projectName: null, sessionId: session.id });
    await workspace.load();
    html = workspace.document();
  }

  const result = await takeSnapshot(service, {
    sessionId: session.id,
    previewUrl: session.preview_url,
    path,
    html,
    mobile: body?.mobile === true,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({
    url: result.desktop.url,
    path: result.desktop.path,
    ...(result.mobile ? { mobileUrl: result.mobile.url, mobilePath: result.mobile.path } : {}),
  });
}
