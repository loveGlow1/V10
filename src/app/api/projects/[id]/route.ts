import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  renameProject,
  restoreProject,
  setArchived,
  setPinned,
  softDeleteProject,
} from "@/lib/projects/queries";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/* Pin, archive, rename and delete, for one project.
 *
 * Every write here runs under the caller's own access token — the anon key with
 * their Authorization header, never the service role. RLS is the enforcement
 * layer and this route deliberately does not duplicate it: there is no
 * `user_id = ...` in any statement below, because a policy that already says so
 * and a route that says so again drift, and the copy in the route is the one
 * nobody re-reads.
 *
 * That leaves one thing the route does owe the caller: an honest status. RLS
 * answers a project belonging to somebody else with zero rows rather than an
 * error, which is indistinguishable from an id that does not exist — so it is
 * answered as 404, not 403. Telling a stranger that an id exists but is not
 * theirs is a fact about someone else's account.
 *
 * Delete is soft: it stamps deleted_at and every query filters it out. The rows
 * are purged on a 30-day schedule that lives outside this app. PATCH accordingly
 * carries `restore`, which is what the undo toast on the Projects page presses —
 * an undo that could not reach the server would not be an undo. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PatchBody = {
  pinned?: unknown;
  archived?: unknown;
  name?: unknown;
  restore?: unknown;
};

/** The caller's own token, from the header if they sent one, else the cookie. */
async function callerToken(request: Request): Promise<
  | { token: string }
  | { failure: NextResponse }
> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      failure: NextResponse.json(
        { error: "Projects are unavailable because Supabase is not configured." },
        { status: 503 },
      ),
    };
  }

  const unauthorised = NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  if (bearer) {
    const { data, error } = await supabase.auth.getUser(bearer);
    if (error || !data.user) return { failure: unauthorised };
    return { token: bearer };
  }

  /* getUser before getSession: getUser verifies the token with the auth server,
     where getSession only reads what the cookie claims. */
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { failure: unauthorised };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return { failure: unauthorised };

  return { token: session.access_token };
}

/* Does the caller have this project? Run under their token, so RLS decides, and
   an id that is not theirs comes back empty exactly like one that never was. */
async function owns(token: string, projectId: string) {
  const { data, error } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    },
  )
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data);
}

const notFound = () => NextResponse.json({ error: "No such project." }, { status: 404 });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const caller = await callerToken(request);
  if ("failure" in caller) return caller.failure;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const pinned = typeof body.pinned === "boolean" ? body.pinned : undefined;
  const archived = typeof body.archived === "boolean" ? body.archived : undefined;
  const restore = body.restore === true;
  const name = typeof body.name === "string" ? body.name.trim() : undefined;

  if (pinned === undefined && archived === undefined && name === undefined && !restore) {
    return NextResponse.json(
      { error: "Nothing to change — send pinned, archived, name or restore." },
      { status: 400 },
    );
  }
  if (name !== undefined && !name) {
    return NextResponse.json({ error: "A project needs a name." }, { status: 400 });
  }

  try {
    /* Restore first: the other three would silently do nothing to a row that is
       still soft-deleted, because every one of them is filtered on deleted_at. */
    if (restore) await restoreProject(caller.token, id);

    if (!(await owns(caller.token, id))) return notFound();

    if (pinned !== undefined) await setPinned(caller.token, id, pinned);
    if (archived !== undefined) await setArchived(caller.token, id, archived);
    if (name !== undefined) await renameProject(caller.token, id, name);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That change did not go through." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const caller = await callerToken(request);
  if ("failure" in caller) return caller.failure;

  try {
    if (!(await owns(caller.token, id))) return notFound();
    await softDeleteProject(caller.token, id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That delete did not go through." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
